"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { m } from "motion/react";

export type TabOption<T extends string> = { id: T; label: string; count: number; tone?: "danger" | "accent" };

// Pill tabs with an indicator that slides to the selected tab, and arrow keys
// to move between them (after 21st.dev's "Animated Tabs").
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: TabOption<T>[]; value: T; onChange: (id: T) => void }) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);

  // On phones the row scrolls sideways: keep the selected tab in view.
  useEffect(() => {
    const row = list.current;
    const tab = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !tab || row.scrollWidth <= row.clientWidth) return;
    const left = tab.offsetLeft - 16;
    const right = tab.offsetLeft + tab.offsetWidth + 16 - row.clientWidth;
    if (row.scrollLeft > left) row.scrollTo({ left, behavior: "smooth" });
    else if (row.scrollLeft < right) row.scrollTo({ left: right, behavior: "smooth" });
  }, [value]);

  function onKeyDown(event: KeyboardEvent, index: number) {
    const keys: Record<string, number> = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(tabs[next].id);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div ref={list} role="tablist" className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {tabs.map((tab, index) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`press relative flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium whitespace-nowrap ${
              active ? "text-paper" : "text-ink-2 hover:bg-ink/[0.06] hover:text-ink"
            }`}
          >
            {active && (
              <m.span
                layoutId={`${id}-tab`}
                className="absolute inset-0 rounded-full bg-ink shadow-raised"
                transition={{ type: "spring", duration: 0.42, bounce: 0.14 }}
              />
            )}
            <span className="relative">{tab.label}</span>
            <span
              key={tab.count}
              className={`nums relative min-w-5 animate-pop rounded-full px-1.5 text-center text-xs leading-5 ${
                active
                  ? "bg-paper/20"
                  : tab.count && tab.tone === "danger"
                    ? "bg-danger-soft text-danger"
                    : tab.count && tab.tone === "accent"
                      ? "bg-accent-soft text-accent"
                      : "bg-ink/[0.06] text-muted"
              }`}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
