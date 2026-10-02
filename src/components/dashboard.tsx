"use client";

import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { Camera, Download, FileText, Image as ImageIcon, Inbox, LoaderCircle, Plus, Receipt, SearchX, Upload } from "lucide-react";
import { AccountDialog } from "@/components/account-dialog";
import { DateChip, SearchField, SelectChip } from "@/components/controls";
import { DateRangeDialog } from "@/components/date-range-dialog";
import { DocumentList, type ListOrder } from "@/components/document-list";
import { DocumentPanel } from "@/components/document-panel";
import { DownloadDialog } from "@/components/download-dialog";
import { DropOverlay } from "@/components/drop-overlay";
import { EmptyState } from "@/components/empty-state";
import { FileButton } from "@/components/file-button";
import { InboxDialog, InboxStrip } from "@/components/inbox-dialog";
import { AppHeader } from "@/components/app-header";
import { pendingCounts } from "@/components/bank-view";
import { offerMatch } from "@/components/match-offer";
import { ScanDialog } from "@/components/scan-dialog";
import { toast } from "@/components/toaster";
import { CATEGORIES } from "@/lib/categories";
import { ALL_TIME, inRange, todayISO, type DateRange } from "@/lib/dates";
import { findMatches, loadDismissed, type Match, type Transaction } from "@/lib/bank";
import { approveMatches, readCardStatement } from "@/lib/bank-import";
import { DOC_COLUMNS, compareDocs, fetchAllDocuments, type Doc } from "@/lib/documents";
import { downloadOne, downloadZip } from "@/lib/export";
import { createLimiter, imageToJpeg, jpegsToPdf, type ScanPage } from "@/lib/files";
import { formatBytes, formatDay, formatMoney, totalsByCurrency } from "@/lib/format";
import type { InboxItem, InboxState } from "@/lib/inbox";
import { createClient } from "@/lib/supabase/client";
import { useFileDrop } from "@/lib/use-file-drop";
import { DuplicateError, prepareFile, requestExtraction, uploadDocument, type PreparedFile } from "@/lib/upload";

const PAGE_SIZE = 200;
const ACCEPT = "application/pdf,image/*";

const searchCache = new WeakMap<Doc, string>();
function searchText(doc: Doc) {
  let text = searchCache.get(doc);
  if (text === undefined) {
    text = [doc.vendor, doc.description, doc.invoice_number, doc.notes, doc.category, doc.file_name, doc.total?.toFixed(2)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    searchCache.set(doc, text);
  }
  return text;
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String(err.message);
  return "Something went wrong";
}

let warnedNotConfigured = false;

type StatusFilter = "" | "unbooked" | "booked" | "unpaid";

function matchesStatus(doc: Doc, status: StatusFilter, payments: Map<string, Transaction>) {
  if (status === "booked") return Boolean(doc.booked_at);
  if (status === "unbooked") return !doc.booked_at;
  if (status === "unpaid") return !payments.has(doc.id);
  return true;
}

export function Dashboard({
  initialDocs,
  initialTxs,
  initialInbox,
  email,
}: {
  initialDocs: Doc[];
  initialTxs: Transaction[];
  initialInbox: InboxState;
  email: string;
}) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [uploadLimit] = useState(() => createLimiter(3));
  const [readLimit] = useState(() => createLimiter(3));

  const [docs, setDocs] = useState(initialDocs);
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  // Newest uploads first by default; the choice is remembered on this device.
  const [order, setOrder] = useState<ListOrder>("added");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage after hydration
      if (localStorage.getItem("docs-order") === "date") setOrder("date");
    } catch {
      // Storage unavailable: keep the default.
    }
  }, []);
  function changeOrder(next: ListOrder) {
    setOrder(next);
    setLimit(PAGE_SIZE);
    try {
      localStorage.setItem("docs-order", next);
    } catch {
      // Not remembered; fine.
    }
  }
  const [txs, setTxs] = useState(initialTxs);
  const payments = useMemo(() => new Map(txs.filter((t) => t.document_id).map((t) => [t.document_id!, t])), [txs]);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [reading, setReading] = useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploads, setUploads] = useState(0);
  const [zipping, setZipping] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"dates" | "account" | "download" | "inbox" | null>(null);
  const [inbox, setInbox] = useState(initialInbox);
  const [checking, setChecking] = useState(false);
  const [inboxBusy, setInboxBusy] = useState<Set<string>>(() => new Set());
  const [scanOpen, setScanOpen] = useState(false);
  const [scanPages, setScanPages] = useState<ScanPage[]>([]);
  const [scanBusy, setScanBusy] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const searchInput = useRef<HTMLInputElement>(null);
  const resumed = useRef(false);

  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const list = docs.filter(
      (d) =>
        inRange(d.doc_date, range) &&
        (!category || d.category === category) &&
        matchesStatus(d, status, payments) &&
        (!q || searchText(d).includes(q)),
    );
    // docs are kept by document date; "added" shows the newest uploads first.
    return order === "added" ? [...list].sort((a, b) => b.created_at.localeCompare(a.created_at)) : list;
  }, [docs, range, category, status, payments, deferredQuery, order]);

  const selectedDocs = useMemo(() => filtered.filter((d) => selected.has(d.id)), [filtered, selected]);
  const scope = selectedDocs.length ? selectedDocs : filtered;
  const totals = useMemo(() => totalsByCurrency(scope), [scope]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage after hydration
    setDismissed(loadDismissed());
  }, []);
  const pending = useMemo(() => pendingCounts(findMatches(txs, docs, dismissed), txs), [txs, docs, dismissed]);

  // Reading finishes later: offers are computed on the state as it is then.
  const latest = useRef({ txs, docs, dismissed });
  useEffect(() => {
    latest.current = { txs, docs, dismissed };
  }, [txs, docs, dismissed]);

  const mergeTxs = useCallback((changed: Transaction[]) => {
    const ids = new Set(changed.map((t) => t.id));
    setTxs((prev) => [...prev.filter((t) => !ids.has(t.id)), ...changed]);
  }, []);

  const approveOffer = useCallback(
    async (match: Match) => {
      try {
        const saved = await approveMatches(supabase, [match]);
        mergeTxs(saved);
        toast(saved.length ? "Matched" : "That payment was already handled");
      } catch (err) {
        toast(errorMessage(err), { tone: "error" });
      }
    },
    [supabase, mergeTxs],
  );

  const openDoc = openId ? (docs.find((d) => d.id === openId) ?? null) : null;
  const filtersActive = range !== ALL_TIME || category !== "" || status !== "" || query !== "";

  const upsert = useCallback((doc: Doc) => {
    setDocs((prev) => [...prev.filter((d) => d.id !== doc.id), doc].sort(compareDocs));
  }, []);

  // A document uploaded just now: its row glows in once.
  const markFresh = useCallback((id: string) => {
    setFresh((s) => new Set(s).add(id));
    setTimeout(
      () =>
        setFresh((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        }),
      1500,
    );
  }, []);

  const read = useCallback(
    (id: string) => {
      setReading((s) => new Set(s).add(id));
      return readLimit(async () => {
        try {
          const result = await requestExtraction(id);
          if (result.doc) upsert(result.doc);
          if (result.notice === "card_statement") {
            // A card statement: list its purchases as card lines.
            const statement = await readCardStatement(id);
            if (statement.doc) upsert(statement.doc);
            if (statement.error) throw new Error(statement.error);
            mergeTxs(statement.txs);
            toast(`Card statement · ${statement.txs.length} card ${statement.txs.length === 1 ? "line" : "lines"}`, {
              duration: 8000,
              action: { label: "Open", onClick: () => router.push("/card") },
            });
          } else if (result.doc) {
            offerMatch(result.doc, latest.current, (m) => void approveOffer(m));
          }
          if (result.error) toast(result.error, { tone: "error" });
          if (result.notice === "not_configured" && !warnedNotConfigured) {
            warnedNotConfigured = true;
            toast("Saved. Automatic reading is off until an Anthropic API key is set.", { duration: 8000 });
          }
        } catch (err) {
          toast(errorMessage(err), { tone: "error" });
        } finally {
          setReading((s) => {
            const next = new Set(s);
            next.delete(id);
            return next;
          });
        }
      });
    },
    [readLimit, upsert, mergeTxs, approveOffer, router],
  );

  const addFiles = useCallback(
    (items: { label: string; prepare: () => Promise<PreparedFile> }[]) => {
      setUploads((n) => n + items.length);
      for (const item of items) {
        void uploadLimit(async () => {
          try {
            const doc = await uploadDocument(supabase, await item.prepare());
            upsert(doc);
            markFresh(doc.id);
            void read(doc.id);
          } catch (err) {
            if (err instanceof DuplicateError) {
              const id = err.docId;
              toast(`${item.label} is already here`, { action: { label: "Open", onClick: () => setOpenId(id) } });
            } else {
              toast(errorMessage(err), { tone: "error" });
            }
          } finally {
            setUploads((n) => n - 1);
          }
        });
      }
    },
    [supabase, uploadLimit, upsert, markFresh, read],
  );

  const addPickedFiles = useCallback(
    (files: File[]) => addFiles(files.map((file) => ({ label: file.name, prepare: () => prepareFile(file) }))),
    [addFiles],
  );

  // ----- Scanning ----------------------------------------------------------

  async function addPhoto(file: File) {
    setScanOpen(true);
    setScanBusy(true);
    try {
      const { blob, width, height } = await imageToJpeg(file);
      setScanPages((pages) => [...pages, { blob, width, height, url: URL.createObjectURL(blob) }]);
    } catch {
      toast("Couldn’t use that photo. Try again.", { tone: "error" });
    } finally {
      setScanBusy(false);
    }
  }

  function removePage(index: number) {
    URL.revokeObjectURL(scanPages[index].url);
    setScanPages((pages) => pages.filter((_, i) => i !== index));
  }

  function closeScan() {
    if (scanPages.length && !window.confirm("Discard this scan?")) return;
    scanPages.forEach((p) => URL.revokeObjectURL(p.url));
    setScanPages([]);
    setScanOpen(false);
  }

  function saveScan() {
    const pages = scanPages;
    const now = new Date();
    const name = `Scan ${todayISO()} ${String(now.getHours()).padStart(2, "0")}.${String(now.getMinutes()).padStart(2, "0")}.pdf`;
    setScanPages([]);
    setScanOpen(false);
    addFiles([
      {
        label: "This scan",
        prepare: async () => {
          const blob = await jpegsToPdf(pages);
          pages.forEach((p) => URL.revokeObjectURL(p.url));
          return { blob, name, type: "application/pdf" };
        },
      },
    ]);
  }

  // ----- Downloads ---------------------------------------------------------

  // "3 Jul 2026 · €604.87; 3 Oct 2026 · €604.87" for the summary sheet.
  function paidText(doc: Doc) {
    const lines = txs.filter((t) => t.document_id === doc.id).sort((a, b) => a.booked_on.localeCompare(b.booked_on));
    return lines.length ? lines.map((t) => `${formatDay(t.booked_on)} · ${formatMoney(Math.abs(t.amount), t.currency)}`).join("; ") : null;
  }

  // A single document downloads as itself; more go in a ZIP. `byMonth`: the
  // package for the accounting tool, a folder per month (see downloadZip).
  async function download(list: Doc[], name: string, byMonth = false) {
    if (!list.length || zipping !== null) return false;
    const bytes = list.reduce((sum, d) => sum + d.size_bytes, 0);
    if (bytes > 250 * 1024 * 1024 && !window.confirm(`Download ${list.length} documents (${formatBytes(bytes)})?`)) return false;
    const single = list.length === 1 && !byMonth;
    setZipping(single ? "" : `0/${list.length}`);
    try {
      if (single) {
        await downloadOne(supabase, list[0]);
      } else {
        await downloadZip(supabase, list, name, (done, total) => setZipping(`${done}/${total}`), { byMonth, paid: paidText });
        const unbooked = list.filter((d) => !d.booked_at);
        if (unbooked.length) {
          toast(`Mark ${unbooked.length} as booked in accounting?`, {
            duration: 12000,
            action: { label: "Mark booked", onClick: () => void setBooked(unbooked, true) },
          });
        }
      }
      return true;
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
      return false;
    } finally {
      setZipping(null);
    }
  }

  async function setBooked(list: Doc[], booked: boolean) {
    const ids = list.map((d) => d.id);
    const { data, error } = await supabase
      .from("documents")
      .update({ booked_at: booked ? new Date().toISOString() : null })
      .in("id", ids)
      .select(DOC_COLUMNS);
    if (error) return toast(error.message, { tone: "error" });
    const updated = new Map((data as Doc[]).map((d) => [d.id, d]));
    setDocs((prev) => prev.map((d) => updated.get(d.id) ?? d));
    toast(booked ? `Marked ${ids.length} as booked` : `Marked ${ids.length} as not booked`);
  }

  const downloadRow = useCallback(
    (doc: Doc) => {
      downloadOne(supabase, doc).catch((err) => toast(errorMessage(err), { tone: "error" }));
    },
    [supabase],
  );

  // ----- Email inbox -----------------------------------------------------------

  // Looks for new emails in the connected mailbox (on open, on return, on demand).
  const checkInbox = useCallback(
    async (manual = false) => {
      setChecking(true);
      try {
        const response = await fetch("/api/inbox/sync", { method: "POST" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? `Checking the inbox failed (${response.status})`);
        setInbox(result as InboxState);
      } catch (err) {
        if (manual) toast(errorMessage(err), { tone: "error" });
      } finally {
        setChecking(false);
      }
    },
    [],
  );

  function setItemBusy(id: string, on: boolean) {
    setInboxBusy((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const dropItem = (id: string) => setInbox((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));

  // Imports the ticked attachments, then reads them like any upload.
  async function importEmails(list: { item: InboxItem; parts: string[] }[]) {
    let imported = 0;
    let known = 0;
    for (const { item, parts } of list) {
      if (!parts.length) continue;
      setItemBusy(item.id, true);
      try {
        const response = await fetch("/api/inbox/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, parts }),
        });
        const result = (await response.json().catch(() => ({}))) as { docs?: Doc[]; existing?: string[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? `Import failed (${response.status})`);
        for (const doc of result.docs ?? []) {
          upsert(doc);
          void read(doc.id);
        }
        imported += result.docs?.length ?? 0;
        known += result.existing?.length ?? 0;
        dropItem(item.id);
      } catch (err) {
        toast(`${item.subject ?? "Email"}: ${errorMessage(err)}`, { tone: "error" });
      } finally {
        setItemBusy(item.id, false);
      }
    }
    if (imported || known) {
      toast(
        [imported && `Imported ${imported} ${imported === 1 ? "document" : "documents"}`, known && `${known} already in Documents`]
          .filter(Boolean)
          .join(" · "),
      );
    }
  }

  async function skipEmail(item: InboxItem) {
    setItemBusy(item.id, true);
    const { error } = await supabase
      .from("inbox_items")
      .update({ status: "skipped", decided_at: new Date().toISOString() })
      .eq("id", item.id);
    setItemBusy(item.id, false);
    if (error) return toast(error.message, { tone: "error" });
    dropItem(item.id);
  }

  // ----- Selection -----------------------------------------------------------

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = filtered.length > 0 && selectedDocs.length === filtered.length;
  const someSelected = selectedDocs.length > 0 && !allSelected;

  // ----- Effects -------------------------------------------------------------

  // Finish reading documents left half-done (e.g. the app was closed mid-upload).
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const cutoff = Date.now() - 90_000;
    initialDocs
      .filter((d) => d.status === "processing" && Date.parse(d.created_at) < cutoff)
      .forEach((d) => void read(d.id));
  }, [initialDocs, read]);

  // Check the inbox on open; report how connecting it went (?inbox=…).
  const inboxConnected = Boolean(inbox.connected);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("inbox");
    if (result) {
      router.replace("/");
      const messages: Record<string, string> = {
        connected: "Inbox connected",
        declined: "Google access wasn't granted",
        failed: "Connecting the inbox failed. Try again.",
        not_configured: "The inbox isn't set up on the server yet (Google client id and secret).",
      };
      toast(messages[result] ?? "Inbox: something went wrong", { tone: result === "connected" ? "default" : "error" });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- show the inbox right after connecting
      if (result === "connected") setDialog("inbox");
    }
    if (inboxConnected) void checkInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  // Pick up changes made on another device when coming back to the app.
  useEffect(() => {
    let last = Date.now();
    const refresh = async () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 30_000) return;
      last = Date.now();
      if (inboxConnected) void checkInbox();
      try {
        setDocs(await fetchAllDocuments(supabase));
      } catch {
        // Offline or signed out; keep what we have.
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [supabase, inboxConnected, checkInbox]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, router]);

  // "/" jumps to search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']") || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      searchInput.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Drop files anywhere to upload them.
  const dragging = useFileDrop(addPickedFiles);

  // ----- Render ----------------------------------------------------------------

  const countLabel = selectedDocs.length
    ? `${selectedDocs.length} selected`
    : `${filtered.length} ${filtered.length === 1 ? "document" : "documents"}`;

  return (
    <div className="min-h-dvh">
      <AppHeader active="/" email={email} badges={pending} onAccount={() => setDialog("account")}>
        <button
          type="button"
          onClick={() => setDialog("inbox")}
          aria-label="Import from email"
          className="press relative hidden h-10 items-center gap-2 rounded-full border border-rule-strong/80 bg-card px-4 text-sm font-semibold shadow-card hover:bg-paper sm:flex"
        >
          <Inbox className="size-4" /> From email
          {inbox.items.length > 0 && <InboxCount count={inbox.items.length} />}
        </button>
        <FileButton
          accept="image/*"
          capture
          onFiles={(files) => addPhoto(files[0])}
          className="press hidden h-10 items-center gap-2 rounded-full border border-rule-strong bg-card px-4 text-sm font-semibold shadow-card hover:bg-paper sm:pointer-coarse:flex"
        >
          <Camera className="size-4" /> Scan
        </FileButton>
        <FileButton
          accept={ACCEPT}
          multiple
          onFiles={addPickedFiles}
          className="press hidden h-10 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink shadow-raised hover:bg-accent-hover sm:flex"
        >
          <Upload className="size-4" /> Upload
        </FileButton>
      </AppHeader>

      <main className="mx-auto max-w-5xl animate-page-in px-4 pt-4 pb-36 sm:px-6 sm:pt-6 sm:pb-20">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchField
            inputRef={searchInput}
            value={query}
            onChange={(value) => {
              setQuery(value);
              setLimit(PAGE_SIZE);
            }}
            onClear={() => setQuery("")}
            label="Search documents"
            shortcut
            className="sm:order-last sm:flex-1"
          />
          {/* Two by two on phones, one row on larger screens. */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-nowrap">
            <DateChip range={range} onClick={() => setDialog("dates")} />
            <SelectChip
              label="Category"
              value={category}
              active={category !== ""}
              onChange={(value) => {
                setCategory(value);
                setLimit(PAGE_SIZE);
              }}
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </SelectChip>
            <SelectChip
              label="Status"
              value={status}
              active={status !== ""}
              onChange={(value) => {
                setStatus(value as StatusFilter);
                setLimit(PAGE_SIZE);
              }}
            >
              <option value="">Any status</option>
              <option value="unbooked">Not booked</option>
              <option value="booked">Booked</option>
              <option value="unpaid">No bank payment</option>
            </SelectChip>
            <SelectChip label="Order" value={order} active={false} onChange={(value) => changeOrder(value as ListOrder)}>
              <option value="added">Recently added</option>
              <option value="date">By document date</option>
            </SelectChip>
          </div>
        </div>

        {inbox.items.length > 0 && <InboxStrip count={inbox.items.length} onOpen={() => setDialog("inbox")} />}

        {docs.length > 0 && (
          <div className="mt-5 mb-3 flex min-h-10 items-center gap-3 pl-3 sm:pl-4">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((d) => d.id)))}
              disabled={filtered.length === 0}
              aria-label="Select all"
              className="checkbox"
            />
            <div
              key={selectedDocs.length ? "selection" : "all"}
              className="flex min-w-0 flex-1 animate-fade-in flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-sm"
            >
              <span className="font-semibold">{countLabel}</span>
              {totals.length > 0 && (
                <span className="nums truncate text-muted">{totals.map((t) => formatMoney(t.total, t.currency)).join(" · ")}</span>
              )}
              {selectedDocs.length > 0 && (
                <>
                  <button type="button" onClick={() => setSelected(new Set())} className="font-semibold text-accent hover:underline">
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => void setBooked(selectedDocs, !selectedDocs.every((d) => d.booked_at))}
                    className="font-semibold text-accent hover:underline"
                  >
                    {selectedDocs.every((d) => d.booked_at) ? "Mark not booked" : "Mark booked"}
                  </button>
                </>
              )}
            </div>
            {/* With a selection: download it. Without: pick months for the accountant. */}
            <button
              type="button"
              onClick={() => (selectedDocs.length ? void download(selectedDocs, `Documents ${todayISO()}`) : setDialog("download"))}
              disabled={zipping !== null}
              className={`press flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-50 ${
                selectedDocs.length
                  ? "bg-ink text-paper shadow-raised hover:bg-ink-2"
                  : "border border-rule-strong/80 bg-card shadow-card hover:border-rule-strong hover:bg-paper"
              }`}
            >
              {zipping !== null ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              {zipping ? <span className="nums">{zipping}</span> : selectedDocs.length ? `Download ${selectedDocs.length}` : "Download"}
            </button>
          </div>
        )}

        <AnimatePresence initial={false}>
          {uploads > 0 && (
            <m.div
              key="uploads"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div className="mb-3 flex items-center gap-2.5 rounded-2xl border border-accent/20 bg-accent-soft px-4 py-3 text-sm font-medium text-accent">
                <LoaderCircle className="size-4 animate-spin" />
                Uploading {uploads > 1 ? `${uploads} files` : ""}…
              </div>
            </m.div>
          )}
        </AnimatePresence>

        {docs.length === 0 ? (
          <EmptyState icon={Receipt} behind={[ImageIcon, FileText]} title="No documents yet">
            <span className="sm:hidden">Scan a receipt or add a PDF.</span>
            <span className="hidden sm:inline">Drop files anywhere, or upload.</span>
          </EmptyState>
        ) : filtered.length === 0 ? (
          <div className="mt-12 flex animate-rise flex-col items-center text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-ink/5 text-muted">
              <SearchX className="size-5" />
            </span>
            <p className="mt-3 font-medium">Nothing matches.</p>
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setRange(ALL_TIME);
                  setCategory("");
                  setStatus("");
                  setQuery("");
                }}
                className="press mt-3 h-9 rounded-full border border-rule-strong/80 bg-card px-4 text-sm font-semibold shadow-card hover:bg-paper"
              >
                Show everything
              </button>
            )}
          </div>
        ) : (
          <>
            <DocumentList
              docs={filtered.slice(0, limit)}
              order={order}
              selected={selected}
              reading={reading}
              fresh={fresh}
              paid={payments}
              onToggle={toggle}
              onOpen={setOpenId}
              onDownload={downloadRow}
            />
            {filtered.length > limit && (
              <button
                type="button"
                onClick={() => setLimit((n) => n + PAGE_SIZE)}
                className="press mx-auto mt-6 flex h-11 items-center rounded-full border border-rule-strong/80 bg-card px-5 text-sm font-semibold shadow-card hover:bg-paper"
              >
                Show more ({filtered.length - limit})
              </button>
            )}
          </>
        )}
      </main>

      {/* Phone actions, in thumb reach. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-paper via-paper/90 to-transparent px-4 pt-10 pb-[max(env(safe-area-inset-bottom),1rem)] sm:hidden">
        <div className="pointer-events-auto mx-auto flex max-w-sm items-center gap-3">
          <button
            type="button"
            onClick={() => setDialog("inbox")}
            aria-label="Import from email"
            className="press relative grid size-14 shrink-0 place-items-center rounded-full border border-rule bg-card shadow-raised"
          >
            <Inbox className="size-6" />
            {inbox.items.length > 0 && <InboxCount count={inbox.items.length} />}
          </button>
          <FileButton
            accept={ACCEPT}
            multiple
            onFiles={addPickedFiles}
            label="Upload files"
            className="press grid size-14 shrink-0 place-items-center rounded-full border border-rule bg-card shadow-raised"
          >
            <Plus className="size-6" />
          </FileButton>
          <FileButton
            accept="image/*"
            capture
            onFiles={(files) => addPhoto(files[0])}
            className="press flex h-14 flex-1 items-center justify-center gap-2.5 rounded-full bg-accent text-[1.05rem] font-semibold text-accent-ink shadow-[0_12px_30px_-10px_var(--color-accent)]"
          >
            <Camera className="size-5" /> Scan
          </FileButton>
        </div>
      </div>

      {dragging && <DropOverlay label="Drop to add" />}

      <DateRangeDialog
        open={dialog === "dates"}
        value={range}
        onClose={() => setDialog(null)}
        onChange={(next) => {
          setRange(next.from || next.to ? next : ALL_TIME);
          setLimit(PAGE_SIZE);
        }}
      />
      <AccountDialog
        open={dialog === "account"}
        email={email}
        supabase={supabase}
        docs={docs}
        inbox={inbox.connected}
        onOpenInbox={() => setDialog("inbox")}
        onDisconnected={() => setInbox({ connected: null, checkedAt: null, items: [] })}
        onClose={() => setDialog(null)}
      />
      <InboxDialog
        open={dialog === "inbox"}
        inbox={inbox}
        checking={checking}
        busy={inboxBusy}
        onClose={() => setDialog(null)}
        onCheck={() => void checkInbox(true)}
        onImport={(list) => void importEmails(list)}
        onSkip={(item) => void skipEmail(item)}
      />
      <DownloadDialog
        open={dialog === "download"}
        docs={docs}
        reading={uploads + docs.filter((d) => d.status === "processing" || reading.has(d.id)).length}
        progress={zipping}
        onClose={() => setDialog(null)}
        onDownload={async (list, name) => {
          if (await download(list, name, true)) setDialog((d) => (d === "download" ? null : d));
        }}
      />
      <ScanDialog
        open={scanOpen}
        pages={scanPages}
        busy={scanBusy}
        onPhoto={addPhoto}
        onRemovePage={removePage}
        onSave={saveScan}
        onClose={closeScan}
      />
      <DocumentPanel
        supabase={supabase}
        doc={openDoc}
        payments={openDoc ? txs.filter((t) => t.document_id === openDoc.id) : []}
        reading={openDoc ? reading.has(openDoc.id) : false}
        onClose={() => setOpenId(null)}
        onSaved={upsert}
        onDeleted={(id) => {
          setOpenId(null);
          setDocs((prev) => prev.filter((d) => d.id !== id));
          setSelected((s) => {
            const next = new Set(s);
            next.delete(id);
            return next;
          });
        }}
        onRead={(id) => void read(id)}
      />
    </div>
  );
}

function InboxCount({ count }: { count: number }) {
  return (
    <span
      key={count}
      className="nums absolute -top-1 -right-1 grid h-5 min-w-5 animate-pop place-items-center rounded-full bg-accent px-1 text-[0.7rem] leading-none font-semibold text-accent-ink ring-2 ring-paper"
      title={`${count} to review`}
    >
      {count}
    </span>
  );
}
