"use client";

import { useState } from "react";
import { Ban, Search, Upload } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/dialog";
import { FileButton } from "@/components/file-button";
import { expectedAmount, nameScore, type Transaction } from "@/lib/bank";
import type { Doc } from "@/lib/documents";
import { formatDay, formatMoney } from "@/lib/format";

// Pick the receipt for a bank line: closest amounts and dates first.
export function AttachDialog({
  tx,
  docs,
  linkedDocIds,
  onClose,
  onPick,
  onUpload,
  onNoReceipt,
}: {
  tx: Transaction | null;
  docs: Doc[];
  linkedDocIds: Set<string>;
  onClose: () => void;
  onPick: (doc: Doc) => void;
  onUpload: (file: File) => void;
  onNoReceipt: () => void;
}) {
  return (
    <Dialog open={tx !== null} onClose={onClose} width={560} label="Add receipt">
      {tx && (
        <Picker key={tx.id} tx={tx} docs={docs} linkedDocIds={linkedDocIds} onClose={onClose} onPick={onPick} onUpload={onUpload} onNoReceipt={onNoReceipt} />
      )}
    </Dialog>
  );
}

function Picker({
  tx,
  docs,
  linkedDocIds,
  onClose,
  onPick,
  onUpload,
  onNoReceipt,
}: {
  tx: Transaction;
  docs: Doc[];
  linkedDocIds: Set<string>;
  onClose: () => void;
  onPick: (doc: Doc) => void;
  onUpload: (file: File) => void;
  onNoReceipt: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const txDay = Date.parse(`${tx.booked_on}T00:00:00Z`);

  const ranked = docs
    .filter((d) => !linkedDocIds.has(d.id))
    .filter((d) => !q || `${d.vendor ?? ""} ${d.description ?? ""} ${d.file_name} ${d.total?.toFixed(2) ?? ""}`.toLowerCase().includes(q))
    .map((d) => {
      const expected = expectedAmount(d);
      const amountGap = expected == null ? 1 : Math.min(1, Math.abs(expected - tx.amount) / Math.max(1, Math.abs(tx.amount)));
      const dayGap = Math.min(1, Math.abs(txDay - Date.parse(`${d.doc_date}T00:00:00Z`)) / 86_400_000 / 90);
      return { doc: d, score: amountGap * 2 + dayGap - nameScore(d.vendor, tx) };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 40);

  return (
    <>
      <DialogHeader
        title={
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate">{tx.counterparty || tx.description || "Payment"}</span>
            <span className="nums shrink-0 text-sm font-medium text-muted">
              {tx.amount < 0 ? "−" : "+"}
              {formatMoney(Math.abs(tx.amount), tx.currency)}
            </span>
          </span>
        }
        onClose={onClose}
      />
      <div className="flex gap-2 border-b border-rule px-5 py-3">
        <FileButton
          accept="application/pdf,image/*"
          onFiles={(files) => onUpload(files[0])}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-accent text-sm font-semibold text-accent-ink hover:bg-accent-hover"
        >
          <Upload className="size-4" /> Upload receipt
        </FileButton>
        <button
          type="button"
          onClick={onNoReceipt}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full border border-rule-strong text-sm font-semibold hover:bg-ink/5"
        >
          <Ban className="size-4" /> No receipt needed
        </button>
      </div>
      <div className="relative px-5 pt-3">
        <Search className="pointer-events-none absolute top-1/2 left-8.5 mt-1.5 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a document"
          aria-label="Find a document"
          className="h-10 w-full rounded-full border border-rule-strong bg-card pr-4 pl-10 text-base outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-[0.95rem]"
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {ranked.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No documents to choose from.</li>}
        {ranked.map(({ doc }) => (
          <li key={doc.id}>
            <button type="button" onClick={() => onPick(doc)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-ink/5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{doc.vendor || doc.file_name}</span>
                <span className="block truncate text-[0.8rem] text-muted">
                  <span className="tabular-nums">{formatDay(doc.doc_date)}</span> · {doc.category}
                </span>
              </span>
              <span className="nums shrink-0 text-sm font-medium">{doc.total != null ? formatMoney(doc.total, doc.currency) : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
