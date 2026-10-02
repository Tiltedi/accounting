"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="ruled grid min-h-dvh place-items-center px-6 text-center">
      <div className="flex animate-rise flex-col items-center">
        <span className="grid size-14 place-items-center rounded-2xl border border-rule bg-card text-warn shadow-raised">
          <TriangleAlert className="size-6" />
        </span>
        <p className="mt-4 mb-5 text-lg font-semibold">Something went wrong.</p>
        <button
          type="button"
          onClick={() => retry()}
          className="press flex h-11 items-center gap-2 rounded-full bg-accent px-6 font-semibold text-accent-ink shadow-raised hover:bg-accent-hover"
        >
          <RotateCw className="size-4" /> Try again
        </button>
      </div>
    </main>
  );
}
