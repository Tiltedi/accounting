import Anthropic from "@anthropic-ai/sdk";
import type { Json } from "@/lib/database.types";
import { BUCKET, DOC_COLUMNS, type Doc, type DocUpdate } from "@/lib/documents";
import { canExtract, extractDocument, ExtractionError } from "@/lib/extraction";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// Claude accepts requests up to 32 MB; base64 adds a third.
const MAX_BYTES = 20 * 1024 * 1024;

// Reads a stored document with Claude and saves the details on its row.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return Response.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id) return Response.json({ error: "Missing document id" }, { status: 400 });

  const { data: doc, error } = await supabase
    .from("documents")
    .select("id,file_path,file_name,mime_type,size_bytes,doc_date")
    .eq("id", id)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });

  const save = async (update: DocUpdate & { status: Doc["status"]; extraction?: Json }) => {
    const { data, error } = await supabase
      .from("documents")
      .update(update)
      .eq("id", id)
      .select(DOC_COLUMNS)
      .single();
    if (error) throw error;
    return data;
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ doc: await save({ status: "ready" }), notice: "not_configured" });
  }
  if (!canExtract(doc.mime_type) || doc.size_bytes > MAX_BYTES) {
    return Response.json({ doc: await save({ status: "ready" }), notice: "unsupported" });
  }

  try {
    const { data: file, error: downloadError } = await supabase.storage.from(BUCKET).download(doc.file_path);
    if (downloadError) throw downloadError;

    const result = await extractDocument({
      data: Buffer.from(await file.arrayBuffer()),
      mimeType: doc.mime_type,
      fileName: doc.file_name,
    });

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
