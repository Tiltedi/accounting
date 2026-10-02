import type { Match, Source, Transaction } from "@/lib/bank";
import type { Doc } from "@/lib/documents";

// Numbers for the Home page. Everything is derived from the same rows and
// rules as the Bank, Card and Documents pages, so the counts agree with theirs.

// ----- Quarters ("2026-Q3") ------------------------------------------------------

export function quarterOf(iso: string) {
  return `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
}

function parseQuarter(quarter: string) {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  return match ? { year: Number(match[1]), q: Number(match[2]) } : null;
}

// "2026-Q3" → ["2026-07", "2026-08", "2026-09"]; null for anything else.
export function quarterMonths(quarter: string) {
  const parsed = parseQuarter(quarter);
  if (!parsed) return null;
  return [1, 2, 3].map((i) => `${parsed.year}-${String((parsed.q - 1) * 3 + i).padStart(2, "0")}`);
}

export function shiftQuarter(quarter: string, by: number) {
  const { year, q } = parseQuarter(quarter)!;
  const index = year * 4 + (q - 1) + by;
  return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
}

// "2026-Q3" → "Q3 2026"
export function quarterLabel(quarter: string) {
  const { year, q } = parseQuarter(quarter)!;
  return `Q${q} ${year}`;
}

// The quarter the accountant asks for next: the last one that has ended.
export function lastFullQuarter(today: string) {
  return shiftQuarter(quarterOf(today), -1);
}

function inQuarter(iso: string, quarter: string) {
  return quarterOf(iso) === quarter;
}

// ----- What's left to do -----------------------------------------------------------

// Same split as the Bank and Card tabs: handled lines, lines with a suggested
// receipt (To approve) and the rest (Missing receipt).
export function lineState(tx: Transaction, suggested: Set<string>): "done" | "check" | "missing" {
  if (tx.status === "matched" || tx.status === "no_receipt") return "done";
  return suggested.has(tx.id) ? "check" : "missing";
}

export function todoCounts(txs: Transaction[], matches: Match[]) {
  const suggested = new Set(matches.map((m) => m.txId));
  const counts: Record<Source, { missing: number; check: number }> = { bank: { missing: 0, check: 0 }, card: { missing: 0, check: 0 } };
  for (const t of txs) {
    const state = lineState(t, suggested);
    if (state !== "done") counts[t.source][state]++;
  }
  return counts;
}

export type QuarterCheck = {
  lines: number;
  done: number;
  missing: Record<Source, number>;
  check: Record<Source, number>;
  missingOut: number; // money out (EUR) still without a receipt
  docs: number;
  unbooked: number;
};

// Is the quarter ready for the accountant: every bank and card line has a
// receipt or needs none.
export function quarterCheck(txs: Transaction[], docs: Doc[], matches: Match[], quarter: string): QuarterCheck {
  const suggested = new Set(matches.map((m) => m.txId));
  const result: QuarterCheck = {
    lines: 0,
    done: 0,
    missing: { bank: 0, card: 0 },
    check: { bank: 0, card: 0 },
    missingOut: 0,
    docs: 0,
    unbooked: 0,
  };
  for (const t of txs) {
    if (!inQuarter(t.booked_on, quarter)) continue;
    result.lines++;
    const state = lineState(t, suggested);
    if (state === "done") result.done++;
    else result[state][t.source]++;
    if (state === "missing" && t.amount < 0 && t.currency === "EUR") result.missingOut -= t.amount;
  }
  for (const d of docs) {
    if (!inQuarter(d.doc_date, quarter)) continue;
    result.docs++;
    if (!d.booked_at) result.unbooked++;
  }
  return result;
}

// ----- Spending --------------------------------------------------------------------

// The 12 months up to and including the current one, oldest first.
export function lastMonths(today: string, count = 12) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, i) => {
    const index = year * 12 + month - (count - 1 - i);
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
}

// Bank lines that pay a card statement. The card lines already hold those
// purchases, so counting both would count the spending twice. Found by the
// link to the statement, or else by the statement's total paid from the bank
// within two months (whatever its status or any dismissed suggestion).
export function cardSettlements(txs: Transaction[], docs: Doc[]) {
  const found = new Set<string>();
  const statements = docs.filter((d) => d.doc_type === "statement");
  const ids = new Set(statements.map((d) => d.id));
  for (const t of txs) if (t.source === "bank" && t.document_id && ids.has(t.document_id)) found.add(t.id);
  for (const statement of statements) {
    if (txs.some((t) => t.document_id === statement.id && t.source === "bank") || statement.total == null) continue;
    const lag = (t: Transaction) => (Date.parse(t.booked_on) - Date.parse(statement.doc_date)) / 86_400_000;
    const payment = txs
      .filter(
        (t) =>
          t.source === "bank" &&
          !found.has(t.id) &&
          !t.document_id &&
          Math.abs(-t.amount - statement.total!) < 0.005 &&
          t.currency === (statement.currency ?? "EUR") &&
          lag(t) >= -7 &&
          lag(t) <= 60,
      )
      .sort((a, b) => Math.abs(lag(a)) - Math.abs(lag(b)))[0];
    if (payment) found.add(payment.id);
  }
  return found;
}

// Money out per month, bank and card together, each purchase once (see
// cardSettlements). Only euro lines count (foreign ones are reported apart).
export function monthlyOut(txs: Transaction[], docs: Doc[], months: string[]) {
  const settlements = cardSettlements(txs, docs);
  const sums = new Map(months.map((month) => [month, 0]));
  let foreign = 0;
  for (const t of txs) {
    const month = t.booked_on.slice(0, 7);
    if (t.amount >= 0 || !sums.has(month) || (t.source === "bank" && settlements.has(t.id))) continue;
    if (t.currency !== "EUR") foreign++;
    else sums.set(month, sums.get(month)! - t.amount);
  }
  return { months: months.map((month) => ({ month, amount: Math.round(sums.get(month)! * 100) / 100 })), foreign };
}

// Document totals per category over the given months (euro documents only;
// card statements left out, their purchases have their own receipts).
export function byCategory(docs: Doc[], months: string[]) {
  const wanted = new Set(months);
  const sums = new Map<string, { amount: number; count: number }>();
  let foreign = 0;
  for (const d of docs) {
    if (d.total == null || d.doc_type === "statement" || !wanted.has(d.doc_date.slice(0, 7))) continue;
    if (d.currency !== "EUR") {
      foreign++;
      continue;
    }
    const key = d.category || "Other";
    const sum = sums.get(key) ?? { amount: 0, count: 0 };
    sum.amount += d.total;
    sum.count++;
    sums.set(key, sum);
  }
  const rows = [...sums]
    .map(([category, sum]) => ({ category, amount: Math.round(sum.amount * 100) / 100, count: sum.count }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  if (rows.length <= 6) return { rows, foreign };
  // Six bars at most: the rest folds into "Other".
  const keep = rows.filter((row) => row.category !== "Other").slice(0, 5);
  const other = { category: "Other", amount: 0, count: 0 };
  for (const row of rows) {
    if (keep.includes(row)) continue;
    other.amount += row.amount;
    other.count += row.count;
  }
  return { rows: [...keep, { ...other, amount: Math.round(other.amount * 100) / 100 }], foreign };
}

// A rounded top for a chart axis: 1, 2, 2.5 or 5 times a power of ten.
export function niceMax(value: number) {
  if (value <= 0) return 100;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= value)!;
  return step * power;
}
