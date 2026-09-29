"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

type Toast = {
  id: number;
  message: string;
  tone: "default" | "error";
  action?: { label: string; onClick: () => void };
};

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const EMPTY: Toast[] = [];

function emit() {
  listeners.forEach((listener) => listener());
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(
  message: string,
  options: { tone?: Toast["tone"]; action?: Toast["action"]; duration?: number } = {},
) {
  const id = nextId++;
  toasts = [...toasts.filter((t) => t.message !== message), { id, message, tone: options.tone ?? "default", action: options.action }].slice(-3);
  emit();
  setTimeout(() => dismissToast(id), options.duration ?? (options.tone === "error" ? 7000 : 4000));
  return id;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function Toaster() {
  const items = useSyncExternalStore(subscribe, () => toasts, () => EMPTY);
  const ref = useRef<HTMLDivElement>(null);

  // Shown as a popover so toasts sit in the top layer, above open dialogs.
  // Re-showing moves it to the top of the stack.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function") return;
    try {
      if (el.matches(":popover-open")) el.hidePopover();
      if (items.length) el.showPopover();
    } catch {
      // Popover unsupported or detached: the fixed-position fallback still shows.
    }
  }, [items]);

  return (
    <div
      ref={ref}
      popover="manual"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-auto bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 m-0 flex h-auto w-auto flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-0 px-4 text-inherit sm:bottom-6 [&:not(:popover-open)]:hidden"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex max-w-md animate-rise items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${
            t.tone === "error" ? "bg-danger text-white" : "bg-ink text-paper"
          }`}
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.onClick();
                dismissToast(t.id);
              }}
              className="shrink-0 font-semibold underline underline-offset-2"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
