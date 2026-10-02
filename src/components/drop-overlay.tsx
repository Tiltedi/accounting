import { FileDown } from "lucide-react";

// Full-screen drop target, or a banner that keeps the page (and its drop
// targets) visible.
export function DropOverlay({ label, banner = false }: { label: string; banner?: boolean }) {
  if (banner) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
        <div className="flex animate-rise items-center gap-2.5 rounded-full bg-ink py-2.5 pr-5 pl-3 text-sm font-semibold text-paper shadow-float ring-4 ring-accent/25">
          <span className="grid size-7 place-items-center rounded-full bg-accent text-accent-ink">
            <FileDown className="size-4 animate-bob" />
          </span>
          {label}
        </div>
      </div>
    );
  }
  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid animate-fade-in place-items-center bg-paper/70 p-4 backdrop-blur-sm sm:p-6">
      <div className="relative grid h-full w-full place-items-center">
        <svg aria-hidden="true" className="absolute inset-px h-[calc(100%-2px)] w-[calc(100%-2px)] overflow-visible text-accent">
          <rect
            width="100%"
            height="100%"
            rx="28"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="10 14"
            className="animate-[dash_1s_linear_infinite] fill-accent/5"
          />
        </svg>
        <div className="flex animate-rise flex-col items-center gap-4 text-center">
          <span className="grid size-16 place-items-center rounded-2xl bg-accent text-accent-ink shadow-float">
            <FileDown className="size-7 animate-bob" />
          </span>
          <span className="text-lg font-semibold text-accent">{label}</span>
        </div>
      </div>
    </div>
  );
}
