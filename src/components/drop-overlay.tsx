export function DropOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-accent/10 p-6 backdrop-blur-[1px]">
      <div className="grid h-full w-full place-items-center rounded-3xl border-2 border-dashed border-accent text-lg font-semibold text-accent">
        {label}
      </div>
    </div>
  );
}
