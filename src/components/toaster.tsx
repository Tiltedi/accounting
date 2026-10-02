"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { AnimatePresence, m } from "motion/react";
import { CircleAlert } from "lucide-react";

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
let raise = () => {};

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

// Keeps visible toasts above a dialog that opened after them.
export function raiseToaster() {
  raise();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isOpen(el: HTMLElement) {
  try {
    return el.matches(":popover-open");
  } catch {
    return false;
  }
}

export function Toaster() {
  const items = useSyncExternalStore(subscribe, () => toasts, () => EMPTY);
  const ref = useRef<HTMLDivElement>(null);

  // Shown as a popover so toasts sit in the top layer, above open dialogs.
  // Re-showing moves it to the top of the stack.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function") return;
    const show = () => {
      try {
        if (isOpen(el)) el.hidePopover();
        el.showPopover();
      } catch {
        // Popover unsupported or detached: the fixed-position fallback still shows.
      }
    };
    raise = () => {
      if (isOpen(el)) show();
    };
    if (items.length) show();
  }, [items]);

  // Hidden only once the last toast has finished animating out.
  function hideWhenEmpty() {
    const el = ref.current;
    if (!toasts.length && el && isOpen(el)) el.hidePopover();
  }

  return (
    <div
      ref={ref}
      popover="manual"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-auto bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 m-0 flex h-auto w-auto flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-0 px-4 text-inherit sm:bottom-6 [&:not(:popover-open)]:hidden"
    >
      <AnimatePresence mode="popLayout" initial={false} onExitComplete={hideWhenEmpty}>
        {items.map((t) => (
          <m.div
            key={t.id}
            layout
            role={t.tone === "error" ? "alert" : "status"}
            initial={{ opacity: 0, y: 24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.16, ease: "easeIn" } }}
            transition={{ type: "spring", duration: 0.45, bounce: 0.22 }}
            className={`pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl py-2.5 text-sm shadow-float ring-1 ring-black/5 ${
              t.action ? "pr-2 pl-4" : "px-4"
            } ${t.tone === "error" ? "bg-danger text-white" : "bg-ink text-paper"}`}
          >
            {t.tone === "error" && <CircleAlert className="size-4 shrink-0" />}
            <span className="py-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  dismissToast(t.id);
                }}
                className={`press h-8 shrink-0 rounded-xl px-3 font-semibold ${
                  t.tone === "error" ? "bg-white/20 hover:bg-white/30" : "bg-paper/15 hover:bg-paper/25"
                }`}
              >
                {t.action.label}
              </button>
            )}
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
