"use client";

import { useState } from "react";
import { DayPicker, type DateRange as PickerRange } from "@daypicker/react";
import "@daypicker/react/style.css";
import { Dialog, DialogHeader } from "@/components/dialog";
import { useMediaQuery } from "@/lib/use-media-query";
import {
  PRESETS,
  fromISODate,
  presetRange,
  rangeLabel,
  sameRange,
  toISODate,
  type DateRange,
} from "@/lib/dates";

export function DateRangeDialog({
  open,
  value,
  onClose,
  onChange,
}: {
  open: boolean;
  value: DateRange;
  onClose: () => void;
  onChange: (range: DateRange) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} width={800} label="Date range">
      <DialogHeader title="Dates" onClose={onClose} />
      <RangePicker
        value={value}
        onChange={(range) => {
          onChange(range);
          onClose();
        }}
      />
    </Dialog>
  );
}

function RangePicker({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  const wide = useMediaQuery("(min-width: 640px)");
  const [draft, setDraft] = useState<PickerRange | undefined>(
    value.from ? { from: fromISODate(value.from), to: value.to ? fromISODate(value.to) : undefined } : undefined,
  );

  const today = new Date();
  const draftRange: DateRange | null = draft?.from
    ? { from: toISODate(draft.from), to: toISODate(draft.to ?? draft.from) }
    : null;

  return (
    <div className="flex min-h-0 flex-col sm:flex-row">
      <div className="flex flex-wrap gap-2 border-b border-rule px-5 py-3 sm:w-44 sm:shrink-0 sm:flex-col sm:flex-nowrap sm:gap-0.5 sm:border-r sm:border-b-0 sm:bg-paper/60 sm:px-2.5 sm:py-3">
        {PRESETS.map((preset) => {
          const range = presetRange(preset.id, today);
          const active = sameRange(range, value);
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange(range)}
              className={`press rounded-full border px-3.5 py-2 text-left text-sm whitespace-nowrap sm:rounded-lg sm:border-0 sm:px-3 ${
                active
                  ? "border-accent/40 bg-accent-soft font-semibold text-accent"
                  : "border-rule-strong/80 bg-card hover:bg-ink/5 sm:bg-transparent"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex justify-center px-3 pt-3">
          <DayPicker
            mode="range"
            selected={draft}
            onSelect={setDraft}
            numberOfMonths={wide ? 2 : 1}
            weekStartsOn={1}
            defaultMonth={
              draft?.from ?? (wide ? new Date(today.getFullYear(), today.getMonth() - 1, 1) : today)
            }
            endMonth={new Date(today.getFullYear() + 1, 11, 31)}
            showOutsideDays={false}
          />
        </div>
        <div className="flex items-center gap-3 border-t border-rule px-5 py-3">
          <span key={draftRange ? rangeLabel(draftRange) : ""} className={`min-w-0 flex-1 animate-fade-in truncate text-sm ${draftRange ? "nums text-ink" : "text-muted"}`}>
            {draftRange ? rangeLabel(draftRange) : "Pick a start and end day"}
          </span>
          <button
            type="button"
            disabled={!draftRange}
            onClick={() => draftRange && onChange(draftRange)}
            className="press h-10 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink shadow-raised hover:bg-accent-hover disabled:opacity-40 disabled:shadow-none"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
