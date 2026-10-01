import { docTypeLabel } from "@/lib/categories";
import { fromISODate } from "@/lib/dates";
import { BUCKET, compareDocs, isImage, type Client, type Doc } from "@/lib/documents";
import { downloadName, eachLimit, imageToJpeg, jpegsToPdf, sanitizeFileName, saveBlob } from "@/lib/files";
import { monthName } from "@/lib/format";
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

// Zips the documents with a Summary.xlsx listing each one. `byMonth` makes the
// package for the accounting tool: oldest first, a folder per month holding
// only documents ("2026-07 July/…"), and pictures turned into PDFs.
export async function downloadZip(
  supabase: Client,
  docs: Doc[],
  zipName: string,
  onProgress: (done: number, total: number) => void,
  { byMonth = false } = {},
) {
  const list = byMonth ? [...docs].sort((a, b) => compareDocs(b, a)) : docs;
  const files: { data: Uint8Array; mime: string }[] = new Array(list.length);
  let done = 0;
  onProgress(0, list.length);

  await eachLimit(list, 4, async (doc, i) => {
    const blob = await fetchFile(supabase, doc);
    files[i] = byMonth && isImage(doc) ? await imageAsPdf(blob, doc.mime_type) : { data: await bytes(blob), mime: doc.mime_type };
    onProgress(++done, list.length);
  });

  const names = uniqueNames(
    list.map((doc, i) => {
      const name = downloadName({ ...doc, mime_type: files[i].mime });
      return byMonth ? `${monthFolder(doc.doc_date)}/${name}` : name;
    }),
  );
  const entries: ZipEntry[] = list.map((doc, i) => ({ name: names[i], data: files[i].data, date: fromISODate(doc.doc_date) }));

  const rows: Cell[][] = list.map((doc, i) => [
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

async function bytes(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

// A picture as a one-page PDF, for tools that only take PDFs. Keeps the
// original when the browser can't decode it (e.g. HEIC outside Safari).
async function imageAsPdf(blob: Blob, mime: string) {
  try {
    const page = await imageToJpeg(new Blob([blob], { type: mime }), 2400, 0.9);
    return { data: await bytes(await jpegsToPdf([page])), mime: "application/pdf" };
  } catch {
    return { data: await bytes(blob), mime };
  }
}

// "2026-07-21" → "2026-07 July": sorts in order and reads well.
function monthFolder(isoDate: string) {
  const month = isoDate.slice(0, 7);
  return `${month} ${monthName(month)}`;
}

function uniqueNames(names: string[]) {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? name : name.replace(/(\.[^.]+)$/, ` (${count + 1})$1`);
  });
}
