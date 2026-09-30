"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, Download, ExternalLink, FileText, LoaderCircle, RotateCw, Trash2 } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/dialog";
import { toast } from "@/components/toaster";
import { CATEGORIES, DOC_TYPES } from "@/lib/categories";
import { BUCKET, DOC_COLUMNS, isImage, isPdf, type Client, type Doc, type DocUpdate } from "@/lib/documents";
import { downloadOne } from "@/lib/export";
import type { Transaction } from "@/lib/bank";
import { formatBytes, formatDay, formatMoney, parseAmount } from "@/lib/format";
import { useMediaQuery } from "@/lib/use-media-query";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "CAD", "AUD", "JPY"];

type Props = {
  supabase: Client;
  doc: Doc | null;
  reading: boolean;
  payment?: Transaction | null;
  onClose: () => void;
  onSaved: (doc: Doc) => void;
  onDeleted: (id: string) => void;
  onRead: (id: string) => void;
};

export function DocumentPanel({ doc, onClose, ...rest }: Props) {
  return (
    <Dialog open={doc !== null} onClose={onClose} variant="drawer" label="Document">
      {/* Remount after a read finishes so the form shows the fresh details. */}
      {doc && <PanelBody key={`${doc.id}:${doc.status}:${rest.reading}`} doc={doc} onClose={onClose} {...rest} />}
    </Dialog>
  );
}

type Form = Record<
  "vendor" | "doc_date" | "total" | "tax" | "currency" | "category" | "doc_type" | "invoice_number" | "description" | "notes",
  string
>;

function toForm(doc: Doc): Form {
  return {
    vendor: doc.vendor ?? "",
    doc_date: doc.doc_date,
    total: doc.total != null ? doc.total.toFixed(2) : "",
    tax: doc.tax != null ? doc.tax.toFixed(2) : "",
    currency: doc.currency ?? "",
    category: doc.category,
    doc_type: doc.doc_type ?? "",
    invoice_number: doc.invoice_number ?? "",
    description: doc.description ?? "",
    notes: doc.notes ?? "",
  };
}

function PanelBody({ supabase, doc, reading, payment, onClose, onSaved, onDeleted, onRead }: Omit<Props, "doc"> & { doc: Doc }) {
  const initial = toForm(doc);
  const [form, setForm] = useState<Form>(initial);
  const [busy, setBusy] = useState<"save" | "delete" | "download" | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 640px)");

  const processing = reading || doc.status === "processing";
  const dirty = (Object.keys(form) as (keyof Form)[]).some((key) => form[key] !== initial[key]);

  useEffect(() => {
    let cancelled = false;
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.file_path, 3600)
      .then(({ data }) => {
        if (!cancelled) setPreviewUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, doc.file_path]);

  const set = (key: keyof Form) => (event: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: event.target.value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    const currency = form.currency.trim().toUpperCase();
    if (currency && !/^[A-Z]{3}$/.test(currency)) return toast("Currency must be a 3-letter code.", { tone: "error" });

    const update: DocUpdate = {
      vendor: form.vendor.trim() || null,
      doc_date: form.doc_date || doc.doc_date,
      total: parseAmount(form.total),
      tax: parseAmount(form.tax),
      currency: currency || null,
      category: form.category,
      doc_type: form.doc_type || null,
      invoice_number: form.invoice_number.trim() || null,
      description: form.description.trim() || null,
      notes: form.notes.trim() || null,
    };

    setBusy("save");
    const { data, error } = await supabase.from("documents").update(update).eq("id", doc.id).select(DOC_COLUMNS).single();
    setBusy(null);
    if (error) return toast(error.message, { tone: "error" });
    setForm(toForm(data as Doc)); // show the values as stored, e.g. "1.234,50" → "1234.50"
    onSaved(data as Doc);
    toast("Saved");
  }

  const [booked, setBooked] = useState(Boolean(doc.booked_at));

  async function toggleBooked() {
    const next = !booked;
    setBooked(next);
    const { data, error } = await supabase
      .from("documents")
      .update({ booked_at: next ? new Date().toISOString() : null })
      .eq("id", doc.id)
      .select(DOC_COLUMNS)
      .single();
    if (error) {
      setBooked(!next);
      return toast(error.message, { tone: "error" });
    }
    onSaved(data as Doc);
  }

  async function remove() {
    if (!window.confirm(`Delete “${doc.vendor || doc.file_name}”? This cannot be undone.`)) return;
    setBusy("delete");
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) {
      setBusy(null);
      return toast(error.message, { tone: "error" });
    }
    await supabase.storage.from(BUCKET).remove([doc.file_path]);
    onDeleted(doc.id);
    toast("Deleted");
  }

  async function download() {
    setBusy("download");
    try {
      await downloadOne(supabase, doc);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Download failed", { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <DialogHeader title={doc.vendor || doc.file_name} onClose={onClose} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Preview doc={doc} url={previewUrl} inline={wide} />

        {processing && (
          <Banner>
            <LoaderCircle className="size-4 animate-spin" /> Reading the document…
          </Banner>
        )}
        {!processing && doc.status === "failed" && (
          <Banner tone="warn">
            <span className="flex-1">Couldn’t read this one. Fill it in, or try again.</span>
            <button type="button" onClick={() => onRead(doc.id)} className="font-semibold underline underline-offset-2">
              Try again
            </button>
          </Banner>
        )}

        <div className="mx-5 mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex cursor-pointer items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={booked}
              onChange={toggleBooked}
              className="size-[1.1rem] cursor-pointer accent-(--color-accent)"
            />
            Booked in accounting
          </label>
          {payment !== undefined && (
            <span className={payment ? "text-accent" : "text-muted"}>
              {payment
                ? `Paid${payment.source === "card" ? " by card" : ""} ${formatDay(payment.booked_on)} · ${formatMoney(Math.abs(payment.amount), payment.currency)}`
                : "No payment linked"}
            </span>
          )}
        </div>

        <form id="doc-form" onSubmit={save} className="grid grid-cols-2 gap-x-3 gap-y-4 px-5 py-5">
          <fieldset disabled={processing} className="contents">
            <Field label="Vendor" className="col-span-2">
              <input value={form.vendor} onChange={set("vendor")} className={input} placeholder="Who issued it" />
            </Field>
            <Field label="Date">
              <input type="date" required value={form.doc_date} onChange={set("doc_date")} className={`${input} nums`} />
            </Field>
            <Field label="Category">
              <Select value={form.category} onChange={set("category")}>
                {CATEGORIES.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Total">
              <input value={form.total} onChange={set("total")} inputMode="decimal" className={`${input} nums`} placeholder="0.00" />
            </Field>
            <Field label="Currency">
              <Select value={form.currency} onChange={set("currency")}>
                <option value="">—</option>
                {[...new Set([...CURRENCIES, ...(doc.currency ? [doc.currency] : [])])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="VAT">
              <input value={form.tax} onChange={set("tax")} inputMode="decimal" className={`${input} nums`} placeholder="0.00" />
            </Field>
            <Field label="Type">
              <Select value={form.doc_type} onChange={set("doc_type")}>
                <option value="">—</option>
                {DOC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Number" className="col-span-2">
              <input value={form.invoice_number} onChange={set("invoice_number")} className={`${input} nums`} />
            </Field>
            <Field label="Description" className="col-span-2">
              <input value={form.description} onChange={set("description")} className={input} />
            </Field>
            <Field label="Notes" className="col-span-2">
              <textarea value={form.notes} onChange={set("notes")} rows={2} className={`${input} h-auto py-2.5`} />
            </Field>
          </fieldset>
          <p className="col-span-2 truncate text-xs text-muted">
            {doc.file_name} · {formatBytes(doc.size_bytes)}
          </p>
        </form>
      </div>

      <div className="flex items-center gap-1 border-t border-rule px-3 py-3 sm:px-4">
        <IconButton label="Delete" onClick={remove} disabled={busy !== null} danger>
          {busy === "delete" ? <LoaderCircle className="size-5 animate-spin" /> : <Trash2 className="size-5" />}
        </IconButton>
        <IconButton label="Read again" onClick={() => onRead(doc.id)} disabled={processing || busy !== null}>
          <RotateCw className="size-5" />
        </IconButton>
        <div className="flex-1" />
        <button
          type="button"
          onClick={download}
          disabled={busy !== null}
          className="flex h-11 items-center gap-2 rounded-full border border-rule-strong px-4 text-sm font-semibold hover:bg-ink/5 disabled:opacity-50"
        >
          {busy === "download" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
          Download
        </button>
        <button
          type="submit"
          form="doc-form"
          disabled={!dirty || processing || busy !== null}
          className="flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-40"
        >
          {busy === "save" && <LoaderCircle className="size-4 animate-spin" />}
          Save
        </button>
      </div>
    </>
  );
}

const input =
  "h-11 w-full rounded-xl border border-rule-strong bg-card px-3 text-base outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15 disabled:opacity-60 sm:text-[0.95rem]";

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
}) {
  return (
    <span className="relative block">
      <select value={value} onChange={onChange} className={`${input} appearance-none pr-9`}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
    </span>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-xs font-medium tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

function Banner({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return (
    <div
      className={`mx-5 mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm ${
        tone === "warn" ? "bg-warn/10 text-warn" : "bg-accent-soft text-accent"
      }`}
    >
      {children}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid size-11 place-items-center rounded-full transition disabled:opacity-40 ${
        danger ? "text-danger hover:bg-danger-soft" : "text-muted hover:bg-ink/5 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Preview({ doc, url, inline }: { doc: Doc; url: string | null; inline: boolean }) {
  if (isImage(doc) && doc.mime_type !== "image/heic" && doc.mime_type !== "image/heif") {
    return (
      <a href={url ?? undefined} target="_blank" rel="noreferrer" className="block border-b border-rule bg-paper">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="mx-auto max-h-[30dvh] w-auto object-contain sm:max-h-[46dvh]" />
        ) : (
          <div className="h-[30dvh] animate-pulse sm:h-64" />
        )}
      </a>
    );
  }

  if (isPdf(doc) && inline) {
    return (
      <div className="h-[52dvh] border-b border-rule bg-paper">
        {url ? <iframe src={url} title="Preview" className="size-full" /> : <div className="size-full animate-pulse" />}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 border-b border-rule bg-paper px-5 py-5">
      <FileText className="size-8 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{doc.file_name}</span>
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        aria-disabled={!url}
        className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-rule-strong bg-card px-4 text-sm font-semibold"
      >
        <ExternalLink className="size-4" /> Open
      </a>
    </div>
  );
}
