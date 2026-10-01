// Fixed locale so server and browser render identical text.
const LOCALE = "en-GB";

const moneyFormats = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: string | null) {
  const key = currency ?? "";
  let format = moneyFormats.get(key);
  if (!format) {
    format = currency
      ? new Intl.NumberFormat(LOCALE, { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      : new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    moneyFormats.set(key, format);
  }
  return format.format(amount);
}

// Month names are spelled out here (not Intl) so every runtime prints the same text.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "2026-09-12" → "12 Sep 2026"
export function formatDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// "2026-09-12" → "12 Sep"
export function formatShortDay(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

// "2026-09" → "September 2026"
export function formatMonth(isoMonth: string) {
  const [y, m] = isoMonth.split("-").map(Number);
  return `${LONG_MONTHS[m - 1]} ${y}`;
}

// "2026-09" → "September"
export function monthName(isoMonth: string) {
  return LONG_MONTHS[Number(isoMonth.slice(5, 7)) - 1];
}

// "2026-09" → "Sep"
export function formatShortMonth(isoMonth: string) {
  return MONTHS[Number(isoMonth.slice(5, 7)) - 1];
}

// Sums amounts per currency, largest first.
// Card statements are left out: their purchases have receipts of their own.
export function totalsByCurrency(docs: { total: number | null; currency: string | null; doc_type?: string | null }[]) {
  const sums = new Map<string, number>();
  for (const doc of docs) {
    if (doc.total == null || doc.doc_type === "statement") continue;
    const key = doc.currency ?? "";
    sums.set(key, (sums.get(key) ?? 0) + doc.total);
  }
  return [...sums.entries()]
    .map(([currency, total]) => ({ currency: currency || null, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

// Parses "1.234,56", "1,234.56", "1.234", "49,9" or "-49.90" into a number.
export function parseAmount(input: string): number | null {
  const negative = /^\s*-/.test(input);
  let s = input.replace(/[^\d,.]/g, "");
  if (!/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: the last one is the decimal separator.
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    s = s.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const count = s.split(sep).length - 1;
    const digitsAfter = s.length - s.lastIndexOf(sep) - 1;
    // "1.234" / "1,234,567" are thousands; "49,9" / "49.90" are decimals.
    s = count > 1 || digitsAfter === 3 ? s.split(sep).join("") : s.replace(sep, ".");
  }

  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return (negative ? -1 : 1) * Math.round(value * 100) / 100;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
