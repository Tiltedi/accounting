import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export const DOC_COLUMNS =
  "id,created_at,status,file_path,file_name,mime_type,size_bytes,doc_date,vendor,description,category,doc_type,invoice_number,total,tax,currency,notes,booked_at,ai_cost_usd,recurring" as const;

type Row = Database["public"]["Tables"]["documents"]["Row"];

export type Doc = Pick<
  Row,
  | "id"
  | "created_at"
  | "file_path"
  | "file_name"
  | "mime_type"
  | "size_bytes"
  | "doc_date"
  | "vendor"
  | "description"
  | "category"
  | "doc_type"
  | "invoice_number"
  | "total"
  | "tax"
  | "currency"
  | "notes"
  | "booked_at"
  | "ai_cost_usd"
  | "recurring"
> & { status: "processing" | "ready" | "failed" };

export type DocUpdate = Partial<
  Pick<
    Doc,
    | "doc_date"
    | "vendor"
    | "description"
    | "category"
    | "doc_type"
    | "invoice_number"
    | "total"
    | "tax"
    | "currency"
    | "notes"
    | "booked_at"
    | "recurring"
  >
>;

export type Client = SupabaseClient<Database>;

export const BUCKET = "documents";

// Loads every document, newest first, in pages of 1000 rows.
export async function fetchAllDocuments(supabase: Client): Promise<Doc[]> {
  const pageSize = 1000;
  const docs: Doc[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("documents")
      .select(DOC_COLUMNS)
      .order("doc_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    docs.push(...(data as Doc[]));
    if (data.length < pageSize) return docs;
  }
}

export function compareDocs(a: Doc, b: Doc) {
  if (a.doc_date !== b.doc_date) return a.doc_date < b.doc_date ? 1 : -1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return 0;
}

export function isPdf(doc: Pick<Doc, "mime_type">) {
  return doc.mime_type === "application/pdf";
}

export function isImage(doc: Pick<Doc, "mime_type">) {
  return doc.mime_type.startsWith("image/");
}
