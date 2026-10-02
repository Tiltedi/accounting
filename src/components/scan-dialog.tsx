"use client";

import { Camera, Check, LoaderCircle, X } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/dialog";
import { FileButton } from "@/components/file-button";
import type { ScanPage } from "@/lib/files";

export function ScanDialog({
  open,
  pages,
  busy,
  onPhoto,
  onRemovePage,
  onSave,
  onClose,
}: {
  open: boolean;
  pages: ScanPage[];
  busy: boolean;
  onPhoto: (file: File) => void;
  onRemovePage: (index: number) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const count = pages.length;
  return (
    <Dialog open={open} onClose={onClose} width={560} label="Scan">
      <DialogHeader title={count ? `${count} ${count === 1 ? "page" : "pages"}` : "Scan"} onClose={onClose} />
      <div className="grid min-h-0 grid-cols-3 gap-3 overflow-y-auto overscroll-contain p-5">
        {pages.map((page, i) => (
          <figure key={page.url} className="relative aspect-[3/4] animate-pop overflow-hidden rounded-xl border border-rule bg-paper shadow-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={page.url} alt={`Page ${i + 1}`} className="size-full object-contain" />
            <span className="nums absolute bottom-1.5 left-1.5 rounded-md bg-ink/75 px-1.5 text-xs text-paper">{i + 1}</span>
            <button
              type="button"
              onClick={() => onRemovePage(i)}
              aria-label={`Remove page ${i + 1}`}
              className="press absolute top-1 right-1 grid size-8 place-items-center rounded-full bg-ink/70 text-paper backdrop-blur-sm hover:bg-ink/85"
            >
              <X className="size-4" />
            </button>
          </figure>
        ))}
        {busy && (
          <div className="skeleton grid aspect-[3/4] place-items-center rounded-xl border border-rule">
            <LoaderCircle className="size-6 animate-spin text-muted" />
          </div>
        )}
        <FileButton
          accept="image/*"
          capture
          disabled={busy}
          onFiles={(files) => onPhoto(files[0])}
          className="press flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-rule-strong text-sm font-medium text-muted hover:border-accent hover:bg-accent-soft/40 hover:text-accent"
        >
          <Camera className="size-6" />
          {count ? "Add page" : "Take photo"}
        </FileButton>
      </div>
      <div className="border-t border-rule p-4">
        <button
          type="button"
          onClick={onSave}
          disabled={!count || busy}
          className="press flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent font-semibold text-accent-ink shadow-raised hover:bg-accent-hover disabled:opacity-40 disabled:shadow-none"
        >
          <Check className="size-5" /> Save
        </button>
      </div>
    </Dialog>
  );
}
