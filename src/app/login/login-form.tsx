"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          inputMode="email"
          className="h-12 w-full rounded-xl border border-rule-strong bg-card px-3.5 text-base outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-2">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="h-12 w-full rounded-xl border border-rule-strong bg-card px-3.5 text-base outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-70"
      >
        {pending && <LoaderCircle className="size-5 animate-spin" />}
        Sign in
      </button>
    </form>
  );
}
