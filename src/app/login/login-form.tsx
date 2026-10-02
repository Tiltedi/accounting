"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CircleAlert, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const field =
  "h-12 w-full rounded-xl border border-rule-strong/80 bg-card pr-3.5 pl-10 text-base shadow-card outline-none transition hover:border-rule-strong focus:border-accent focus:ring-4 focus:ring-accent/15";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    const { error } = await createClient().auth.signInWithPassword({
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    });

    if (error) {
      setPending(false);
      setError(error.status === 400 ? "Wrong email or password." : error.message);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-2">Email</span>
        <span className="relative block">
          <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <input name="email" type="email" required autoComplete="username" inputMode="email" className={field} />
        </span>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-2">Password</span>
        <span className="relative block">
          <LockKeyhole className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <input name="password" type="password" required autoComplete="current-password" className={field} />
        </span>
      </label>
      {error && (
        <p role="alert" className="flex animate-rise items-center gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" />
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.16),0_8px_20px_-8px_var(--color-accent)] hover:bg-accent-hover disabled:opacity-70"
      >
        {pending && <LoaderCircle className="size-5 animate-spin" />}
        Sign in
      </button>
    </form>
  );
}
