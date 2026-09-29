// Browser-only helpers for preparing, hashing and saving files.

export type ScanPage = { blob: Blob; width: number; height: number; url: string };

// Decodes an image (EXIF orientation applied) and re-encodes it as a JPEG no
// larger than `maxDim` on its long side.
export async function imageToJpeg(file: Blob, maxDim = 2400, quality = 0.82) {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    await img.decode();
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not encode image"))),
        "image/jpeg",
        quality,
      ),
    );
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(src);
  }
}

// Builds a PDF with one JPEG per page (A4 width, page height follows the photo).
export async function jpegsToPdf(pages: { blob: Blob; width: number; height: number }[]) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const startObject = (n: number) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
  };

  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker

  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  startObject(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  startObject(2);
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  for (let i = 0; i < pages.length; i++) {
    const { blob, width, height } = pages[i];
    const pageWidth = 595.28;
    const pageHeight = Math.round(((pageWidth * height) / width) * 100) / 100;
    const page = 3 + i * 3;
    const image = page + 1;
    const content = page + 2;

    startObject(page);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        `/Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>\nendobj\n`,
    );

    const jpeg = new Uint8Array(await blob.arrayBuffer());
    startObject(image);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    );
    push(jpeg);
    push("\nendstream\nendobj\n");

    const draw = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;
    startObject(content);
    push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream\nendobj\n`);
  }

  const size = 3 + pages.length * 3;
  const xrefOffset = length;
  let xref = `xref\n0 ${size}\n0000000000 65535 f\r\n`;
  for (let n = 1; n < size; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n\r\n`;
  push(xref);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}

export async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Browsers can drop a download name with non-ASCII characters and save the
// file as "download", so transliterate: "Café – Größe" → "Cafe - Grosse".
export function asciiFileName(name: string) {
  return (
    name
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u2010-\u2015\u00b7\u2022]/g, "-")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "document"
  );
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = asciiFileName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

export function extensionFor(mime: string, fileName = "") {
  const fromName = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return EXTENSIONS[mime] ?? (fromName || "bin");
}

export function sanitizeFileName(name: string) {
  return (
    name
      .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "document"
  );
}

// "2026-09-12 Amazon 49.90 EUR.pdf"
export function downloadName(doc: {
  doc_date: string;
  vendor: string | null;
  file_name: string;
  total: number | null;
  currency: string | null;
  mime_type: string;
}) {
  const stem = doc.vendor || doc.file_name.replace(/\.[^.]+$/, "");
  const amount = doc.total != null ? ` ${doc.total.toFixed(2)}${doc.currency ? ` ${doc.currency}` : ""}` : "";
  return `${sanitizeFileName(`${doc.doc_date} ${stem}${amount}`)}.${extensionFor(doc.mime_type, doc.file_name)}`;
}

// Returns a function that runs tasks with at most `limit` in flight.
export function createLimiter(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= limit || queue.length === 0) return;
    active++;
    queue.shift()!();
  };
  return function run<T>(task: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}

// Runs `task` over `items` with at most `limit` in flight.
export async function eachLimit<T>(items: T[], limit: number, task: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index], index);
    }
  });
  await Promise.all(workers);
}
