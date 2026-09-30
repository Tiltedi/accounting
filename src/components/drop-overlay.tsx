// Full-screen drop target, or a banner that keeps the page (and its drop
// targets) visible.
export function DropOverlay({ label, banner = false }: { label: string; banner?: boolean }) {
  if (banner) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
        <div className="rounded-full border-2 border-dashed border-accent bg-card px-5 py-3 text-sm font-semibold text-accent shadow-lg">
          {label}
        </div>
      </div>
    );
  }
  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-accent/10 p-6 backdrop-blur-[1px]">
      <div className="grid h-full w-full place-items-center rounded-3xl border-2 border-dashed border-accent text-lg font-semibold text-accent">
        {label}
      </div>
    </div>
  );
}
