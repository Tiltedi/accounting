// Server-only: an email laid out as a clean A4 PDF (subject, From/To/Date,
// text), for emails that are themselves the document. Forwarded emails show
// the original message; signature pictures and raw link addresses are left out.
import { PDFDocument, rgb, StandardFonts, type PDFPage } from "pdf-lib";

export type Email = { from: string | null; to: string | null; date: string | null; subject: string | null; text: string };

const PAGE: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const WIDTH = PAGE[0] - 2 * MARGIN;
const INK = rgb(0.1, 0.1, 0.09);
const MUTED = rgb(0.45, 0.45, 0.42);
const RULE = rgb(0.85, 0.84, 0.8);

const FORWARD = /^-{3,}\s*(forwarded message|doorgestuurd bericht|message transf[ée]r[ée]|weitergeleitete nachricht)\s*-{3,}\s*$/im;
const FIELDS: Record<string, keyof Omit<Email, "text">> = {
  from: "from", van: "from", de: "from", von: "from",
  to: "to", aan: "to", "à": "to", a: "to", an: "to",
  date: "date", datum: "date", sent: "date", verzonden: "date", envoyé: "date", gesendet: "date",
  subject: "subject", onderwerp: "subject", objet: "subject", betreff: "subject",
};

// Shows the forwarded message as the email, noting who forwarded it.
function unwrapForward(email: Email): Email & { forwardedBy: string | null } {
  const match = FORWARD.exec(email.text);
  if (!match) return { ...email, forwardedBy: null };
  const lines = email.text.slice(match.index + match[0].length).replace(/^\n+/, "").split("\n");
  const original: Email = { from: null, to: null, date: null, subject: null, text: "" };
  let i = 0;
  for (; i < lines.length; i++) {
    const field = /^([A-Za-zÀ-ÿ]+):\s*(.*)$/.exec(lines[i].trim());
    if (!field || !FIELDS[field[1].toLowerCase()]) break;
    original[FIELDS[field[1].toLowerCase()]] = field[2].replace(/^<([^<>]*)>$/, "$1") || null;
  }
  original.text = lines.slice(i).join("\n");
  const by = [email.from?.replace(/\s*<[^>]*>/, ""), email.date].filter(Boolean).join(", ");
  return {
    from: original.from ?? email.from,
    to: original.to ?? email.to,
    date: original.date ?? email.date,
    subject: original.subject ?? email.subject,
    text: original.text,
    forwardedBy: by || null,
  };
}

function cleanText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/\[image:[^\]]*\]\s*(<[^>\s]+>)?/gi, "") // signature and layout pictures
    .replace(/\s*<(https?:|mailto:)[^>\s]+>/gi, "") // link addresses after their text
    .split("\n")
    .map((line) => line.replace(/\t/g, "    ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([^\n]{60,})\n(?=[a-zà-ÿ(])/g, "$1 ") // undo plain-text wrapping (~76 characters) mid-sentence
    .trim();
}

type Word = { text: string; bold: boolean; glue?: boolean }; // glue: no space before

export async function emailToPdf(email: Email, savedFrom: string) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set(regular.getCharacterSet());
  const safe = (s: string) =>
    [...s.normalize("NFC")].map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : ch === "→" ? "->" : "?")).join("");

  const mail = unwrapForward(email);
  pdf.setTitle(safe(mail.subject ?? "Email"));

  let page: PDFPage = pdf.addPage(PAGE);
  let y = PAGE[1] - MARGIN;
  const room = (needed: number) => {
    if (y - needed >= MARGIN + 20) return;
    page = pdf.addPage(PAGE);
    y = PAGE[1] - MARGIN;
  };

  // Lays out words in lines of at most `width`, breaking over-long words.
  const layout = (words: Word[], size: number, width: number) => {
    const lines: Word[][] = [];
    let line: Word[] = [];
    let used = 0;
    const space = regular.widthOfTextAtSize(" ", size);
    for (const word of words) {
      const font = word.bold ? bold : regular;
      let w = font.widthOfTextAtSize(word.text, size);
      const gap = line.length && !word.glue ? space : 0;
      if (line.length && used + gap + w > width) {
        lines.push(line);
        line = [];
        used = 0;
      }
      let text = word.text;
      while (w > width) {
        let cut = text.length;
        while (cut > 1 && font.widthOfTextAtSize(text.slice(0, cut), size) > width) cut--;
        lines.push([{ text: text.slice(0, cut), bold: word.bold }]);
        text = text.slice(cut);
        w = font.widthOfTextAtSize(text, size);
      }
      line.push({ text, bold: word.bold, glue: line.length > 0 && word.glue });
      used += (line.length > 1 && !word.glue ? space : 0) + w;
    }
    if (line.length) lines.push(line);
    return lines;
  };

  const draw = (lines: Word[][], x: number, size: number, leading: number, color = INK) => {
    const space = regular.widthOfTextAtSize(" ", size);
    for (const line of lines) {
      room(leading);
      let cx = x;
      line.forEach((word, i) => {
        const font = word.bold ? bold : regular;
        if (i > 0 && !word.glue) cx += space;
        page.drawText(word.text, { x: cx, y: y - size, size, font, color });
        cx += font.widthOfTextAtSize(word.text, size);
      });
      y -= leading;
    }
  };

  const words = (text: string, isBold = false): Word[] =>
    safe(text)
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => ({ text: w, bold: isBold }));

  // *bold* runs, as Gmail writes them in plain text.
  const styled = (line: string): Word[] => {
    const parts = line.split("*");
    if (parts.length < 3) return words(line);
    return parts.flatMap((part, i) => {
      const list = words(part, i % 2 === 1);
      if (list.length && i > 0 && !/^\s/.test(part) && !/\s$/.test(parts[i - 1])) list[0].glue = true;
      return list;
    });
  };

  // Header: subject, then From / To / Date.
  draw(layout(words(mail.subject || "(no subject)", true), 15, WIDTH), MARGIN, 15, 20);
  y -= 6;
  const label = 46;
  for (const [name, value] of [["From", mail.from], ["To", mail.to], ["Date", mail.date]] as const) {
    if (!value) continue;
    const lines = layout(words(value), 9.5, WIDTH - label);
    room(13);
    page.drawText(name, { x: MARGIN, y: y - 9.5, size: 9.5, font: regular, color: MUTED });
    draw(lines, MARGIN + label, 9.5, 13);
  }
  if (mail.forwardedBy) {
    room(13);
    draw(layout(words(`Forwarded by ${mail.forwardedBy}`), 8.5, WIDTH), MARGIN, 8.5, 12, MUTED);
  }
  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: 0.7, color: RULE });
  y -= 16;

  // Body.
  for (const line of cleanText(mail.text).split("\n")) {
    if (!line.trim()) {
      y -= 7;
      continue;
    }
    draw(layout(styled(line), 10.5, WIDTH), MARGIN, 10.5, 15);
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const footer = safe(`Saved from ${savedFrom}${pages.length > 1 ? ` · page ${i + 1} of ${pages.length}` : ""}`);
    p.drawText(footer, { x: MARGIN, y: MARGIN - 24, size: 7.5, font: regular, color: MUTED });
  });

  // Fixed dates keep the same email byte-identical, so re-imports are recognised.
  const fixed = new Date(0);
  pdf.setCreationDate(fixed);
  pdf.setModificationDate(fixed);
  pdf.setProducer("Accounting");
  pdf.setCreator("Accounting");
  return Buffer.from(await pdf.save());
}
