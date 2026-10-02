"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CircleCheck, Download, LoaderCircle } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/dialog";
import { lastQuarterMonths, monthsLabel } from "@/lib/dates";
import type { Doc } from "@/lib/documents";
import { formatMonth, formatShortMonth } from "@/lib/format";

type Choice = { months: Set<string>; year: number; statements: boolean };

// Pick months (or whole quarters) and download their documents, a folder per month.
export function DownloadDialog({
  open,
  docs,
  reading,
  progress,
  onClose,
  onDownload,
}: {
  open: boolean;
  docs: Doc[];
  reading: number; // documents still uploading or being read: their date may still change
  progress: string | null; // "12/43" while zipping
  onClose: () => void;
  onDownload: (docs: Doc[], name: string) => void;
}) {
  // Kept while the page is open, so closing and reopening keeps the choice.
  const [choice, setChoice] = useState<Choice>(() => {
    const months = lastQuarterMonths();
    return { months: new Set(months), year: Number(months[0].slice(0, 4)), statements: true };
  });

  return (
    <Dialog open={open} onClose={onClose} width={420} label="Download">
      <DialogHeader title="Download" onClose={onClose} />
      <Picker docs={docs} reading={reading} progress={progress} choice={choice} onChoice={setChoice} onDownload={onDownload} />
    </Dialog>
  );
}

function Picker({
  docs,
  reading,
  progress,
  choice,
  onChoice,
  onDownload,
}: {
  docs: Doc[];
  reading: number;
  progress: string | null;
  choice: Choice;
  onChoice: (choice: Choice) => void;
  onDownload: (docs: Doc[], name: string) => void;
}) {
  const { months, year, statements } = choice;
  const byMonth = useMemo(() => {
    const map = new Map<string, Doc[]>();
    for (const doc of docs) {
      if (!statements && doc.doc_type === "statement") continue;
      const month = doc.doc_date.slice(0, 7);
      const list = map.get(month);
      if (list) list.push(doc);
      else map.set(month, [doc]);
    }
    return map;
  }, [docs, statements]);

  const chosen = [...months].sort().flatMap((m) => byMonth.get(m) ?? []);
  const statementCount = docs.filter((d) => d.doc_type === "statement" && months.has(d.doc_date.slice(0, 7))).length;
  const label = monthsLabel(months);

  // Years with documents, this year, and the years of picked months.
  let first = new Date().getFullYear();
  let last = first;
  for (const y of [...docs.map((d) => d.doc_date), ...months].map((iso) => Number(iso.slice(0, 4)))) {
    first = Math.min(first, y);
    last = Math.max(last, y);
  }

  function set(list: string[], on: boolean) {
    const next = new Set(months);
    for (const m of list) {
      if (on) next.add(m);
      else next.delete(m);
    }
    onChoice({ ...choice, months: next });
  }

  return (
    <>
      <div className="overflow-y-auto overscroll-contain px-5 pt-3 pb-4">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => onChoice({ ...choice, year: year - 1 })}
            disabled={year <= first}
            aria-label="Previous year"
            className="press -ml-2 grid size-10 place-items-center rounded-full hover:bg-ink/5 disabled:opacity-30"
          >
            <ChevronLeft className="size-5" />
          </button>
          <span key={year} className="nums animate-fade-in text-base font-semibold">
            {year}
          </span>
          <button
            type="button"
            onClick={() => onChoice({ ...choice, year: year + 1 })}
            disabled={year >= last}
            aria-label="Next year"
            className="press -mr-2 grid size-10 place-items-center rounded-full hover:bg-ink/5 disabled:opacity-30"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>

        <div className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-2">
          {[0, 1, 2, 3].map((q) => {
            const quarter = [1, 2, 3].map((i) => `${year}-${String(q * 3 + i).padStart(2, "0")}`);
            const whole = quarter.every((m) => months.has(m));
            return (
              <Fragment key={q}>
                <button
                  type="button"
                  onClick={() => set(quarter, !whole)}
                  aria-pressed={whole}
                  aria-label={`Q${q + 1} ${year}`}
                  className={`press w-11 rounded-xl text-sm font-semibold hover:bg-ink/5 ${whole ? "bg-accent-soft text-accent" : "text-muted"}`}
                >
                  Q{q + 1}
                </button>
                {quarter.map((m) => {
                  const list = byMonth.get(m) ?? [];
                  const on = months.has(m);
                  const booked = list.length > 0 && list.every((d) => d.booked_at);
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => set([m], !on)}
                      aria-pressed={on}
                      aria-label={`${formatMonth(m)}, ${list.length} ${list.length === 1 ? "document" : "documents"}${booked ? ", booked" : ""}`}
                      className={`press flex h-14 flex-col justify-center rounded-xl border px-3 text-left ${
                        on ? "border-accent/60 bg-accent-soft text-accent shadow-card" : "border-rule-strong/80 hover:border-rule-strong hover:bg-ink/[0.03]"
                      }`}
                    >
                      <span className={`text-sm font-semibold ${on || list.length ? "" : "text-muted"}`}>{formatShortMonth(m)}</span>
                      <span className={`nums flex items-center gap-1 text-xs ${on ? "" : "text-muted"}`}>
                        {list.length || "–"}
                        {booked && <CircleCheck className="size-3" aria-hidden="true" />}
                      </span>
                    </button>
                  );
                })}
              </Fragment>
            );
          })}
        </div>

        {statementCount > 0 && (
          <label className="mt-4 flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={statements}
              onChange={(e) => onChoice({ ...choice, statements: e.target.checked })}
              className="checkbox"
            />
            <span>Card statements</span>
            <span className="nums text-muted">{statementCount}</span>
          </label>
        )}

        {reading > 0 && (
          <p className="mt-4 flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin text-accent" />
            <span className="shimmer-text font-medium">
              Still reading {reading} {reading === 1 ? "document" : "documents"}…
            </span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-rule px-5 py-3">
        <div className="min-w-0 flex-1">
          <div key={label} className="animate-fade-in truncate text-sm font-semibold">
            {label || "Pick months"}
          </div>
          {label && (
            <div className="truncate text-xs text-muted">
              {chosen.length
                ? `${chosen.length} ${chosen.length === 1 ? "document" : "documents"} · a folder per month`
                : "Nothing in these months"}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDownload(chosen, `Documents – ${label}`)}
          disabled={!chosen.length || progress !== null}
          className="press flex h-10 shrink-0 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink shadow-raised hover:bg-accent-hover disabled:opacity-40 disabled:shadow-none"
        >
          {progress !== null ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
          {progress ? <span className="nums">{progress}</span> : "Download"}
        </button>
      </div>
    </>
  );
}
