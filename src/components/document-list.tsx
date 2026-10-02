"use client";

import { memo, useEffect, useState } from "react";
import { CircleCheck, Download, FileText, Image as ImageIcon, Landmark } from "lucide-react";
import type { Transaction } from "@/lib/bank";
import { isImage, type Doc } from "@/lib/documents";
import { toISODate } from "@/lib/dates";
import { formatDay, formatMoney, formatMonth, formatShortDay, totalsByCurrency } from "@/lib/format";

// "added": newest uploads first, grouped by the day they were added; "date": by document date, per month.
export type ListOrder = "added" | "date";

type Props = {
  docs: Doc[];
  order: ListOrder;
  selected: Set<string>;
  reading: Set<string>;
  fresh: Set<string>;
  paid: Map<string, Transaction>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onDownload: (doc: Doc) => void;
};

export function DocumentList({ docs, order, selected, reading, fresh, paid, onToggle, onOpen, onDownload }: Props) {
  // Upload days use the browser's time zone once mounted; the server render uses UTC so both match.
  const [local, setLocal] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- switch to local days after hydration
    setLocal(true);
  }, []);
  const day = (iso: string) => (local ? toISODate(new Date(iso)) : iso.slice(0, 10));

  const groups: { key: string; label: string; docs: Doc[] }[] = [];
  for (const doc of docs) {
    const key = order === "added" ? day(doc.created_at) : doc.doc_date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.docs.push(doc);
    else groups.push({ key, label: order === "added" ? addedLabel(key, day(new Date().toISOString())) : formatMonth(key), docs: [doc] });
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.key} className="[content-visibility:auto] [contain-intrinsic-size:auto_600px]">
          <GroupHeader label={group.label} docs={group.docs} />
          <ul className="isolate overflow-hidden rounded-2xl border border-rule bg-card shadow-card">
            {group.docs.map((doc) => (
              <Row
                key={doc.id}
                doc={doc}
                checked={selected.has(doc.id)}
                reading={reading.has(doc.id) || doc.status === "processing"}
                fresh={fresh.has(doc.id)}
                paid={paid.has(doc.id)}
                onToggle={onToggle}
                onOpen={onOpen}
                onDownload={onDownload}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// "Added today", "Added yesterday", "Added 28 Sep 2026".
function addedLabel(day: string, today: string) {
  const yesterday = toISODate(new Date(new Date(`${today}T12:00:00`).getTime() - 86_400_000));
  return day === today ? "Added today" : day === yesterday ? "Added yesterday" : `Added ${formatDay(day)}`;
}

// Stays pinned under the header while its group scrolls by.
function GroupHeader({ label, docs }: { label: string; docs: Doc[] }) {
  const totals = totalsByCurrency(docs);
  return (
    <h3 className="sticky top-16 z-10 flex items-baseline gap-3 bg-paper/90 px-1 pt-2.5 pb-2 text-[0.7rem] font-semibold tracking-[0.14em] text-muted uppercase backdrop-blur-md">
      <span>{label}</span>
      <span className="h-px flex-1 translate-y-[-0.2em] bg-rule" aria-hidden="true" />
      <span className="nums tracking-normal normal-case">
        {totals.map((t) => formatMoney(t.total, t.currency)).join(" · ")}
      </span>
    </h3>
  );
}

const Row = memo(function Row({
  doc,
  checked,
  reading,
  fresh,
  paid,
  onToggle,
  onOpen,
  onDownload,
}: {
  doc: Doc;
  checked: boolean;
  reading: boolean;
  fresh: boolean;
  paid: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onDownload: (doc: Doc) => void;
}) {
  const title = doc.vendor || doc.file_name;
  const Icon = isImage(doc) ? ImageIcon : FileText;

  return (
    <li
      className={`group relative flex items-center gap-3 border-b border-rule px-3 py-3 transition-colors duration-150 last:border-b-0 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent before:transition-opacity sm:gap-4 sm:px-4 ${
        checked ? "bg-accent-soft/60 before:opacity-100" : "before:opacity-0 hover:bg-ink/[0.025]"
      } ${fresh ? "animate-row-in" : ""}`}
    >
      <label className="relative z-10 -m-2 grid size-10 shrink-0 cursor-pointer place-items-center">
        <input type="checkbox" checked={checked} onChange={() => onToggle(doc.id)} aria-label={`Select ${title}`} className="checkbox" />
      </label>

      <span className="nums hidden w-16 shrink-0 text-sm text-muted sm:block">{formatShortDay(doc.doc_date)}</span>

      <button
        type="button"
        onClick={() => onOpen(doc.id)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left after:absolute after:inset-0"
      >
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${doc.vendor ? "" : "text-ink-2"}`}>{title}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.8rem] text-muted">
            {reading ? (
              <span className="inline-flex items-center gap-1.5 font-medium">
                <span className="size-1.5 animate-pulse-dot rounded-full bg-accent" />
                <span className="shimmer-text">Reading…</span>
              </span>
            ) : (
              <>
                <span className="shrink-0 tabular-nums sm:hidden">{formatDay(doc.doc_date)}</span>
                <span className="sm:hidden" aria-hidden="true">·</span>
                <span className="shrink-0">{doc.category}</span>
                {doc.status === "failed" && <span className="shrink-0 font-medium text-warn">· Not read</span>}
                {doc.booked_at && <CircleCheck className="size-3.5 shrink-0 text-accent" aria-label="Booked" />}
                {paid && <Landmark className="size-3.5 shrink-0 text-muted" aria-label="Paid" />}
                {doc.description && <span className="hidden truncate sm:inline">· {doc.description}</span>}
              </>
            )}
          </span>
        </span>
        <Icon className="hidden size-4 shrink-0 text-muted/60 lg:block" aria-hidden="true" />
        <span className="nums shrink-0 text-right text-[0.95rem] font-medium">
          {doc.total != null ? formatMoney(doc.total, doc.currency) : ""}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onDownload(doc)}
        aria-label={`Download ${title}`}
        className="press relative z-10 -mr-1 hidden size-9 shrink-0 place-items-center rounded-full text-muted/40 group-hover:text-muted hover:bg-ink/5 hover:text-ink! sm:grid"
      >
        <Download className="size-4" />
      </button>
    </li>
  );
});
