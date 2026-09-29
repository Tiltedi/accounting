// Date ranges use inclusive ISO dates ("YYYY-MM-DD"); null means open-ended.
export type DateRange = { from: string | null; to: string | null };

export type PresetId =
  | "all"
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "last-quarter"
  | "this-year"
  | "last-year";

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "this-quarter", label: "This quarter" },
  { id: "last-quarter", label: "Last quarter" },
  { id: "this-year", label: "This year" },
  { id: "last-year", label: "Last year" },
];

export const ALL_TIME: DateRange = { from: null, to: null };

export function toISODate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function fromISODate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO() {
  return toISODate(new Date());
}

function monthRange(year: number, month: number): DateRange {
  return { from: toISODate(new Date(year, month, 1)), to: toISODate(new Date(year, month + 1, 0)) };
}

function monthsRange(year: number, firstMonth: number, months: number): DateRange {
  return {
    from: toISODate(new Date(year, firstMonth, 1)),
    to: toISODate(new Date(year, firstMonth + months, 0)),
  };
}

export function presetRange(id: PresetId, today = new Date()): DateRange {
  const y = today.getFullYear();
  const m = today.getMonth();
  const q = Math.floor(m / 3) * 3;
  switch (id) {
    case "all":
      return ALL_TIME;
    case "this-month":
      return monthRange(y, m);
    case "last-month":
      return monthRange(y, m - 1);
    case "this-quarter":
      return monthsRange(y, q, 3);
    case "last-quarter":
      return monthsRange(y, q - 3, 3);
    case "this-year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last-year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  }
}

export function sameRange(a: DateRange, b: DateRange) {
  return a.from === b.from && a.to === b.to;
}

export function inRange(iso: string, range: DateRange) {
  return (range.from === null || iso >= range.from) && (range.to === null || iso <= range.to);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function lastDayOfMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}

// Short, human label: "All time", "September 2026", "Q3 2026", "2026", "3 – 18 Sep 2026".
export function rangeLabel(range: DateRange) {
  if (!range.from && !range.to) return "All time";
  if (!range.from) return `Until ${dayLabel(range.to!)}`;
  if (!range.to) return `From ${dayLabel(range.from)}`;

  const a = parts(range.from);
  const b = parts(range.to);
  const wholeMonths = a.d === 1 && b.d === lastDayOfMonth(b.y, b.m);

  if (wholeMonths && a.y === b.y) {
    if (a.m === b.m) return `${LONG_MONTHS[a.m - 1]} ${a.y}`;
    if (a.m === 1 && b.m === 12) return `${a.y}`;
    if (b.m - a.m === 2 && (a.m - 1) % 3 === 0) return `Q${(a.m - 1) / 3 + 1} ${a.y}`;
  }

  if (range.from === range.to) return dayLabel(range.from);
  if (a.y === b.y && a.m === b.m) return `${a.d} – ${b.d} ${MONTHS[a.m - 1]} ${a.y}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${a.y}`;
  return `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
}

function dayLabel(iso: string) {
  const { y, m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
