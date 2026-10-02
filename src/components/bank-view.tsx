"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  CircleCheck,
  CreditCard,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Globe,
  Inbox,
  Landmark,
  Pencil,
  Link2,
  LoaderCircle,
  Receipt,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { AccountDialog } from "@/components/account-dialog";
import { AppHeader } from "@/components/app-header";
import { AttachDialog } from "@/components/attach-dialog";
import { BillingDialog, type BillingDraft } from "@/components/billing-dialog";
import { DateChip, SearchField } from "@/components/controls";
import { DateRangeDialog } from "@/components/date-range-dialog";
import { DocumentPanel } from "@/components/document-panel";
import { DropOverlay } from "@/components/drop-overlay";
import { EmptyState } from "@/components/empty-state";
import { offerMatch } from "@/components/match-offer";
import { FileButton } from "@/components/file-button";
import { Tabs, type TabOption } from "@/components/tabs";
import { toast } from "@/components/toaster";
import {
  findMatches,
  linkFor,
  loadDismissed,
  ruleFor,
  saveDismissed,
  LINK_COLUMNS,
  RULE_COLUMNS,
  type Match,
  type Rule,
  type Source,
  type Transaction,
  type VendorLink,
} from "@/lib/bank";
import { applyRules, approveMatches, importStatement, linkTransaction, readCardStatement } from "@/lib/bank-import";
import { ALL_TIME, inRange, rangeLabel, todayISO, type DateRange } from "@/lib/dates";
import { compareDocs, type Doc } from "@/lib/documents";
import { saveBlob, sanitizeFileName } from "@/lib/files";
import { formatDay, formatMoney, formatMonth } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { DuplicateError, requestExtraction, uploadDocument, prepareFile } from "@/lib/upload";
import { useFileDrop } from "@/lib/use-file-drop";
import { createXlsx } from "@/lib/xlsx";

type Tab = "missing" | "check" | "matched" | "no_receipt" | "unpaid" | "statements";

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String(err.message);
  return "Something went wrong";
}

function compareTxs(a: Transaction, b: Transaction) {
  if (a.booked_on !== b.booked_on) return a.booked_on < b.booked_on ? 1 : -1;
  return a.id < b.id ? -1 : 1;
}

// Counts of suggested matches waiting for approval, per page.
export function pendingCounts(matches: Match[], txs: Transaction[]) {
  const sourceOf = new Map(txs.map((t) => [t.id, t.source]));
  const counts = { "/bank": 0, "/card": 0 };
  for (const m of matches) counts[sourceOf.get(m.txId) === "card" ? "/card" : "/bank"]++;
  return counts;
}

export function BankView({
  source,
  initialDocs,
  initialTxs,
  initialRules,
  initialLinks,
  initialTab,
  email,
}: {
  source: Source;
  initialLinks: VendorLink[];
  initialTab?: string;
  initialDocs: Doc[];
  initialTxs: Transaction[];
  initialRules: Rule[];
  email: string;
}) {
  const card = source === "card";
  const [supabase] = useState(createClient);
  const [docs, setDocs] = useState(initialDocs);
  const [txs, setTxs] = useState(initialTxs);
  const [rules, setRules] = useState(initialRules);
  const [links, setLinks] = useState(initialLinks);
  const [billing, setBilling] = useState<BillingDraft | null>(null);
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>(initialTab === "check" ? "check" : "missing");
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<"dates" | "account" | null>(null);
  const [attachId, setAttachId] = useState<string | null>(null);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [reading, setReading] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null); // "import", "approve" or a transaction id

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

  const pending = useMemo(() => pendingCounts(matches, txs), [matches, txs]);

  // Async flows (reading a dropped file) need the state as it is when they finish.
  const latest = useRef({ txs, docs, dismissed });
  useEffect(() => {
    latest.current = { txs, docs, dismissed };
  }, [txs, docs, dismissed]);

  // ----- Views -----------------------------------------------------------

  const q = query.trim().toLowerCase();
  const ownTxs = useMemo(() => txs.filter((t) => t.source === source), [txs, source]);
  const visibleTxs = useMemo(
    () =>
      ownTxs.filter(
        (t) =>
          inRange(t.booked_on, range) &&
          (!q || `${t.counterparty ?? ""} ${t.description ?? ""} ${Math.abs(t.amount).toFixed(2)}`.toLowerCase().includes(q)),
      ),
    [ownTxs, range, q],
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
    if (card || !ownTxs.length) return [];
    const first = ownTxs[ownTxs.length - 1].booked_on;
    const last = ownTxs[0].booked_on;
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
  }, [card, docs, ownTxs, txs, matches, range, q]);

  const statements = useMemo(
    () => (card ? docs.filter((d) => d.doc_type === "statement" && inRange(d.doc_date, range)) : []),
    [card, docs, range],
  );

  const sureMatches = useMemo(() => {
    const visible = new Set(groups.check.map((t) => t.id));
    return matches.filter((m) => m.sure && visible.has(m.txId));
  }, [matches, groups.check]);

  // Billing pages to visit for the receipts still missing, one per supplier.
  const billingToVisit = useMemo(() => {
    const seen = new Map<string, { link: VendorLink; count: number }>();
    for (const t of groups.missing) {
      const link = t.amount < 0 ? linkFor(t, links) : undefined;
      if (link) seen.set(link.id, { link, count: (seen.get(link.id)?.count ?? 0) + 1 });
    }
    return [...seen.values()];
  }, [groups.missing, links]);

  const missingTotal = groups.missing.reduce((sum, t) => sum + (t.amount < 0 ? -t.amount : 0), 0);

  // ----- Actions ---------------------------------------------------------

  // Rules first: lines that never need a receipt leave the queue straight away.
  async function withRules(added: Transaction[], using = rules) {
    const covered = await applyRules(supabase, added, using);
    const byId = new Map(covered.map((t) => [t.id, t]));
    return { txs: added.map((t) => byId.get(t.id) ?? t), covered: covered.length };
  }

  function undoImport(ids: string[], statementId?: string) {
    return {
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => {
          const request = statementId
            ? supabase.from("documents").delete().eq("id", statementId) // its lines go with it
            : supabase.from("bank_transactions").delete().in("id", ids);
          void request.then(({ error }) => {
            if (error) return toast(error.message, { tone: "error" });
            setTxs((prev) => prev.filter((t) => !ids.includes(t.id)));
            if (statementId) setDocs((prev) => prev.filter((d) => d.id !== statementId));
          });
        },
      },
    };
  }

  async function importCsv(file: File) {
    const { added, skipped } = await importStatement(supabase, file, source);
    const { txs: saved, covered } = await withRules(added);
    setTxs((prev) => [...prev, ...saved].sort(compareTxs));
    const parts = [
      added.length ? `Imported ${added.length} ${added.length === 1 ? "line" : "lines"}` : "Nothing new",
      covered ? `${covered} need no receipt` : "",
      skipped ? `${skipped} already here` : "",
    ].filter(Boolean);
    toast(parts.join(" · "), added.length ? undoImport(added.map((t) => t.id)) : {});
  }

  // A card statement from the "Add statement" button: always read as a statement.
  async function importCardStatement(file: File) {
    let doc: Doc;
    try {
      doc = await uploadDocument(supabase, await prepareFile(file));
    } catch (err) {
      if (err instanceof DuplicateError) {
        const existing = docsById.get(err.docId);
        if (existing?.doc_type !== "statement") throw new Error(`${file.name} is already in Documents`);
        doc = existing;
      } else throw err;
    }
    await finishStatement(doc);
  }

  // Claude lists the statement's purchases; they become card lines.
  async function finishStatement(doc: Doc) {
    upsertDoc({ ...doc, status: "processing", doc_type: "statement" });
    const result = await readCardStatement(doc.id);
    if (result.doc) upsertDoc(result.doc);
    if (result.error) throw new Error(result.error);
    if (result.notice) throw new Error("Saved, but it couldn't be read automatically.");
    const known = new Set(latest.current.txs.map((t) => t.id));
    const fresh = result.txs.filter((t) => !known.has(t.id));
    const { txs: saved } = await withRules(fresh);
    const savedById = new Map(saved.map((t) => [t.id, t]));
    const ids = new Set(result.txs.map((t) => t.id));
    const lines = result.txs.map((t) => savedById.get(t.id) ?? t);
    setTxs((prev) => [...prev.filter((t) => !ids.has(t.id)), ...lines].sort(compareTxs));
    const covered = lines.filter((t) => t.status === "no_receipt").length;
    toast(
      [`${lines.length} card ${lines.length === 1 ? "line" : "lines"}`, covered ? `${covered} need no receipt` : ""].filter(Boolean).join(" · "),
      fresh.length && fresh.length === result.txs.length ? undoImport(fresh.map((t) => t.id), doc.id) : {},
    );
  }

  async function approveOffer(match: Match) {
    try {
      const saved = await approveMatches(supabase, [match]);
      saved.forEach(upsertTx);
      toast(saved.length ? "Matched" : "That payment was already handled");
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    }
  }

  // Any file dropped on the page: a statement becomes card lines, a receipt
  // is read and its payment offered for approval.
  async function intake(file: File) {
    let doc: Doc;
    try {
      doc = await uploadDocument(supabase, await prepareFile(file));
    } catch (err) {
      const existing = err instanceof DuplicateError ? docsById.get(err.docId) : undefined;
      if (existing?.doc_type === "statement") return finishStatement(existing);
      if (existing && !latest.current.txs.some((t) => t.document_id === existing.id)) {
        return offerMatch(existing, latest.current, (m) => void approveOffer(m), { announceNone: true });
      }
      if (err instanceof DuplicateError) return void toast(`${file.name} is already in Documents`, { tone: "error" });
      throw err;
    }
    upsertDoc(doc);
    const result = await read(doc.id);
    if (result?.notice === "card_statement" && result.doc) return finishStatement(result.doc);
    if (result?.doc) offerMatch(result.doc, latest.current, (m) => void approveOffer(m), { announceNone: true });
  }

  async function onImport(files: File[], via: "button" | "drop" = "button") {
    const isCsv = (file: File) => /\.(csv|txt|tsv)$/i.test(file.name) || /csv|text\/plain/.test(file.type);
    setBusy("import");
    try {
      for (const file of files.filter(isCsv)) await importCsv(file);
      const others = files.filter((f) => !isCsv(f));
      if (card && via === "button") for (const file of others) await importCardStatement(file);
      else
        await Promise.all(
          others.map((file) => intake(file).catch((err) => void toast(`${file.name}: ${errorMessage(err)}`, { tone: "error" }))),
        );
      if (files.some(isCsv) || (card && via === "button")) setTab("missing");
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function link(tx: Transaction, docId: string | null, status: Transaction["status"]) {
    // Unlinking must stick: otherwise the same suggestion comes straight back.
    if (!docId && tx.document_id) dismiss({ txId: tx.id, docId: tx.document_id, score: 0, sure: false });
    setBusy(tx.id);
    try {
      const saved = await linkTransaction(supabase, tx.id, { document_id: docId, status, matched_by: docId ? "manual" : null, note: null });
      upsertTx(saved);
      if (status === "no_receipt" && saved.counterparty && !ruleFor(saved, rules)) {
        const name = saved.counterparty;
        toast("No receipt needed", {
          duration: 8000,
          action: { label: `Always for ${name.length > 24 ? `${name.slice(0, 22)}…` : name}`, onClick: () => void addRule(name) },
        });
      }
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function addRule(counterparty: string) {
    const { data, error } = await supabase
      .from("bank_rules")
      .insert({ field: "counterparty", pattern: counterparty, exact: true, label: null })
      .select(RULE_COLUMNS)
      .single();
    if (error) return toast(error.message, { tone: "error" });
    const rule = data as Rule;
    setRules((prev) => [...prev, rule]);
    try {
      const { txs: saved, covered } = await withRules(txs, [rule]);
      saved.forEach(upsertTx);
      toast(covered ? `Rule added · ${covered} more ${covered === 1 ? "line" : "lines"} need no receipt` : "Rule added");
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    }
  }

  async function deleteRule(rule: Rule) {
    const { error } = await supabase.from("bank_rules").delete().eq("id", rule.id);
    if (error) return toast(error.message, { tone: "error" });
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
    toast(`Rule removed · lines already marked stay as they are`);
  }

  async function saveLink(link: Omit<VendorLink, "id"> & { id?: string }) {
    const request = link.id
      ? supabase.from("vendor_links").update({ pattern: link.pattern, url: link.url }).eq("id", link.id)
      : supabase.from("vendor_links").insert({ pattern: link.pattern, url: link.url });
    const { data, error } = await request.select(LINK_COLUMNS).single();
    if (error) throw new Error(error.message);
    setLinks((prev) => [...prev.filter((l) => l.id !== data.id), data].sort((a, b) => a.pattern.localeCompare(b.pattern)));
    setBilling(null);
  }

  async function deleteLink(id: string) {
    const { error } = await supabase.from("vendor_links").delete().eq("id", id);
    if (error) {
      toast(error.message, { tone: "error" });
      throw error;
    }
    setLinks((prev) => prev.filter((l) => l.id !== id));
    setBilling(null);
  }

  async function approveAll() {
    setBusy("approve");
    try {
      const saved = await approveMatches(supabase, sureMatches);
      saved.forEach(upsertTx);
      toast(`Matched ${saved.length} ${saved.length === 1 ? "line" : "lines"}`);
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  function dismiss(match: Match) {
    const next = new Set(dismissed).add(`${match.txId}:${match.docId}`);
    setDismissed(next);
    saveDismissed(next);
  }

  const read = useCallback(
    async (id: string) => {
      setReading((s) => new Set(s).add(id));
      try {
        const result = await requestExtraction(id);
        if (result.doc) upsertDoc(result.doc);
        if (result.error) toast(result.error, { tone: "error" });
        return result;
      } catch (err) {
        toast(errorMessage(err), { tone: "error" });
        return null;
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
      let doc: Doc;
      let fresh = true;
      try {
        doc = await uploadDocument(supabase, await prepareFile(file));
      } catch (err) {
        // Already in Documents: link that copy, unless it belongs to another line.
        const existing = err instanceof DuplicateError ? docsById.get(err.docId) : undefined;
        if (!existing) throw err;
        if (txs.some((t) => t.document_id === existing.id)) throw new Error(`${file.name} is already linked to another payment`);
        doc = existing;
        fresh = false;
      }
      upsertDoc(doc);
      upsertTx(await linkTransaction(supabase, tx.id, { document_id: doc.id, status: "matched", matched_by: "manual" }));
      if (fresh) void read(doc.id);
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

  // Drop a statement anywhere to import it (not while a dialog takes files itself).
  const dragging = useFileDrop((files) => void onImport(files, "drop"), busy !== "import" && attachId === null && billing === null);

  // ----- Render ----------------------------------------------------------

  const attachTx = attachId ? (txs.find((t) => t.id === attachId) ?? null) : null;
  const openDoc = openDocId ? (docsById.get(openDocId) ?? null) : null;
  const list = tab === "unpaid" || tab === "statements" ? [] : groups[tab];
  const empty = ownTxs.length === 0 && (!card || !docs.some((d) => d.doc_type === "statement"));

  const tabs: TabOption<Tab>[] = [
    { id: "missing", label: "Missing receipt", count: groups.missing.length, tone: "danger" },
    { id: "check", label: "To approve", count: groups.check.length, tone: "accent" },
    { id: "matched", label: "Matched", count: groups.matched.length },
    { id: "no_receipt", label: "No receipt needed", count: groups.no_receipt.length },
    card
      ? { id: "statements", label: "Statements", count: statements.length }
      : { id: "unpaid", label: "Receipts not in bank", count: unpaid.length },
  ];

  return (
    <div className="min-h-dvh">
      <AppHeader active={card ? "/card" : "/bank"} email={email} badges={pending} onAccount={() => setDialog("account")}>
        <FileButton
          accept={card ? ".pdf,.csv,.txt,application/pdf,image/*,text/csv" : ".csv,.txt,.tsv,text/csv,text/plain"}
          multiple
          disabled={busy === "import"}
          onFiles={onImport}
          label={card ? "Add statement" : "Import statement"}
          className="press flex h-10 items-center gap-2 rounded-full bg-accent px-3 text-sm font-semibold text-accent-ink shadow-raised hover:bg-accent-hover sm:px-4"
        >
          {busy === "import" ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
          <span className="hidden sm:inline">{card ? "Add statement" : "Import statement"}</span>
        </FileButton>
      </AppHeader>

      <main className="mx-auto max-w-5xl animate-page-in px-4 pt-4 pb-24 sm:px-6 sm:pt-6">
        {empty ? (
          <BankEmptyState card={card} busy={busy === "import"} />
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchField value={query} onChange={setQuery} label="Search transactions" className="sm:order-last sm:flex-1" />
              <div className="flex">
                <DateChip range={range} onClick={() => setDialog("dates")} />
              </div>
            </div>

            <div className="mt-4">
              <Tabs tabs={tabs} value={tab} onChange={setTab} />
            </div>

            <div key={tab} className="animate-fade-in">
              {tab === "check" && sureMatches.length > 0 && (
                <div className="mt-4 flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent-soft py-2.5 pr-2.5 pl-4 text-sm">
                  <span className="min-w-0 flex-1 text-accent">
                    <span className="font-semibold">{sureMatches.length}</span> sure {sureMatches.length === 1 ? "match" : "matches"}: same amount, plus the name or a close date.
                  </span>
                  <button
                    type="button"
                    onClick={approveAll}
                    disabled={busy === "approve"}
                    className="press flex h-9 shrink-0 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink shadow-raised hover:bg-accent-hover disabled:opacity-60"
                  >
                    {busy === "approve" ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
                    Approve {sureMatches.length === 1 ? "" : "all "}
                    {sureMatches.length}
                  </button>
                </div>
              )}

              {tab === "no_receipt" && rules.length > 0 && (
                <div className="mt-4 px-1">
                  <p className="text-sm text-muted">Automatically marked when imported:</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    <AnimatePresence initial={false}>
                      {rules.map((rule) => (
                        <m.li
                          key={rule.id}
                          layout
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ type: "spring", duration: 0.3, bounce: 0.2 }}
                          className="flex items-center gap-1 rounded-full border border-rule-strong/80 bg-card py-1 pr-1 pl-3 text-sm shadow-card"
                        >
                          <span className="max-w-64 truncate">
                            {rule.field === "description" ? `“${rule.pattern}”` : rule.pattern}
                            {rule.label ? <span className="text-muted"> · {rule.label}</span> : null}
                          </span>
                          <button
                            type="button"
                            onClick={() => void deleteRule(rule)}
                            aria-label={`Remove rule ${rule.pattern}`}
                            className="press grid size-6 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
                          >
                            <X className="size-3.5" />
                          </button>
                        </m.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </div>
              )}

              {tab === "missing" && billingToVisit.length > 0 && (
                <div className="mt-4 px-1">
                  <p className="text-sm text-muted">Download from billing pages:</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {billingToVisit.map(({ link, count }) => (
                      <li key={link.id}>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="press flex h-9 items-center gap-1.5 rounded-full border border-accent/30 bg-card px-3.5 text-sm font-semibold text-accent shadow-card hover:bg-accent-soft"
                        >
                          {link.pattern}
                          {count > 1 && <span className="nums text-xs font-normal opacity-70">×{count}</span>}
                          <ExternalLink className="size-3.5" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
                    className="press flex h-9 shrink-0 items-center gap-2 rounded-full border border-rule-strong/80 bg-card px-3.5 text-sm font-semibold shadow-card hover:bg-paper"
                  >
                    <FileSpreadsheet className="size-4" /> <span className="hidden sm:inline">Export list</span>
                    <span className="sm:hidden">Export</span>
                  </button>
                </div>
              )}

              <div className="mt-4">
                {tab === "unpaid" ? (
                  <UnpaidList docs={unpaid} onOpen={setOpenDocId} />
                ) : tab === "statements" ? (
                  <StatementList docs={statements} txs={txs} onOpen={setOpenDocId} />
                ) : (
                  <>
                    {list.length === 0 && (
                      <AllDone>{tab === "missing" ? "Every payment has a receipt." : tab === "check" ? "Nothing to approve." : "Nothing here."}</AllDone>
                    )}
                    {/* Keyed by the filters: lines only animate away when they are handled. */}
                    <TxList
                      key={`${q}|${range.from}|${range.to}`}
                      txs={list}
                      busy={busy}
                      docsById={docsById}
                      suggestionFor={suggestionFor}
                      links={links}
                      onBilling={setBilling}
                      onAttach={setAttachId}
                      onOpenDoc={setOpenDocId}
                      onLink={link}
                      onDismiss={dismiss}
                      dragging={dragging}
                      onDropFile={(tx, file) => void uploadFor(tx, file)}
                    />
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {dragging && (
        <DropOverlay banner label="Drop statements or receipts — or a receipt on its line" />
      )}

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
      <BillingDialog draft={billing} onClose={() => setBilling(null)} onSave={saveLink} onDelete={deleteLink} />
      <DocumentPanel
        supabase={supabase}
        doc={openDoc}
        reading={openDoc ? reading.has(openDoc.id) : false}
        payments={openDoc ? txs.filter((t) => t.document_id === openDoc.id) : []}
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

function BankEmptyState({ card, busy }: { card: boolean; busy: boolean }) {
  return (
    <EmptyState
      icon={card ? CreditCard : Landmark}
      behind={card ? [Receipt, FileText] : [FileSpreadsheet, Receipt]}
      busy={busy}
      title={busy ? "Reading statement…" : card ? "Add a credit card statement" : "Import a bank statement"}
    >
      {card
        ? "Upload or drop the statement PDF (or CSV). Every purchase on it is listed so you can add its receipt."
        : "Download a CSV from your bank’s website and import it, or drop it here. Payments are matched to your receipts. Your bank is never connected."}
    </EmptyState>
  );
}

// Shown once a tab is cleared; waits for the last line to finish leaving.
function AllDone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-10 flex animate-rise flex-col items-center text-center" style={{ animationDelay: "180ms" }}>
      <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
        <CircleCheck className="size-6" />
      </span>
      <p className="mt-3 font-medium text-muted">{children}</p>
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

function docLabel(doc: Doc) {
  return doc.doc_type === "statement" ? `${doc.vendor || "Card"} statement` : doc.vendor || doc.file_name;
}

// Money in: a sales invoice on the bank account, a refund (credit note) on the card.
function paperFor(tx: Transaction) {
  return tx.amount < 0 ? "receipt" : tx.source === "card" ? "credit note" : "invoice";
}

function Amount({ value, currency }: { value: number; currency: string | null }) {
  return (
    <span className={`nums shrink-0 text-right text-[0.95rem] font-medium ${value > 0 ? "text-accent" : ""}`}>
      {value > 0 ? "+" : "−"}
      {formatMoney(Math.abs(value), currency)}
    </span>
  );
}

// Lines collapse out of the list when they are handled (and slide in when they arrive).
const COLLAPSE = { duration: 0.28, ease: [0.2, 0.8, 0.2, 1] } as const;

function TxList({
  txs,
  busy,
  docsById,
  suggestionFor,
  links,
  onBilling,
  onAttach,
  onOpenDoc,
  onLink,
  onDismiss,
  dragging,
  onDropFile,
}: {
  txs: Transaction[];
  busy: string | null;
  docsById: Map<string, Doc>;
  suggestionFor: Map<string, Match>;
  links: VendorLink[];
  onBilling: (draft: BillingDraft) => void;
  onAttach: (txId: string) => void;
  onOpenDoc: (docId: string) => void;
  onLink: (tx: Transaction, docId: string | null, status: Transaction["status"]) => void;
  onDismiss: (match: Match) => void;
  dragging: boolean;
  onDropFile: (tx: Transaction, file: File) => void;
}) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  return (
    <div>
      <AnimatePresence initial={false}>
        {monthGroups(txs, (t) => t.booked_on).map((group) => (
          <m.section
            key={group.month}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={COLLAPSE}
            className="-mx-1 overflow-hidden px-1"
          >
            <div className="pb-6">
              <h3 className="mb-2 flex items-baseline gap-3 px-1 text-[0.7rem] font-semibold tracking-[0.14em] text-muted uppercase">
                <span>{formatMonth(group.month)}</span>
                <span className="h-px flex-1 translate-y-[-0.2em] bg-rule" aria-hidden="true" />
              </h3>
              <ul className="overflow-hidden rounded-2xl border border-rule bg-card shadow-card">
                <AnimatePresence initial={false}>
                  {group.items.map((tx) => {
                    const suggestion = tx.status === "unmatched" ? suggestionFor.get(tx.id) : undefined;
                    const suggested = suggestion ? docsById.get(suggestion.docId) : undefined;
                    const linked = tx.document_id ? docsById.get(tx.document_id) : undefined;
                    const Direction = tx.amount < 0 ? ArrowUpRight : ArrowDownLeft;
                    const billing = tx.status === "unmatched" && tx.amount < 0 ? linkFor(tx, links) : undefined;
                    return (
                      <m.li
                        key={tx.id}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={COLLAPSE}
                        className={`overflow-hidden border-b border-rule transition-colors last:border-b-0 ${
                          dragging && dropTarget === tx.id ? "bg-accent-soft ring-2 ring-accent ring-inset" : ""
                        }`}
                        // A receipt dropped on an open line is attached to it.
                        onDragOver={(e) => {
                          if (tx.status !== "unmatched" || !e.dataTransfer.types.includes("Files")) return;
                          e.preventDefault();
                          setDropTarget(tx.id);
                        }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget((id) => (id === tx.id ? null : id));
                        }}
                        onDrop={(e) => {
                          if (tx.status !== "unmatched") return;
                          const file = e.dataTransfer.files[0];
                          if (!file || /\.(csv|txt|tsv)$/i.test(file.name)) return; // statements go to the page
                          e.preventDefault();
                          e.stopPropagation();
                          setDropTarget(null);
                          onDropFile(tx, file);
                        }}
                      >
                        <div className="px-3 py-3 sm:px-4">
                          <div className="flex items-center gap-3">
                            <span
                              className={`grid size-9 shrink-0 place-items-center rounded-full ${
                                tx.amount < 0 ? "bg-ink/[0.05] text-muted" : "bg-accent-soft text-accent"
                              }`}
                            >
                              <Direction className="size-4" aria-hidden="true" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{tx.counterparty || tx.description || "—"}</div>
                              <div className="mt-0.5 truncate text-[0.8rem] text-muted">
                                <span className="tabular-nums">{formatDay(tx.booked_on)}</span>
                                {tx.counterparty && tx.description ? ` · ${tx.description}` : ""}
                              </div>
                            </div>
                            <Amount value={tx.amount} currency={tx.currency} />
                          </div>

                          <div className="mt-2.5 flex min-h-8 flex-wrap items-center gap-2 sm:pl-12">
                            {busy === tx.id ? (
                              <span className="flex h-8 items-center gap-2 text-sm text-muted">
                                <LoaderCircle className="size-4 animate-spin" />
                              </span>
                            ) : tx.status === "matched" ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => linked && onOpenDoc(linked.id)}
                                  className="press flex h-8 min-w-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-sm font-medium text-accent hover:brightness-95"
                                >
                                  <Check className="size-3.5 shrink-0" />
                                  <span className="truncate">{linked ? docLabel(linked) : "Receipt"}</span>
                                </button>
                                <SmallButton onClick={() => onLink(tx, null, "unmatched")} label="Unlink">
                                  <Undo2 className="size-3.5" /> Unlink
                                </SmallButton>
                              </>
                            ) : tx.status === "no_receipt" ? (
                              <>
                                {tx.note && <span className="flex h-8 items-center rounded-full bg-ink/[0.05] px-3 text-sm text-muted">{tx.note}</span>}
                                <SmallButton onClick={() => onLink(tx, null, "unmatched")} label="Undo">
                                  <Undo2 className="size-3.5" /> Needs receipt
                                </SmallButton>
                              </>
                            ) : suggestion && suggested ? (
                              <>
                                <span className="flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-dashed border-accent/70 bg-accent-soft/40 px-3 text-sm">
                                  <Link2 className="size-3.5 shrink-0 text-accent" />
                                  <button type="button" onClick={() => onOpenDoc(suggested.id)} className="truncate font-medium hover:underline">
                                    {docLabel(suggested)}
                                  </button>
                                  <span className="nums shrink-0 text-muted">
                                    {formatDay(suggested.doc_date)}
                                    {suggested.total != null ? ` · ${formatMoney(suggested.total, suggested.currency)}` : ""}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => onLink(tx, suggested.id, "matched")}
                                  className="press flex h-8 items-center gap-1.5 rounded-full bg-accent px-3.5 text-sm font-semibold text-accent-ink shadow-raised hover:bg-accent-hover"
                                >
                                  <Check className="size-3.5" /> Match
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onDismiss(suggestion)}
                                  aria-label="Not this one"
                                  title="Not this one"
                                  className="press grid size-8 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
                                >
                                  <X className="size-4" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onAttach(tx.id)}
                                  className="press flex h-8 items-center gap-1.5 rounded-full border border-rule-strong/80 bg-card px-3 text-sm font-semibold shadow-card hover:border-rule-strong hover:bg-paper"
                                >
                                  <Link2 className="size-3.5" /> Add {paperFor(tx)}
                                </button>
                                <SmallButton onClick={() => onLink(tx, null, "no_receipt")} label="No receipt needed">
                                  No {paperFor(tx)} needed
                                </SmallButton>
                                {billing ? (
                                  <span className="flex items-center">
                                    <a
                                      href={billing.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="press flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-accent hover:bg-accent-soft"
                                    >
                                      Billing page <ExternalLink className="size-3.5" />
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => onBilling(billing)}
                                      aria-label="Edit billing page"
                                      title="Edit billing page"
                                      className="press grid size-8 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
                                    >
                                      <Pencil className="size-3.5" />
                                    </button>
                                  </span>
                                ) : (
                                  tx.amount < 0 && (
                                    <SmallButton onClick={() => onBilling({ pattern: tx.counterparty || "", url: "" })} label="Add billing page">
                                      <Globe className="size-3.5" /> Add billing page
                                    </SmallButton>
                                  )
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </m.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </div>
          </m.section>
        ))}
      </AnimatePresence>
    </div>
  );
}

function SmallButton({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="press flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted hover:bg-ink/5 hover:text-ink"
    >
      {children}
    </button>
  );
}

function UnpaidList({ docs, onOpen }: { docs: Doc[]; onOpen: (id: string) => void }) {
  if (!docs.length) return <AllDone>Every receipt has a payment.</AllDone>;
  return (
    <>
      <p className="mb-3 px-1 text-sm text-muted">Paid in cash, from another account, or not paid yet.</p>
      <ul className="overflow-hidden rounded-2xl border border-rule bg-card shadow-card">
        {docs.map((doc) => (
          <li key={doc.id} className="border-b border-rule last:border-b-0">
            <button
              type="button"
              onClick={() => onOpen(doc.id)}
              className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-ink/[0.025] sm:px-4"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink/[0.05] text-muted">
                <Receipt className="size-4" aria-hidden="true" />
              </span>
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

function StatementList({ docs, txs, onOpen }: { docs: Doc[]; txs: Transaction[]; onOpen: (id: string) => void }) {
  if (!docs.length) {
    return (
      <div className="mt-10 flex animate-rise flex-col items-center text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-ink/5 text-muted">
          <Inbox className="size-5" />
        </span>
        <p className="mt-3 font-medium text-muted">No statements yet.</p>
      </div>
    );
  }
  return (
    <ul className="overflow-hidden rounded-2xl border border-rule bg-card shadow-card">
      {docs.map((doc) => {
        const lines = txs.filter((t) => t.statement_id === doc.id);
        const open = lines.filter((t) => t.status === "unmatched").length;
        const paid = txs.find((t) => t.document_id === doc.id);
        return (
          <li key={doc.id} className="border-b border-rule last:border-b-0">
            <button
              type="button"
              onClick={() => onOpen(doc.id)}
              className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-ink/[0.025] sm:px-4"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink/[0.05] text-muted">
                <FileText className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {doc.status === "processing" ? <span className="shimmer-text">Reading…</span> : `${doc.vendor || "Card"} · ${formatDay(doc.doc_date)}`}
                </span>
                <span className="mt-0.5 block truncate text-[0.8rem] text-muted">
                  {lines.length} {lines.length === 1 ? "line" : "lines"}
                  {open ? ` · ${open} without receipt` : lines.length ? " · all done" : ""}
                  {" · "}
                  {paid ? `paid ${formatDay(paid.booked_on)}` : "payment not in bank yet"}
                </span>
              </span>
              <span className="nums shrink-0 text-[0.95rem] font-medium">
                {doc.total != null ? formatMoney(doc.total, doc.currency) : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
