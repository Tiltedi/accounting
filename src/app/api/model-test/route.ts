import { BUCKET } from "@/lib/documents";
import { canExtract, extractDocument, MODELS, type Extraction } from "@/lib/extraction";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// Temporary: reads one stored document with each model side by side, to
// compare accuracy, speed and cost. Nothing is saved.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "No Anthropic API key on this deployment" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id) return Response.json({ error: "Missing document id" }, { status: 400 });

  const { data: doc } = await supabase.from("documents").select("file_path,file_name,mime_type").eq("id", id).maybeSingle();
  if (!doc || !canExtract(doc.mime_type)) return Response.json({ error: "Not readable" }, { status: 404 });
  const { data: file, error } = await supabase.storage.from(BUCKET).download(doc.file_path);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const input = { data: Buffer.from(await file.arrayBuffer()), mimeType: doc.mime_type, fileName: doc.file_name };

  const runs = await Promise.all(
    MODELS.map(async (model) => {
      const started = Date.now();
      try {
        const { result, costUsd } = await extractDocument(input, model);
        return { model, ms: Date.now() - started, costUsd, result: result as Extraction | null, error: null };
      } catch (err) {
        return { model, ms: Date.now() - started, costUsd: 0, result: null, error: err instanceof Error ? err.message : "failed" };
      }
    }),
  );
  return Response.json({ runs });
}
