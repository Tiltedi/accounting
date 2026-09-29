"use client";

import { useEffect } from "react";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="ruled grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="mb-4 text-lg font-semibold">Something went wrong.</p>
        <button
          type="button"
          onClick={() => retry()}
          className="h-11 rounded-full bg-accent px-6 font-semibold text-accent-ink hover:bg-accent-hover"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
