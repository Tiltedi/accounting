"use client";

import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Camera, ChevronDown, Download, LoaderCircle, Plus, Search, Upload, X } from "lucide-react";
import { AccountDialog } from "@/components/account-dialog";
import { DateRangeDialog } from "@/components/date-range-dialog";
import { DocumentList } from "@/components/document-list";
import { DocumentPanel } from "@/components/document-panel";
import { FileButton } from "@/components/file-button";
import { AppHeader } from "@/components/app-header";
import { Logo } from "@/components/logo";
import { ScanDialog } from "@/components/scan-dialog";
import { toast } from "@/components/toaster";
import { CATEGORIES } from "@/lib/categories";
import { ALL_TIME, inRange, rangeLabel, todayISO, type DateRange } from "@/lib/dates";
import type { Transaction } from "@/lib/bank";
import { DOC_COLUMNS, compareDocs, fetchAllDocuments, type Doc } from "@/lib/documents";
import { downloadOne, downloadZip } from "@/lib/export";
import { createLimiter, imageToJpeg, jpegsToPdf, type ScanPage } from "@/lib/files";
import { formatBytes, formatMoney, totalsByCurrency } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
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

export function Dashboard({ initialDocs, initialTxs, email }: { initialDocs: Doc[]; initialTxs: Transaction[]; email: string }) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [uploadLimit] = useState(() => createLimiter(3));
  const [readLimit] = useState(() => createLimiter(3));

  const [docs, setDocs] = useState(initialDocs);
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [payments] = useState(() => new Map(initialTxs.filter((t) => t.document_id).map((t) => [t.document_id!, t])));
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [reading, setReading] = useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploads, setUploads] = useState(0);
  const [zipping, setZipping] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"dates" | "account" | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanPages, setScanPages] = useState<ScanPage[]>([]);
  const [scanBusy, setScanBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const resumed = useRef(false);

  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return docs.filter(
      (d) =>
        inRange(d.doc_date, range) &&
        (!category || d.category === category) &&
        matchesStatus(d, status, payments) &&
        (!q || searchText(d).includes(q)),
    );
  }, [docs, range, category, status, payments, deferredQuery]);

  const selectedDocs = useMemo(() => filtered.filter((d) => selected.has(d.id)), [filtered, selected]);
  const scope = selectedDocs.length ? selectedDocs : filtered;
  const totals = useMemo(() => totalsByCurrency(scope), [scope]);
  const openDoc = openId ? (docs.find((d) => d.id === openId) ?? null) : null;
  const filtersActive = range !== ALL_TIME || category !== "" || status !== "" || query !== "";

  const upsert = useCallback((doc: Doc) => {
    setDocs((prev) => [...prev.filter((d) => d.id !== doc.id), doc].sort(compareDocs));
  }, []);

  const read = useCallback(
    (id: string) => {
      setReading((s) => new Set(s).add(id));
      return readLimit(async () => {
        try {
          const result = await requestExtraction(id);
          if (result.doc) upsert(result.doc);
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
    [readLimit, upsert],
  );

  const addFiles = useCallback(
    (items: { label: string; prepare: () => Promise<PreparedFile> }[]) => {
      setUploads((n) => n + items.length);
      for (const item of items) {
        void uploadLimit(async () => {
          try {
            const doc = await uploadDocument(supabase, await item.prepare());
            upsert(doc);
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
    [supabase, uploadLimit, upsert, read],
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

  async function download(list: Doc[]) {
    if (!list.length || zipping !== null) return;
    const bytes = list.reduce((sum, d) => sum + d.size_bytes, 0);
    if (bytes > 250 * 1024 * 1024 && !window.confirm(`Download ${list.length} documents (${formatBytes(bytes)})?`)) return;
    setZipping(list.length === 1 ? "" : `0/${list.length}`);
    try {
      if (list.length === 1) {
        await downloadOne(supabase, list[0]);
      } else {
        const name = selectedDocs.length
          ? `Documents ${todayISO()}`
          : ["Documents", rangeLabel(range), category].filter(Boolean).join(" – ");
        await downloadZip(supabase, list, name, (done, total) => setZipping(`${done}/${total}`));
        const unbooked = list.filter((d) => !d.booked_at);
        if (unbooked.length) {
          toast(`Mark ${unbooked.length} as booked in accounting?`, {
            duration: 12000,
            action: { label: "Mark booked", onClick: () => void setBooked(unbooked, true) },
          });
        }
      }
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
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

  // Pick up changes made on another device when coming back to the app.
  useEffect(() => {
    let last = Date.now();
    const refresh = async () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 30_000) return;
      last = Date.now();
      try {
        setDocs(await fetchAllDocuments(supabase));
      } catch {
        // Offline or signed out; keep what we have.
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [supabase]);

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
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("Files"));
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) addPickedFiles(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [addPickedFiles]);

  // ----- Render ----------------------------------------------------------------

  const countLabel = selectedDocs.length
    ? `${selectedDocs.length} selected`
    : `${filtered.length} ${filtered.length === 1 ? "document" : "documents"}`;

  return (
    <div className="min-h-dvh">
      <AppHeader active="/" email={email} onAccount={() => setDialog("account")}>
        <FileButton
          accept="image/*"
          capture
          onFiles={(files) => addPhoto(files[0])}
          className="hidden h-10 items-center gap-2 rounded-full border border-rule-strong px-4 text-sm font-semibold hover:bg-ink/5 sm:pointer-coarse:flex"
        >
          <Camera className="size-4" /> Scan
        </FileButton>
        <FileButton
          accept={ACCEPT}
          multiple
          onFiles={addPickedFiles}
          className="hidden h-10 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover sm:flex"
        >
          <Upload className="size-4" /> Upload
        </FileButton>
      </AppHeader>

      <main className="mx-auto max-w-5xl px-4 pt-4 pb-36 sm:px-6 sm:pt-6 sm:pb-20">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative sm:order-last sm:flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchInput}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE_SIZE);
              }}
              placeholder="Search"
              aria-label="Search documents"
              className="h-11 w-full rounded-full border border-rule-strong bg-card pr-10 pl-10 text-base outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-[0.95rem] [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-ink/5"
              >
                <X className="size-4" />
              </button>
            ) : (
              <kbd className="nums pointer-events-none absolute top-1/2 right-3.5 hidden -translate-y-1/2 rounded border border-rule-strong px-1.5 text-xs text-muted pointer-fine:block">
                /
              </kbd>
            )}
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            <button
              type="button"
              onClick={() => setDialog("dates")}
              className={`flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full border px-4 text-[0.95rem] font-medium transition sm:flex-none ${
                range === ALL_TIME ? "border-rule-strong bg-card hover:bg-ink/5" : "border-accent bg-accent-soft text-accent"
              }`}
            >
              <CalendarDays className="size-4 shrink-0" />
              <span className="truncate">{rangeLabel(range)}</span>
              <ChevronDown className="ml-auto size-4 shrink-0 opacity-60" />
            </button>
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setLimit(PAGE_SIZE);
                }}
                aria-label="Category"
                className={`h-11 w-full appearance-none rounded-full border py-0 pr-9 pl-4 text-[0.95rem] font-medium outline-none transition focus:ring-4 focus:ring-accent/15 sm:w-auto ${
                  category ? "border-accent bg-accent-soft text-accent" : "border-rule-strong bg-card hover:bg-ink/5"
                }`}
              >
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 opacity-60" />
            </div>
            <div className="relative min-w-0 basis-full sm:basis-auto">
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as StatusFilter);
                  setLimit(PAGE_SIZE);
                }}
                aria-label="Status"
                className={`h-11 w-full appearance-none rounded-full border py-0 pr-9 pl-4 text-[0.95rem] font-medium outline-none transition focus:ring-4 focus:ring-accent/15 sm:w-auto ${
                  status ? "border-accent bg-accent-soft text-accent" : "border-rule-strong bg-card hover:bg-ink/5"
                }`}
              >
                <option value="">Any status</option>
                <option value="unbooked">Not booked</option>
                <option value="booked">Booked</option>
                <option value="unpaid">No bank payment</option>
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 opacity-60" />
            </div>
          </div>
        </div>

        {docs.length > 0 && (
          <div className="mt-5 mb-3 flex items-center gap-3 pl-3 sm:pl-4">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((d) => d.id)))}
              disabled={filtered.length === 0}
              aria-label="Select all"
              className="size-[1.1rem] shrink-0 cursor-pointer accent-(--color-accent)"
            />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold">{countLabel}</span>
              {totals.length > 0 && (
                <span className="nums truncate text-muted">{totals.map((t) => formatMoney(t.total, t.currency)).join(" · ")}</span>
              )}
              {selectedDocs.length > 0 && (
                <>
                  <button type="button" onClick={() => setSelected(new Set())} className="font-medium text-accent hover:underline">
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => void setBooked(selectedDocs, !selectedDocs.every((d) => d.booked_at))}
                    className="font-medium text-accent hover:underline"
                  >
                    {selectedDocs.every((d) => d.booked_at) ? "Mark not booked" : "Mark booked"}
                  </button>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => download(scope)}
              disabled={scope.length === 0 || zipping !== null}
              className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-rule-strong bg-card px-4 text-sm font-semibold transition hover:bg-ink/5 disabled:opacity-50"
            >
              {zipping !== null ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              {zipping ? <span className="nums">{zipping}</span> : selectedDocs.length ? `Download ${selectedDocs.length}` : "Download all"}
            </button>
          </div>
        )}

        {uploads > 0 && (
          <div className="mb-3 flex animate-rise items-center gap-2.5 rounded-2xl border border-rule bg-card px-4 py-3 text-sm font-medium">
            <LoaderCircle className="size-4 animate-spin text-accent" />
            Uploading {uploads > 1 ? `${uploads} files` : ""}…
          </div>
        )}

        {docs.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <div className="mt-10 text-center">
            <p className="font-medium">Nothing matches.</p>
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setRange(ALL_TIME);
                  setCategory("");
                  setStatus("");
                  setQuery("");
                }}
                className="mt-2 text-sm font-semibold text-accent hover:underline"
              >
                Show everything
              </button>
            )}
          </div>
        ) : (
          <>
            <DocumentList
              docs={filtered.slice(0, limit)}
              selected={selected}
              reading={reading}
              paid={payments}
              onToggle={toggle}
              onOpen={setOpenId}
              onDownload={downloadRow}
            />
            {filtered.length > limit && (
              <button
                type="button"
                onClick={() => setLimit((n) => n + PAGE_SIZE)}
                className="mx-auto mt-6 flex h-11 items-center rounded-full border border-rule-strong bg-card px-5 text-sm font-semibold hover:bg-ink/5"
              >
                Show more ({filtered.length - limit})
              </button>
            )}
          </>
        )}
      </main>

      {/* Phone actions, in thumb reach. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-paper via-paper/90 to-transparent px-4 pt-8 pb-[max(env(safe-area-inset-bottom),1rem)] sm:hidden">
        <div className="pointer-events-auto mx-auto flex max-w-sm items-center gap-3">
          <FileButton
            accept={ACCEPT}
            multiple
            onFiles={addPickedFiles}
            label="Upload files"
            className="grid size-14 shrink-0 place-items-center rounded-full border border-rule-strong bg-card shadow-sm"
          >
            <Plus className="size-6" />
          </FileButton>
          <FileButton
            accept="image/*"
            capture
            onFiles={(files) => addPhoto(files[0])}
            className="flex h-14 flex-1 items-center justify-center gap-2.5 rounded-full bg-accent text-[1.05rem] font-semibold text-accent-ink shadow-[0_10px_30px_-10px_var(--color-accent)]"
          >
            <Camera className="size-5" /> Scan
          </FileButton>
        </div>
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-accent/10 p-6 backdrop-blur-[1px]">
          <div className="grid h-full w-full place-items-center rounded-3xl border-2 border-dashed border-accent text-lg font-semibold text-accent">
            Drop to add
          </div>
        </div>
      )}

      <DateRangeDialog
        open={dialog === "dates"}
        value={range}
        onClose={() => setDialog(null)}
        onChange={(next) => {
          setRange(next.from || next.to ? next : ALL_TIME);
          setLimit(PAGE_SIZE);
        }}
      />
      <AccountDialog open={dialog === "account"} email={email} supabase={supabase} docs={docs} onClose={() => setDialog(null)} />
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
        payment={openDoc ? (payments.get(openDoc.id) ?? null) : null}
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

function EmptyState() {
  return (
    <div className="ruled mt-6 flex animate-rise flex-col items-center rounded-3xl border border-dashed border-rule-strong px-6 py-16 text-center">
      <Logo className="size-12" />
      <p className="mt-4 text-lg font-semibold">No documents yet</p>
      <p className="mt-1 text-sm text-muted">
        <span className="sm:hidden">Scan a receipt or add a PDF.</span>
        <span className="hidden sm:inline">Drop files anywhere, or upload.</span>
      </p>
    </div>
  );
}
