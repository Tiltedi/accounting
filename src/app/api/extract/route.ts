import Anthropic from "@anthropic-ai/sdk";
import { fetchRules, fingerprints, ruleFor, TX_COLUMNS, type ParsedTransaction } from "@/lib/bank";
import type { Json } from "@/lib/database.types";
import { BUCKET, DOC_COLUMNS, type Client, type Doc, type DocUpdate } from "@/lib/documents";
import { canExtract, extractCardStatement, extractDocument, ExtractionError, type StatementExtraction } from "@/lib/extraction";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// Claude accepts requests up to 32 MB; base64 adds a third.
const MAX_BYTES = 20 * 1024 * 1024;

// Reads a stored document with Claude and saves the details on its row.
// Card statements (kind "card_statement") also get their purchases saved as card lines.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return Response.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { id?: unknown; kind?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id) return Response.json({ error: "Missing document id" }, { status: 400 });

  const { data: doc, error } = await supabase
    .from("documents")
    .select("id,file_path,file_name,mime_type,size_bytes,doc_date,doc_type,status,ai_cost_usd")
    .eq("id", id)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });
  const statement = body?.kind === "card_statement" || doc.doc_type === "statement";

  const save = async (update: DocUpdate & { status: Doc["status"]; extraction?: Json; ai_cost_usd?: number }) => {
    const { data, error } = await supabase
      .from("documents")
      .update(update)
      .eq("id", id)
      .select(DOC_COLUMNS)
      .single();
    if (error) throw error;
    return data;
  };

  const unread = statement ? ({ status: "ready", doc_type: "statement" } as const) : ({ status: "ready" } as const);
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ doc: await save(unread), txs: [], notice: "not_configured" });
  }
  if (!canExtract(doc.mime_type) || doc.size_bytes > MAX_BYTES) {
    return Response.json({ doc: await save(unread), txs: [], notice: "unsupported" });
  }

  try {
    const { data: file, error: downloadError } = await supabase.storage.from(BUCKET).download(doc.file_path);
    if (downloadError) throw downloadError;

    const input = { data: Buffer.from(await file.arrayBuffer()), mimeType: doc.mime_type, fileName: doc.file_name };

    if (statement) {
      const { result, costUsd } = await extractCardStatement(input);
      const currency = result.currency ?? "EUR";
      const updated = await save({
        status: "ready",
        vendor: result.issuer ?? "Credit card",
        description: result.card_last4 ? `Card statement •••• ${result.card_last4}` : "Card statement",
        doc_date: result.statement_date ?? doc.doc_date,
        category: "Other",
        doc_type: "statement",
        invoice_number: null,
        total: result.total_due ?? Math.round(result.lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100,
        tax: null,
        currency,
        extraction: result as unknown as Json,
        // Still processing: the first read (which spotted the statement) counts too.
        ai_cost_usd: costUsd + (doc.status === "processing" ? Number(doc.ai_cost_usd ?? 0) : 0),
      });
      const txs = await saveCardLines(supabase, id, result, currency);
      return Response.json({ doc: updated, txs });
    }

    const { result, costUsd } = await extractDocument(input);

    // A card statement dropped anywhere: mark it, and the client asks for its
    // lines in a second request (each stays well within the time limit).
    if (result.card_statement) {
      const marked = await save({ status: "processing", doc_type: "statement", ai_cost_usd: costUsd });
      return Response.json({ doc: marked, txs: [], notice: "card_statement" });
    }

    const updated = await save({
      status: "ready",
      vendor: result.vendor,
      description: result.description,
      doc_date: result.doc_date ?? doc.doc_date,
      category: result.category,
      doc_type: result.doc_type,
      invoice_number: result.invoice_number,
      total: result.total,
      tax: result.tax,
      currency: result.currency,
      extraction: result,
      ai_cost_usd: costUsd,
    });
    return Response.json({ doc: updated });
  } catch (err) {
    console.error("extract failed", id, err);
    const message =
      err instanceof ExtractionError
        ? err.message
        : err instanceof Anthropic.AuthenticationError
          ? "The Anthropic API key is not valid."
          : err instanceof Anthropic.RateLimitError
            ? "Too many requests right now. Try again in a minute."
            : err instanceof Anthropic.BadRequestError
              ? `Claude could not read it: ${err.message.slice(0, 160)}`
              : "Could not read the document.";
    const failed = await save({ status: "failed" }).catch(() => null);
    return Response.json({ doc: failed, error: message }, { status: 502 });
  }
}

async function saveCardLines(supabase: Client, statementId: string, result: StatementExtraction, currency: string) {
  const parsed: ParsedTransaction[] = result.lines.map((line) => ({
    account: result.card_last4 ? `•••• ${result.card_last4}` : null,
    booked_on: line.date,
    amount: -line.amount, // purchases leave, refunds come back
    currency,
    counterparty: line.merchant || null,
    description: line.details,
    bank_ref: null,
  }));
  const prints = await fingerprints(parsed);
  const rules = await fetchRules(supabase);
  const records = parsed.map((tx, i) => {
    const rule = ruleFor(tx, rules);
    return {
      ...tx,
      ...(rule ? { status: "no_receipt", matched_by: "auto", note: rule.label || rule.pattern } : {}),
      source: "card",
    statement_id: statementId,
      import_id: statementId,
      fingerprint: prints[i],
    };
  });
  if (records.length) {
    // Reading the same statement again keeps lines (and their receipts) already saved.
    const { error } = await supabase.from("bank_transactions").upsert(records, { onConflict: "fingerprint", ignoreDuplicates: true });
    if (error) throw error;
  }
  const { data, error } = await supabase.from("bank_transactions").select(TX_COLUMNS).eq("statement_id", statementId);
  if (error) throw error;
  return data;
}
