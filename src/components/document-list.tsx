"use client";

import { memo } from "react";
import { Download, FileText, Image as ImageIcon } from "lucide-react";
import { isImage, type Doc } from "@/lib/documents";
import { formatDay, formatMoney, formatMonth, formatShortDay, totalsByCurrency } from "@/lib/format";

type Props = {
  docs: Doc[];
  selected: Set<string>;
  reading: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onDownload: (doc: Doc) => void;
};

export function DocumentList({ docs, selected, reading, onToggle, onOpen, onDownload }: Props) {
  const groups: { month: string; docs: Doc[] }[] = [];
  for (const doc of docs) {
    const month = doc.doc_date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.month === month) last.docs.push(doc);
    else groups.push({ month, docs: [doc] });
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.month} className="[content-visibility:auto] [contain-intrinsic-size:auto_600px]">
          <MonthHeader month={group.month} docs={group.docs} />
          <ul className="overflow-hidden rounded-2xl border border-rule bg-card">
            {group.docs.map((doc) => (
              <Row
                key={doc.id}
                doc={doc}
                checked={selected.has(doc.id)}
                reading={reading.has(doc.id) || doc.status === "processing"}
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

function MonthHeader({ month, docs }: { month: string; docs: Doc[] }) {
  const totals = totalsByCurrency(docs);
  return (
    <h3 className="mb-2 flex items-baseline gap-3 px-1 text-[0.7rem] font-semibold tracking-[0.14em] text-muted uppercase">
      <span>{formatMonth(month)}</span>
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
  onToggle,
  onOpen,
  onDownload,
}: {
  doc: Doc;
  checked: boolean;
  reading: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onDownload: (doc: Doc) => void;
}) {
  const title = doc.vendor || doc.file_name;
  const Icon = isImage(doc) ? ImageIcon : FileText;

  return (
    <li
      className={`group relative flex items-center gap-3 border-b border-rule px-3 py-3 last:border-b-0 sm:gap-4 sm:px-4 ${
        checked ? "bg-accent-soft" : "hover:bg-ink/[0.025]"
      }`}
    >
      <label className="relative z-10 -m-2 grid size-10 shrink-0 cursor-pointer place-items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(doc.id)}
          aria-label={`Select ${title}`}
          className="size-[1.1rem] cursor-pointer accent-(--color-accent)"
        />
      </label>

      <span className="nums hidden w-20 shrink-0 text-sm text-muted sm:block">{formatShortDay(doc.doc_date)}</span>

      <button
        type="button"
        onClick={() => onOpen(doc.id)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left after:absolute after:inset-0"
      >
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${doc.vendor ? "" : "text-ink-2"}`}>{title}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.8rem] text-muted">
            {reading ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-accent">
                <span className="size-1.5 animate-pulse-dot rounded-full bg-accent" />
                Reading…
              </span>
            ) : (
              <>
                <span className="shrink-0 tabular-nums sm:hidden">{formatDay(doc.doc_date)}</span>
                <span className="sm:hidden" aria-hidden="true">·</span>
                <span className="shrink-0">{doc.category}</span>
                {doc.status === "failed" && <span className="shrink-0 text-warn">· Not read</span>}
                {doc.description && <span className="hidden truncate sm:inline">· {doc.description}</span>}
              </>
            )}
          </span>
        </span>
        <Icon className="hidden size-4 shrink-0 text-muted/70 lg:block" aria-hidden="true" />
        <span className="nums shrink-0 text-right text-[0.95rem] font-medium">
          {doc.total != null ? formatMoney(doc.total, doc.currency) : ""}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onDownload(doc)}
        aria-label={`Download ${title}`}
        className="relative z-10 -mr-1 hidden size-9 shrink-0 place-items-center rounded-full text-muted/50 transition group-hover:text-muted hover:bg-ink/5 hover:text-ink! sm:grid"
      >
        <Download className="size-4" />
      </button>
    </li>
  );
});
