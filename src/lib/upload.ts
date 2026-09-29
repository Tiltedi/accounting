import { todayISO } from "@/lib/dates";
import { BUCKET, DOC_COLUMNS, type Client, type Doc } from "@/lib/documents";
import { extensionFor, imageToJpeg, sha256Hex } from "@/lib/files";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type PreparedFile = { blob: Blob; name: string; type: string };

export class DuplicateError extends Error {
  constructor(public docId: string) {
    super("Already added");
  }
}

const PASS_THROUGH_IMAGES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const TYPES_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

// Makes a picked file ready to store: large or unusual images become JPEGs.
export async function prepareFile(file: File): Promise<PreparedFile> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = file.type || TYPES_BY_EXTENSION[extension] || "";

  if (type === "application/pdf") return { blob: file, name: file.name, type };
  if (!type.startsWith("image/")) throw new Error(`${file.name}: only PDFs and images`);

  if (!PASS_THROUGH_IMAGES.includes(type) || file.size > 3.5 * 1024 * 1024) {
    try {
      const { blob } = await imageToJpeg(file);
      return { blob, name: `${file.name.replace(/\.[^.]+$/, "")}.jpg`, type: "image/jpeg" };
    } catch {
      // Keep the original, e.g. HEIC in a browser that cannot decode it.
    }
  }
  return { blob: file, name: file.name, type };
}

// Stores the file and creates its row. Throws DuplicateError for files already stored.
export async function uploadDocument(supabase: Client, file: PreparedFile): Promise<Doc> {
  if (file.blob.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is over 25 MB`);

  const sha256 = await sha256Hex(file.blob);
  const existing = await findBySha(supabase, sha256);
  if (existing) throw new DuplicateError(existing);

  const now = new Date();
  const folder = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const path = `${folder}/${crypto.randomUUID()}.${extensionFor(file.type, file.name)}`;

  // Storage takes the type from the blob itself (e.g. a HEIC the browser left untyped).
  const body = file.blob.type === file.type ? file.blob : new Blob([file.blob], { type: file.type });
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType: file.type, cacheControl: "31536000", upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("documents")
    .insert({
      file_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.blob.size,
      sha256,
      doc_date: todayISO(),
    })
    .select(DOC_COLUMNS)
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    if (error.code === "23505") {
      const duplicate = await findBySha(supabase, sha256);
      if (duplicate) throw new DuplicateError(duplicate);
    }
    throw error;
  }
  return data as Doc;
}

async function findBySha(supabase: Client, sha256: string) {
  const { data } = await supabase.from("documents").select("id").eq("sha256", sha256).maybeSingle();
  return data?.id ?? null;
}

export type ExtractResult = { doc: Doc | null; notice?: "not_configured" | "unsupported"; error?: string };

export async function requestExtraction(id: string): Promise<ExtractResult> {
  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const result = (await response.json().catch(() => ({}))) as Partial<ExtractResult>;
  if (!response.ok && !result.doc) throw new Error(result.error ?? `Reading failed (${response.status})`);
  return { doc: result.doc ?? null, notice: result.notice, error: result.error };
}
