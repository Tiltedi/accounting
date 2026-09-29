"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";

// Native <dialog>: focus trap, Escape to close and top-layer rendering for free.
// Bottom sheet on phones; `drawer` slides in from the right and `center`
// floats in the middle on larger screens.
export function Dialog({
  open,
  onClose,
  variant = "center",
  width,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  variant?: "center" | "drawer";
  width?: number;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={`app-dialog ${variant}`}
      style={width ? ({ "--dialog-width": `${width}px` } as CSSProperties) : undefined}
      onClose={onClose}
      onCancel={(event) => {
        // Escape: let the owner decide (it may ask before discarding).
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the dialog element itself is a click on the backdrop.
        if (event.target === ref.current) onClose();
      }}
    >
      {open && <div className="dialog-panel">{children}</div>}
    </dialog>
  );
}

export function DialogHeader({ title, onClose, children }: { title: ReactNode; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-rule px-5 py-3.5">
      <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
      {children}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="-mr-2 grid size-10 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
      >
        <X className="size-5" />
      </button>
    </div>
  );
}
