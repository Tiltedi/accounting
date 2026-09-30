import { toast } from "@/components/toaster";
import { findMatches, type Match, type Transaction } from "@/lib/bank";
import type { Doc } from "@/lib/documents";
import { formatDay, formatMoney } from "@/lib/format";

// After a new receipt is read: offer its payment for one-tap approval.
// Nothing is linked unless approved; ignored offers wait under To approve.
export function offerMatch(
  doc: Doc,
  context: { txs: Transaction[]; docs: Doc[]; dismissed: Set<string> },
  onApprove: (match: Match) => void,
  { announceNone = false } = {},
) {
  if (doc.status !== "ready" || doc.doc_type === "statement") return;
  const docs = context.docs.some((d) => d.id === doc.id) ? context.docs.map((d) => (d.id === doc.id ? doc : d)) : [...context.docs, doc];
  const match = findMatches(context.txs, docs, context.dismissed).find((m) => m.docId === doc.id);
  const name = doc.vendor || doc.file_name;
  const tx = match && context.txs.find((t) => t.id === match.txId);
  if (!match || !tx) {
    if (announceNone) toast(`${name}: no matching payment yet · kept in Documents`, { duration: 6000 });
    return;
  }
  const where = tx.source === "card" ? "card payment" : "bank payment";
  toast(`${name} ${formatMoney(Math.abs(tx.amount), tx.currency)} → ${where} ${tx.counterparty ?? ""}, ${formatDay(tx.booked_on)}`, {
    duration: 12000,
    action: { label: "Approve", onClick: () => onApprove(match) },
  });
}
