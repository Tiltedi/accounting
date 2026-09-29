import { docTypeLabel } from "@/lib/categories";
import { fromISODate } from "@/lib/dates";
import { BUCKET, type Client, type Doc } from "@/lib/documents";
import { downloadName, eachLimit, sanitizeFileName, saveBlob } from "@/lib/files";
import { createXlsx, type Cell, type Column } from "@/lib/xlsx";
import { createZip, type ZipEntry } from "@/lib/zip";

async function fetchFile(supabase: Client, doc: Doc) {
  const { data, error } = await supabase.storage.from(BUCKET).download(doc.file_path);
  if (error) throw new Error(`Could not download ${doc.file_name}`);
  return data;
}

export async function downloadOne(supabase: Client, doc: Doc) {
  saveBlob(await fetchFile(supabase, doc), downloadName(doc));
}

const COLUMNS: Column[] = [
  { header: "Date", width: 12 },
  { header: "Vendor", width: 28 },
  { header: "Description", width: 36 },
  { header: "Category", width: 16 },
  { header: "Type", width: 12 },
  { header: "Number", width: 18 },
  { header: "Total", width: 12 },
  { header: "VAT", width: 10 },
  { header: "Currency", width: 10 },
  { header: "Notes", width: 30 },
  { header: "File", width: 48 },
];

// Zips the documents with a Summary.xlsx listing each one.
export async function downloadZip(
  supabase: Client,
  docs: Doc[],
  zipName: string,
  onProgress: (done: number, total: number) => void,
) {
  const names = uniqueNames(docs);
  const entries: ZipEntry[] = new Array(docs.length);
  let done = 0;
  onProgress(0, docs.length);

  await eachLimit(docs, 4, async (doc, i) => {
    const blob = await fetchFile(supabase, doc);
    entries[i] = { name: names[i], data: new Uint8Array(await blob.arrayBuffer()), date: fromISODate(doc.doc_date) };
    onProgress(++done, docs.length);
  });

  const rows: Cell[][] = docs.map((doc, i) => [
    { type: "date", value: doc.doc_date },
    { type: "text", value: doc.vendor },
    { type: "text", value: doc.description },
    { type: "text", value: doc.category },
    { type: "text", value: docTypeLabel(doc.doc_type) || null },
    { type: "text", value: doc.invoice_number },
    { type: "number", value: doc.total },
    { type: "number", value: doc.tax },
    { type: "text", value: doc.currency },
    { type: "text", value: doc.notes },
    { type: "text", value: names[i] },
  ]);
  const summary = await createXlsx("Documents", COLUMNS, rows);

  saveBlob(createZip([{ name: "Summary.xlsx", data: summary }, ...entries]), `${sanitizeFileName(zipName)}.zip`);
}

function uniqueNames(docs: Doc[]) {
  const seen = new Map<string, number>();
  return docs.map((doc) => {
    const name = downloadName(doc);
    const key = name.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? name : name.replace(/(\.[^.]+)$/, ` (${count + 1})$1`);
  });
}
