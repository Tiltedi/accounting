"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  FileSpreadsheet,
  Landmark,
  Link2,
  LoaderCircle,
  Search,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { AccountDialog } from "@/components/account-dialog";
import { AppHeader } from "@/components/app-header";
import { AttachDialog } from "@/components/attach-dialog";
import { DateRangeDialog } from "@/components/date-range-dialog";
import { DocumentPanel } from "@/components/document-panel";
import { FileButton } from "@/components/file-button";
import { toast } from "@/components/toaster";
import { findMatches, type Match, type Transaction } from "@/lib/bank";
import { applySureMatches, importStatement, linkTransaction } from "@/lib/bank-import";
import { ALL_TIME, inRange, rangeLabel, todayISO, type DateRange } from "@/lib/dates";
import { compareDocs, type Doc } from "@/lib/documents";
import { saveBlob, sanitizeFileName } from "@/lib/files";
import { formatDay, formatMoney, formatMonth } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { requestExtraction, uploadDocument, prepareFile } from "@/lib/upload";
import { createXlsx } from "@/lib/xlsx";

type Tab = "missing" | "check" | "matched" | "no_receipt" | "unpaid";

const DISMISSED_KEY = "bank:dismissed";

function loadDismissed() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"));
  } catch {
    return new Set<string>();
  }
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String(err.message);
  return "Something went wrong";
}

function compareTxs(a: Transaction, b: Transaction) {
  if (a.booked_on !== b.booked_on) return a.booked_on < b.booked_on ? 1 : -1;
  return a.id < b.id ? -1 : 1;
}

export function BankView({ initialDocs, initialTxs, email }: { initialDocs: Doc[]; initialTxs: Transaction[]; email: string }) {
  const [supabase] = useState(createClient);
  const [docs, setDocs] = useState(initialDocs);
  const [txs, setTxs] = useState(initialTxs);
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("missing");
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<"dates" | "account" | null>(null);
  const [attachId, setAttachId] = useState<string | null>(null);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [reading, setReading] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null); // "import" or a transaction id
  const applying = useRef(false);

  // Dismissed suggestions live in this browser only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage after hydration
    setDismissed(loadDismissed());
  }, []);

  const matches = useMemo(() => findMatches(txs, docs, dismissed), [txs, docs, dismissed]);
  const suggestionFor = useMemo(() => new Map<string, Match>(matches.map((m) => [m.txId, m])), [matches]);
  const docsById = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);

  const upsertTx = useCallback((tx: Transaction) => {
    setTxs((prev) => [...prev.filter((t) => t.id !== tx.id), tx].sort(compareTxs));
  }, []);

  const upsertDoc = useCallback((doc: Doc) => {
    setDocs((prev) => [...prev.filter((d) => d.id !== doc.id), doc].sort(compareDocs));
  }, []);

  // Link the unambiguous pairs automatically, whenever new ones appear.
  useEffect(() => {
    if (applying.current || !matches.some((m) => m.sure)) return;
    applying.current = true;
    applySureMatches(supabase, matches)
      .then((saved) => saved.forEach(upsertTx))
      .catch((err) => toast(errorMessage(err), { tone: "error" }))
      .finally(() => {
        applying.current = false;
      });
  }, [matches, supabase, upsertTx]);

  // ----- Views -----------------------------------------------------------

  const q = query.trim().toLowerCase();
  const visibleTxs = useMemo(
    () =>
      txs.filter(
        (t) =>
          inRange(t.booked_on, range) &&
          (!q || `${t.counterparty ?? ""} ${t.description ?? ""} ${Math.abs(t.amount).toFixed(2)}`.toLowerCase().includes(q)),
      ),
    [txs, range, q],
  );

  const groups = useMemo(() => {
    const missing: Transaction[] = [];
    const check: Transaction[] = [];
    const matched: Transaction[] = [];
    const noReceipt: Transaction[] = [];
    for (const t of visibleTxs) {
      if (t.status === "matched") matched.push(t);
      else if (t.status === "no_receipt") noReceipt.push(t);
      else if (suggestionFor.has(t.id)) check.push(t);
      else missing.push(t);
    }
    return { missing, check, matched, no_receipt: noReceipt };
  }, [visibleTxs, suggestionFor]);

  // Receipts inside the statement period with no bank line: paid in cash,
  // from another account, or not paid yet.
  const unpaid = useMemo(() => {
    if (!txs.length) return [];
    const first = txs[txs.length - 1].booked_on;
    const last = txs[0].booked_on;
    const linked = new Set(txs.map((t) => t.document_id).filter(Boolean));
    const suggested = new Set(matches.map((m) => m.docId));
    return docs.filter(
      (d) =>
        d.status !== "processing" &&
        !linked.has(d.id) &&
        !suggested.has(d.id) &&
        d.doc_date >= first &&
        d.doc_date <= last &&
        inRange(d.doc_date, range) &&
        (!q || `${d.vendor ?? ""} ${d.description ?? ""} ${d.file_name}`.toLowerCase().includes(q)),
    );
  }, [docs, txs, matches, range, q]);

  const missingTotal = groups.missing.reduce((sum, t) => sum + (t.amount < 0 ? -t.amount : 0), 0);

  // ----- Actions ---------------------------------------------------------

  async function onImport(files: File[]) {
    setBusy("import");
    try {
      for (const file of files) {
        const { added, skipped } = await importStatement(supabase, file);
        setTxs((prev) => [...prev, ...added].sort(compareTxs));
        const ids = added.map((t) => t.id);
        toast(
          added.length
            ? `Imported ${added.length} ${added.length === 1 ? "line" : "lines"}${skipped ? ` · ${skipped} already here` : ""}`
            : `Nothing new · ${skipped} already here`,
          ids.length
            ? {
                duration: 8000,
                action: {
                  label: "Undo",
                  onClick: () => {
                    void supabase
                      .from("bank_transactions")
                      .delete()
                      .in("id", ids)
                      .then(({ error }) => {
                        if (error) return toast(error.message, { tone: "error" });
                        setTxs((prev) => prev.filter((t) => !ids.includes(t.id)));
                      });
                  },
                },
              }
            : {},
        );
      }
      setTab("missing");
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function link(tx: Transaction, docId: string | null, status: Transaction["status"]) {
    // Unlinking must stick: otherwise the automatic matcher links it straight back.
    if (!docId && tx.document_id) dismiss({ txId: tx.id, docId: tx.document_id, score: 0, sure: false });
    setBusy(tx.id);
    try {
      upsertTx(await linkTransaction(supabase, tx.id, { document_id: docId, status, matched_by: docId ? "manual" : null }));
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  function dismiss(match: Match) {
    const next = new Set(dismissed).add(`${match.txId}:${match.docId}`);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
    } catch {
      // Private mode: the dismissal lasts until reload.
    }
  }

  const read = useCallback(
    async (id: string) => {
      setReading((s) => new Set(s).add(id));
      try {
        const result = await requestExtraction(id);
        if (result.doc) upsertDoc(result.doc);
        if (result.error) toast(result.error, { tone: "error" });
      } catch (err) {
        toast(errorMessage(err), { tone: "error" });
      } finally {
        setReading((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
    },
    [upsertDoc],
  );

  // Upload a receipt straight from a bank line and link it.
  async function uploadFor(tx: Transaction, file: File) {
    setAttachId(null);
    setBusy(tx.id);
    try {
      const doc = await uploadDocument(supabase, await prepareFile(file));
      upsertDoc(doc);
      upsertTx(await linkTransaction(supabase, tx.id, { document_id: doc.id, status: "matched", matched_by: "manual" }));
      void read(doc.id);
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function exportMissing() {
    const rows = groups.missing.map((t) => [
      { type: "date" as const, value: t.booked_on },
      { type: "text" as const, value: t.counterparty },
      { type: "text" as const, value: t.description },
      { type: "number" as const, value: t.amount },
      { type: "text" as const, value: t.currency },
    ]);
    const data = await createXlsx(
      "Missing receipts",
      [
        { header: "Date", width: 12 },
        { header: "Counterparty", width: 32 },
        { header: "Description", width: 60 },
        { header: "Amount", width: 12 },
        { header: "Currency", width: 10 },
      ],
      rows,
    );
    saveBlob(
      new Blob([data as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${sanitizeFileName(`Missing receipts – ${rangeLabel(range)} – ${todayISO()}`)}.xlsx`,
    );
  }

  // ----- Render ----------------------------------------------------------

  const attachTx = attachId ? (txs.find((t) => t.id === attachId) ?? null) : null;
  const openDoc = openDocId ? (docsById.get(openDocId) ?? null) : null;
  const list = tab === "unpaid" ? [] : groups[tab];

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "missing", label: "Missing receipt", count: groups.missing.length },
    { id: "check", label: "To check", count: groups.check.length },
    { id: "matched", label: "Matched", count: groups.matched.length },
    { id: "no_receipt", label: "No receipt needed", count: groups.no_receipt.length },
    { id: "unpaid", label: "Receipts not in bank", count: unpaid.length },
  ];

  return (
    <div className="min-h-dvh">
      <AppHeader active="/bank" email={email} onAccount={() => setDialog("account")}>
        <FileButton
          accept=".csv,.txt,.tsv,text/csv,text/plain"
          multiple
          disabled={busy === "import"}
          onFiles={onImport}
          label="Import statement"
          className="flex h-10 items-center gap-2 rounded-full bg-accent px-3 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover sm:px-4"
        >
          {busy === "import" ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
          <span className="hidden sm:inline">Import statement</span>
        </FileButton>
      </AppHeader>

      <main className="mx-auto max-w-5xl px-4 pt-4 pb-24 sm:px-6 sm:pt-6">
        {txs.length === 0 ? (
          <BankEmptyState />
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative sm:order-last sm:flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  aria-label="Search transactions"
                  className="h-11 w-full rounded-full border border-rule-strong bg-card pr-4 pl-10 text-base outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-[0.95rem] [&::-webkit-search-cancel-button]:hidden"
                />
              </div>
              <button
                type="button"
                onClick={() => setDialog("dates")}
                className={`flex h-11 items-center gap-2 rounded-full border px-4 text-[0.95rem] font-medium transition ${
                  range === ALL_TIME ? "border-rule-strong bg-card hover:bg-ink/5" : "border-accent bg-accent-soft text-accent"
                }`}
              >
                <CalendarDays className="size-4 shrink-0" />
                <span className="truncate">{rangeLabel(range)}</span>
                <ChevronDown className="ml-auto size-4 shrink-0 opacity-60" />
              </button>
            </div>

            <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium whitespace-nowrap transition ${
                    tab === t.id ? "border-ink bg-ink text-paper" : "border-rule-strong bg-card hover:bg-ink/5"
                  }`}
                >
                  {t.label}
                  <span
                    className={`nums rounded-full px-1.5 text-xs ${
                      tab === t.id
                        ? "bg-paper/20"
                        : t.id === "missing" && t.count
                          ? "bg-danger-soft text-danger"
                          : t.id === "check" && t.count
                            ? "bg-accent-soft text-accent"
                            : "bg-ink/5 text-muted"
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              ))}
            </div>

            {tab === "missing" && groups.missing.length > 0 && (
              <div className="mt-4 flex items-center gap-3 px-1 text-sm">
                {missingTotal > 0 && (
                  <span className="text-muted">
                    <span className="nums font-medium text-ink">{formatMoney(missingTotal, "EUR")}</span> paid without a receipt
                  </span>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={exportMissing}
                  className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-rule-strong bg-card px-3.5 text-sm font-semibold hover:bg-ink/5"
                >
                  <FileSpreadsheet className="size-4" /> <span className="hidden sm:inline">Export list</span>
                  <span className="sm:hidden">Export</span>
                </button>
              </div>
            )}

            <div className="mt-4">
              {tab === "unpaid" ? (
                <UnpaidList docs={unpaid} onOpen={setOpenDocId} />
              ) : list.length === 0 ? (
                <p className="mt-10 text-center font-medium text-muted">
                  {tab === "missing" ? "Every payment has a receipt." : tab === "check" ? "Nothing to check." : "Nothing here."}
                </p>
              ) : (
                <TxList
                  txs={list}
                  busy={busy}
                  docsById={docsById}
                  suggestionFor={suggestionFor}
                  onAttach={setAttachId}
                  onOpenDoc={setOpenDocId}
                  onLink={link}
                  onDismiss={dismiss}
                />
              )}
            </div>
          </>
        )}
      </main>

      <DateRangeDialog open={dialog === "dates"} value={range} onClose={() => setDialog(null)} onChange={(next) => setRange(next.from || next.to ? next : ALL_TIME)} />
      <AccountDialog open={dialog === "account"} email={email} supabase={supabase} docs={docs} onClose={() => setDialog(null)} />
      <AttachDialog
        tx={attachTx}
        docs={docs}
        linkedDocIds={new Set(txs.map((t) => t.document_id).filter(Boolean) as string[])}
        onClose={() => setAttachId(null)}
        onPick={(doc) => {
          if (!attachTx) return;
          setAttachId(null);
          void link(attachTx, doc.id, "matched");
        }}
        onUpload={(file) => attachTx && void uploadFor(attachTx, file)}
        onNoReceipt={() => {
          if (!attachTx) return;
          setAttachId(null);
          void link(attachTx, null, "no_receipt");
        }}
      />
      <DocumentPanel
        supabase={supabase}
        doc={openDoc}
        reading={openDoc ? reading.has(openDoc.id) : false}
        payment={openDoc ? (txs.find((t) => t.document_id === openDoc.id) ?? null) : null}
        onClose={() => setOpenDocId(null)}
        onSaved={upsertDoc}
        onDeleted={(id) => {
          setOpenDocId(null);
          setDocs((prev) => prev.filter((d) => d.id !== id));
          setTxs((prev) => prev.map((t) => (t.document_id === id ? { ...t, document_id: null, status: "unmatched", matched_by: null } : t)));
        }}
        onRead={(id) => void read(id)}
      />
    </div>
  );
}

function BankEmptyState() {
  return (
    <div className="ruled mt-6 flex animate-rise flex-col items-center rounded-3xl border border-dashed border-rule-strong px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-ink">
        <Landmark className="size-6" />
      </div>
      <p className="mt-4 text-lg font-semibold">Import a bank statement</p>
      <p className="mt-1 max-w-sm text-sm text-muted">
        Download a CSV from your bank’s website and import it. Payments are matched to your receipts. Your bank is never connected.
      </p>
    </div>
  );
}

function monthGroups<T>(items: T[], dateOf: (item: T) => string) {
  const groups: { month: string; items: T[] }[] = [];
  for (const item of items) {
    const month = dateOf(item).slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
}

function Amount({ value, currency }: { value: number; currency: string | null }) {
  return (
    <span className={`nums shrink-0 text-right text-[0.95rem] font-medium ${value > 0 ? "text-accent" : ""}`}>
      {value > 0 ? "+" : "−"}
      {formatMoney(Math.abs(value), currency)}
    </span>
  );
}

function TxList({
  txs,
  busy,
  docsById,
  suggestionFor,
  onAttach,
  onOpenDoc,
  onLink,
  onDismiss,
}: {
  txs: Transaction[];
  busy: string | null;
  docsById: Map<string, Doc>;
  suggestionFor: Map<string, Match>;
  onAttach: (txId: string) => void;
  onOpenDoc: (docId: string) => void;
  onLink: (tx: Transaction, docId: string | null, status: Transaction["status"]) => void;
  onDismiss: (match: Match) => void;
}) {
  return (
    <div className="space-y-6">
      {monthGroups(txs, (t) => t.booked_on).map((group) => (
        <section key={group.month}>
          <h3 className="mb-2 flex items-baseline gap-3 px-1 text-[0.7rem] font-semibold tracking-[0.14em] text-muted uppercase">
            <span>{formatMonth(group.month)}</span>
            <span className="h-px flex-1 translate-y-[-0.2em] bg-rule" aria-hidden="true" />
          </h3>
          <ul className="overflow-hidden rounded-2xl border border-rule bg-card">
            {group.items.map((tx) => {
              const suggestion = tx.status === "unmatched" ? suggestionFor.get(tx.id) : undefined;
              const suggested = suggestion ? docsById.get(suggestion.docId) : undefined;
              const linked = tx.document_id ? docsById.get(tx.document_id) : undefined;
              const Direction = tx.amount < 0 ? ArrowUpRight : ArrowDownLeft;
              return (
                <li key={tx.id} className="border-b border-rule px-3 py-3 last:border-b-0 sm:px-4">
                  <div className="flex items-center gap-3">
                    <Direction className={`size-4 shrink-0 ${tx.amount < 0 ? "text-muted" : "text-accent"}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{tx.counterparty || tx.description || "—"}</div>
                      <div className="mt-0.5 truncate text-[0.8rem] text-muted">
                        <span className="tabular-nums">{formatDay(tx.booked_on)}</span>
                        {tx.counterparty && tx.description ? ` · ${tx.description}` : ""}
                      </div>
                    </div>
                    <Amount value={tx.amount} currency={tx.currency} />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
                    {busy === tx.id ? (
                      <LoaderCircle className="size-4 animate-spin text-muted" />
                    ) : tx.status === "matched" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => linked && onOpenDoc(linked.id)}
                          className="flex min-w-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent"
                        >
                          <Check className="size-3.5 shrink-0" />
                          <span className="truncate">{linked ? linked.vendor || linked.file_name : "Receipt"}</span>
                          {tx.matched_by === "auto" && <span className="shrink-0 text-xs font-normal opacity-70">auto</span>}
                        </button>
                        <SmallButton onClick={() => onLink(tx, null, "unmatched")} label="Unlink">
                          <Undo2 className="size-3.5" /> Unlink
                        </SmallButton>
                      </>
                    ) : tx.status === "no_receipt" ? (
                      <SmallButton onClick={() => onLink(tx, null, "unmatched")} label="Undo">
                        <Undo2 className="size-3.5" /> Needs receipt
                      </SmallButton>
                    ) : suggestion && suggested ? (
                      <>
                        <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-dashed border-accent px-3 py-1 text-sm">
                          <Link2 className="size-3.5 shrink-0 text-accent" />
                          <button type="button" onClick={() => onOpenDoc(suggested.id)} className="truncate font-medium hover:underline">
                            {suggested.vendor || suggested.file_name}
                          </button>
                          <span className="nums shrink-0 text-muted">
                            {formatDay(suggested.doc_date)}
                            {suggested.total != null ? ` · ${formatMoney(suggested.total, suggested.currency)}` : ""}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onLink(tx, suggested.id, "matched")}
                          className="flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
                        >
                          <Check className="size-3.5" /> Match
                        </button>
                        <button
                          type="button"
                          onClick={() => onDismiss(suggestion)}
                          aria-label="Not this one"
                          title="Not this one"
                          className="grid size-8 place-items-center rounded-full text-muted hover:bg-ink/5"
                        >
                          <X className="size-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onAttach(tx.id)}
                          className="flex h-8 items-center gap-1.5 rounded-full border border-rule-strong px-3 text-sm font-semibold hover:bg-ink/5"
                        >
                          <Link2 className="size-3.5" /> {tx.amount > 0 ? "Add invoice" : "Add receipt"}
                        </button>
                        <SmallButton onClick={() => onLink(tx, null, "no_receipt")} label="No receipt needed">
                          {tx.amount > 0 ? "No invoice needed" : "No receipt needed"}
                        </SmallButton>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SmallButton({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted hover:bg-ink/5 hover:text-ink"
    >
      {children}
    </button>
  );
}

function UnpaidList({ docs, onOpen }: { docs: Doc[]; onOpen: (id: string) => void }) {
  if (!docs.length) return <p className="mt-10 text-center font-medium text-muted">Every receipt has a payment.</p>;
  return (
    <>
      <p className="mb-3 px-1 text-sm text-muted">Paid in cash, from another account, or not paid yet.</p>
      <ul className="overflow-hidden rounded-2xl border border-rule bg-card">
        {docs.map((doc) => (
          <li key={doc.id} className="border-b border-rule last:border-b-0">
            <button type="button" onClick={() => onOpen(doc.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink/[0.025]">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{doc.vendor || doc.file_name}</span>
                <span className="mt-0.5 block truncate text-[0.8rem] text-muted">
                  <span className="tabular-nums">{formatDay(doc.doc_date)}</span> · {doc.category}
                </span>
              </span>
              <span className="nums shrink-0 text-[0.95rem] font-medium">
                {doc.total != null ? formatMoney(doc.total, doc.currency) : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
