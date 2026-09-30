import {
  TX_COLUMNS,
  applyMapping,
  fingerprints,
  guessMapping,
  legacyFingerprints,
  parseCsv,
  ruleFor,
  type Mapping,
  type ParsedTransaction,
  type Match,
  type Rule,
  type Source,
  type Transaction,
} from "@/lib/bank";
import type { Client, Doc } from "@/lib/documents";

async function readText(file: File) {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  // Older bank exports are Windows-1252; fall back when UTF-8 fails.
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buffer) : utf8;
}

async function askForMapping(rows: string[][]): Promise<Mapping> {
  const response = await fetch("/api/bank-columns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: rows.slice(0, 25) }),
  });
  const result = (await response.json().catch(() => ({}))) as { mapping?: Mapping; error?: string };
  if (!response.ok || !result.mapping) throw new Error(result.error ?? "Couldn't recognise this file's layout.");
  return result.mapping;
}

// Imports a bank or card CSV. Lines already imported (overlapping exports) are skipped.
export async function importStatement(supabase: Client, file: File, source: Source = "bank") {
  if (!/\.(csv|txt|tsv)$/i.test(file.name) && !/csv|text/.test(file.type)) {
    throw new Error("Use the CSV export from your bank's website.");
  }
  const rows = parseCsv(await readText(file));
  if (!rows.length) throw new Error("This file has no transactions.");

  let parsed = [] as ReturnType<typeof applyMapping>;
  const guessed = guessMapping(rows);
  if (guessed) parsed = applyMapping(rows, guessed);
  if (!parsed.length) parsed = applyMapping(rows, await askForMapping(rows));
  if (!parsed.length) throw new Error("No transactions found in this file.");

  const prints = await fingerprints(parsed);
  const known = await importedBefore(supabase, parsed, prints);
  const importId = crypto.randomUUID();
  const records = parsed
    .map((tx, i) => ({ ...tx, source, import_id: importId, fingerprint: prints[i] }))
    .filter((_, i) => !known.has(i));

  const added: Transaction[] = [];
  for (let i = 0; i < records.length; i += 500) {
    const { data, error } = await supabase
      .from("bank_transactions")
      .upsert(records.slice(i, i + 500), { onConflict: "fingerprint", ignoreDuplicates: true })
      .select(TX_COLUMNS);
    if (error) throw error;
    added.push(...(data as Transaction[]));
  }
  return { added, skipped: parsed.length - added.length };
}

// Lines stored before bank ids were read have the older fingerprint: find
// them too, so switching fingerprints never duplicates a line.
async function importedBefore(supabase: Client, parsed: ParsedTransaction[], prints: string[]) {
  const legacy = await legacyFingerprints(parsed);
  const candidates = legacy.flatMap((fp, i) => (fp !== prints[i] ? [{ fp, i }] : []));
  const known = new Set<number>();
  for (let start = 0; start < candidates.length; start += 200) {
    const chunk = candidates.slice(start, start + 200);
    const { data, error } = await supabase
      .from("bank_transactions")
      .select("fingerprint")
      .in("fingerprint", chunk.map((c) => c.fp));
    if (error) throw error;
    const found = new Set(data.map((r) => r.fingerprint));
    for (const c of chunk) if (found.has(c.fp)) known.add(c.i);
  }
  return known;
}

export async function linkTransaction(
  supabase: Client,
  txId: string,
  change: { document_id: string | null; status: Transaction["status"]; matched_by: Transaction["matched_by"]; note?: string | null },
) {
  const { data, error } = await supabase.from("bank_transactions").update(change).eq("id", txId).select(TX_COLUMNS).single();
  if (error) throw error;
  return data as Transaction;
}

// Links approved suggestions. Skips lines that changed in the meantime.
export async function approveMatches(supabase: Client, matches: Match[]) {
  const saved: Transaction[] = [];
  for (const m of matches) {
    const { data, error } = await supabase
      .from("bank_transactions")
      .update({ document_id: m.docId, status: "matched", matched_by: "auto" })
      .eq("id", m.txId)
      .eq("status", "unmatched")
      .select(TX_COLUMNS);
    if (error) throw error;
    saved.push(...(data as Transaction[]));
  }
  return saved;
}

// Marks open lines covered by a rule as "no receipt needed", noting why.
export async function applyRules(supabase: Client, txs: Transaction[], rules: Rule[]) {
  const byRule = new Map<Rule, string[]>();
  for (const tx of txs) {
    if (tx.status !== "unmatched" || tx.document_id) continue;
    const rule = ruleFor(tx, rules);
    if (rule) byRule.set(rule, [...(byRule.get(rule) ?? []), tx.id]);
  }
  const saved: Transaction[] = [];
  for (const [rule, ids] of byRule) {
    const { data, error } = await supabase
      .from("bank_transactions")
      .update({ status: "no_receipt", matched_by: "auto", note: rule.label || rule.pattern })
      .in("id", ids)
      .eq("status", "unmatched")
      .select(TX_COLUMNS);
    if (error) throw error;
    saved.push(...(data as Transaction[]));
  }
  return saved;
}

export type StatementResult = { doc: Doc | null; txs: Transaction[]; error?: string; notice?: string };

// Has Claude list the purchases on a stored card statement and saves them as card lines.
export async function readCardStatement(id: string): Promise<StatementResult> {
  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, kind: "card_statement" }),
  });
  const result = (await response.json().catch(() => ({}))) as Partial<StatementResult>;
  if (!response.ok && !result.doc) throw new Error(result.error ?? `Reading failed (${response.status})`);
  return { doc: result.doc ?? null, txs: result.txs ?? [], error: result.error, notice: result.notice };
}
