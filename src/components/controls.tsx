"use client";

import type { ReactNode, Ref } from "react";
import { CalendarDays, ChevronDown, Search, X } from "lucide-react";
import { ALL_TIME, rangeLabel, type DateRange } from "@/lib/dates";

// Filter chips: quiet when unset, tinted with the accent when filtering.
const chip =
  "press flex h-10 shrink-0 items-center gap-2 rounded-full border text-[0.92rem] font-medium whitespace-nowrap shadow-card outline-none focus-visible:ring-4 focus-visible:ring-accent/15";
const idle = "border-rule-strong/80 bg-card text-ink hover:border-rule-strong hover:bg-paper";
const on = "border-accent/40 bg-accent-soft text-accent";

export function SearchField({
  value,
  onChange,
  onClear = () => onChange(""),
  label,
  inputRef,
  shortcut = false,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  label: string;
  inputRef?: Ref<HTMLInputElement>;
  shortcut?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search"
        aria-label={label}
        className="h-11 w-full rounded-full border border-rule-strong/80 bg-card pr-11 pl-10 text-base shadow-card outline-none transition placeholder:text-muted hover:border-rule-strong focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-[0.95rem] [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="press absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 animate-fade-in place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      ) : shortcut ? (
        <kbd className="nums pointer-events-none absolute top-1/2 right-3.5 hidden -translate-y-1/2 rounded-md border border-rule-strong bg-paper px-1.5 text-xs text-muted pointer-fine:block">
          /
        </kbd>
      ) : null}
    </div>
  );
}

export function DateChip({ range, onClick }: { range: DateRange; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${chip} min-w-0 px-3.5 ${range === ALL_TIME ? idle : on}`}>
      <CalendarDays className="size-4 shrink-0" />
      <span className="truncate sm:max-w-52">{rangeLabel(range)}</span>
      <ChevronDown className="ml-auto size-4 shrink-0 opacity-60" />
    </button>
  );
}

export function SelectChip({
  label,
  value,
  active,
  onChange,
  children,
}: {
  label: string;
  value: string;
  active: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="relative min-w-0 shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={`${chip} w-full appearance-none py-0 pr-9 pl-3.5 sm:w-auto ${active ? on : idle}`}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-60" />
    </div>
  );
}
