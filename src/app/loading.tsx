export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-20 sm:px-6" aria-busy="true" aria-label="Loading">
      <div className="mb-6 h-11 w-full animate-pulse rounded-xl bg-ink/5" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="mb-2 h-14 animate-pulse rounded-xl bg-ink/[0.04]" />
      ))}
    </div>
  );
}
