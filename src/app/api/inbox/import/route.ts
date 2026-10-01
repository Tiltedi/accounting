import { createHash, randomUUID } from "node:crypto";
import { BUCKET, DOC_COLUMNS, type Doc } from "@/lib/documents";
import { extensionFor } from "@/lib/files";
import { accessToken, getAttachment, GmailError } from "@/lib/gmail";
import { EMAIL_PART } from "@/lib/inbox";
import { failure, mailConnection, signedInClient } from "@/lib/inbox-server";
import { MAX_UPLOAD_BYTES } from "@/lib/upload";

export const maxDuration = 60;

// Imports the chosen attachments of an inbox email as documents (not read
// yet: the browser asks for reading, as for any upload) and closes the item.
export async function POST(request: Request) {
  const supabase = await signedInClient();
  if (!supabase) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { id?: unknown; parts?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const parts = Array.isArray(body?.parts) ? body.parts.filter((p): p is string => typeof p === "string") : [];
  if (!id || !parts.length) return Response.json({ error: "Pick at least one attachment" }, { status: 400 });

  try {
    const { data: item, error } = await supabase
      .from("inbox_items")
      .select("id,gmail_id,received_at,attachments,status")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!item) return Response.json({ error: "Email not found" }, { status: 404 });
    if (item.status !== "pending") return Response.json({ error: "This email was already handled" }, { status: 409 });
    const listed = new Set([EMAIL_PART, ...(item.attachments as { part: string }[]).map((a) => a.part)]);
    if (parts.some((p) => !listed.has(p))) return Response.json({ error: "Unknown attachment" }, { status: 400 });

    const connection = await mailConnection(supabase);
    if (!connection) return Response.json({ error: "The inbox isn't connected" }, { status: 409 });
    const token = await accessToken(connection.refresh_token);

    const created: Doc[] = [];
    const existing: string[] = [];
    for (const part of parts) {
      const file = await getAttachment(token, item.gmail_id, part);
      if (file.bytes.length > MAX_UPLOAD_BYTES) throw new GmailError(`${file.filename} is over 25 MB`);
      const sha256 = createHash("sha256").update(file.bytes).digest("hex");
      const { data: same } = await supabase.from("documents").select("id").eq("sha256", sha256).maybeSingle();
      if (same) {
        existing.push(same.id);
        continue;
      }

      const now = new Date();
      const path = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${randomUUID()}.${extensionFor(file.mime, file.filename)}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file.bytes, { contentType: file.mime, cacheControl: "31536000", upsert: false });
      if (uploadError) throw uploadError;
      const { data: doc, error: insertError } = await supabase
        .from("documents")
        .insert({
          file_path: path,
          file_name: file.filename,
          mime_type: file.mime,
          size_bytes: file.bytes.length,
          sha256,
          doc_date: item.received_at.slice(0, 10), // until it's read
        })
        .select(DOC_COLUMNS)
        .single();
      if (insertError) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw insertError;
      }
      created.push(doc as Doc);
    }

    const { error: updateError } = await supabase
      .from("inbox_items")
      .update({ status: "imported", decided_at: new Date().toISOString(), document_ids: [...created.map((d) => d.id), ...existing] })
      .eq("id", id);
    if (updateError) throw updateError;
    return Response.json({ docs: created, existing });
  } catch (err) {
    return failure(err);
  }
}
