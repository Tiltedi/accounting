"use client";

import { useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/dialog";
import { normalizeUrl, type VendorLink } from "@/lib/bank";

export type BillingDraft = { id?: string; pattern: string; url: string };

// Add or edit where a supplier's invoices can be downloaded.
export function BillingDialog({
  draft,
  onClose,
  onSave,
  onDelete,
}: {
  draft: BillingDraft | null;
  onClose: () => void;
  onSave: (link: Omit<VendorLink, "id"> & { id?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <Dialog open={draft !== null} onClose={onClose} width={480} label="Billing page">
      {draft && <Form key={draft.id ?? draft.pattern} draft={draft} onClose={onClose} onSave={onSave} onDelete={onDelete} />}
    </Dialog>
  );
}

function Form({
  draft,
  onClose,
  onSave,
  onDelete,
}: {
  draft: BillingDraft;
  onClose: () => void;
  onSave: (link: Omit<VendorLink, "id"> & { id?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [pattern, setPattern] = useState(draft.pattern);
  const [url, setUrl] = useState(draft.url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const href = normalizeUrl(url);
    if (pattern.trim().length < 2) return setError("Add a name of at least 2 letters.");
    if (!href) return setError("That doesn't look like a link.");
    setBusy(true);
    try {
      await onSave({ id: draft.id, pattern: pattern.trim(), url: href });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
      setBusy(false);
    }
  }

  const field =
    "mt-1.5 h-11 w-full rounded-xl border border-rule-strong/80 bg-card px-3.5 text-base font-normal shadow-card outline-none transition hover:border-rule-strong focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-[0.95rem]";

  return (
    <form onSubmit={submit}>
      <DialogHeader title="Billing page" onClose={onClose} />
      <div className="space-y-4 p-5">
        <label className="block text-sm font-medium">
          Link
          <input
            type="text"
            inputMode="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="supabase.com/dashboard/org/_/billing"
            className={field}
          />
        </label>
        <label className="block text-sm font-medium">
          For lines containing
          <input type="text" value={pattern} onChange={(e) => setPattern(e.target.value)} className={field} />
        </label>
        {error && (
          <p role="alert" className="animate-rise text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-rule px-5 py-3">
        {draft.id && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onDelete(draft.id!).catch(() => setBusy(false));
            }}
            className="press flex h-10 items-center gap-2 rounded-full px-3 text-sm font-medium text-danger hover:bg-danger-soft"
          >
            <Trash2 className="size-4" /> Remove
          </button>
        )}
        <div className="flex-1" />
        <button
          type="submit"
          disabled={busy}
          className="press flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink shadow-raised hover:bg-accent-hover disabled:opacity-60"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" />} Save
        </button>
      </div>
    </form>
  );
}
