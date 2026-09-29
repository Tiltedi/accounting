import {
  TX_COLUMNS,
  applyMapping,
  fingerprints,
  guessMapping,
  parseCsv,
  type Mapping,
  type Match,
  type Transaction,
} from "@/lib/bank";
import type { Client } from "@/lib/documents";

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

// Imports a bank CSV. Lines already imported (overlapping exports) are skipped.
export async function importStatement(supabase: Client, file: File) {
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
  const importId = crypto.randomUUID();
  const records = parsed.map((tx, i) => ({ ...tx, import_id: importId, fingerprint: prints[i] }));

  const added: Transaction[] = [];
  for (let i = 0; i < records.length; i += 500) {
    const { data, error } = await supabase
      .from("bank_transactions")
      .upsert(records.slice(i, i + 500), { onConflict: "fingerprint", ignoreDuplicates: true })
      .select(TX_COLUMNS);
    if (error) throw error;
    added.push(...(data as Transaction[]));
  }
  return { added, skipped: records.length - added.length };
}

export async function linkTransaction(
  supabase: Client,
  txId: string,
  change: { document_id: string | null; status: Transaction["status"]; matched_by: Transaction["matched_by"] },
) {
  const { data, error } = await supabase.from("bank_transactions").update(change).eq("id", txId).select(TX_COLUMNS).single();
  if (error) throw error;
  return data as Transaction;
}

// Saves the matches that are safe to link without asking.
export async function applySureMatches(supabase: Client, matches: Match[]) {
  const sure = matches.filter((m) => m.sure);
  const saved: Transaction[] = [];
  for (const m of sure) {
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
