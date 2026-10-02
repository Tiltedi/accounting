import { AppHeader } from "@/components/app-header";

// While a section loads: its real header straight away (so switching feels
// instant) and placeholders shaped like the page.
export function PageSkeleton({ active }: { active: "/" | "/documents" | "/bank" | "/card" }) {
  if (active === "/") return <HomeSkeleton />;
  const docs = active === "/documents";
  return (
    <div className="min-h-dvh" aria-busy="true" aria-label="Loading">
      <AppHeader active={active}>
        <span aria-hidden="true" className={`skeleton h-10 shrink-0 rounded-full ${docs ? "hidden w-28 sm:block" : "w-10 sm:w-44"}`} />
      </AppHeader>
      <main className="mx-auto max-w-5xl px-4 pt-4 sm:px-6 sm:pt-6" aria-hidden="true">
        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
          <span className="skeleton h-11 rounded-full sm:flex-1" />
          <div className="flex gap-2">
            <span className="skeleton h-10 w-32 rounded-full" />
            {docs && (
              <>
                <span className="skeleton h-10 w-36 rounded-full" />
                <span className="skeleton h-10 w-28 rounded-full" />
              </>
            )}
          </div>
        </div>
        {!docs && (
          <div className="mt-4 flex gap-2 overflow-hidden py-1">
            {[132, 104, 92, 156].map((width) => (
              <span key={width} className="skeleton h-9 shrink-0 rounded-full" style={{ width }} />
            ))}
          </div>
        )}
        <span className="skeleton mt-7 mb-2 block h-3 w-28 rounded" />
        <div className="overflow-hidden rounded-2xl border border-rule bg-card shadow-card">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-rule px-4 py-3.5 last:border-b-0">
              <span className={`skeleton size-9 shrink-0 ${docs ? "rounded-md" : "rounded-full"}`} />
              <span className="flex-1 space-y-2">
                <span className="skeleton block h-3.5 rounded" style={{ width: `${46 - (i % 3) * 8}%` }} />
                <span className="skeleton block h-3 w-1/4 rounded" />
              </span>
              <span className="skeleton h-4 w-16 rounded" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="min-h-dvh" aria-busy="true" aria-label="Loading">
      <AppHeader active="/" />
      <main className="mx-auto grid max-w-5xl gap-4 px-4 pt-4 sm:px-6 sm:pt-6 lg:grid-cols-[1.2fr_1fr]" aria-hidden="true">
        {[260, 260, 250, 250].map((height, i) => (
          <div key={i} className="rounded-2xl border border-rule bg-card p-5 shadow-card" style={{ height }}>
            <span className="skeleton block h-4 w-40 rounded" />
            <span className="skeleton mt-2 block h-3 w-56 rounded" />
            <span className="skeleton mt-6 block h-12 w-32 rounded-lg" />
            <span className="skeleton mt-4 block h-2 rounded-full" />
          </div>
        ))}
      </main>
    </div>
  );
}
