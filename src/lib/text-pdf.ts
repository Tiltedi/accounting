// Server-only: a plain A4 PDF of some text (an email kept as a document).
// Courier keeps line wrapping exact without font metrics; text is encoded as
// Windows-1252 (covers Dutch, French, German and €), other characters become "?".

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const SIZE = 9.5;
const LEADING = 13;
const CHARS = Math.floor((PAGE_W - 2 * MARGIN) / (SIZE * 0.6));
const LINES = Math.floor((PAGE_H - 2 * MARGIN) / LEADING);

// Unicode → Windows-1252 bytes 0x80–0x9F; Latin-1 maps to itself.
const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a,
  "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

function encode(text: string) {
  const bytes: number[] = [];
  for (const ch of text.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    const byte = CP1252[ch] ?? (code >= 0x20 && code <= 0xff && !(code >= 0x7f && code < 0xa0) ? code : code === 0x09 ? 0x20 : 0x3f);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c); // escape ( ) \
    bytes.push(byte);
  }
  return Buffer.from(bytes);
}

function wrap(text: string) {
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = raw.replace(/\t/g, "    ").trimEnd();
    if (!line) {
      lines.push("");
      continue;
    }
    while (line.length > CHARS) {
      const space = line.lastIndexOf(" ", CHARS);
      const cut = space > CHARS * 0.5 ? space : CHARS; // long words (URLs) are cut hard
      lines.push(line.slice(0, cut).trimEnd());
      line = line.slice(cut).trimStart();
    }
    lines.push(line);
  }
  return lines;
}

export function textToPdf(text: string) {
  const lines = wrap(text);
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += LINES) pages.push(lines.slice(i, i + LINES));

  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: Buffer | string) => {
    const buf = typeof part === "string" ? Buffer.from(part, "latin1") : part;
    chunks.push(buf);
    length += buf.length;
  };
  const object = (n: number, body: Buffer | string) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    push(body);
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  object(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  pages.forEach((page, i) => {
    const content = Buffer.concat([
      Buffer.from(`BT /F1 ${SIZE} Tf ${LEADING} TL ${MARGIN} ${PAGE_H - MARGIN - SIZE} Td\n`, "latin1"),
      ...page.map((line) => Buffer.concat([Buffer.from("(", "latin1"), encode(line), Buffer.from(") '\n", "latin1")])),
      Buffer.from("ET", "latin1"),
    ]);
    object(
      4 + i * 2,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    object(5 + i * 2, Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "latin1"), content, Buffer.from("\nendstream", "latin1")]));
  });

  const size = 4 + pages.length * 2;
  const xref = length;
  let table = `xref\n0 ${size}\n0000000000 65535 f\r\n`;
  for (let n = 1; n < size; n++) table += `${String(offsets[n]).padStart(10, "0")} 00000 n\r\n`;
  push(table);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}
