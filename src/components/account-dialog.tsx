"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LoaderCircle, LogOut } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/dialog";
import { toast } from "@/components/toaster";
import type { Client } from "@/lib/documents";

export function AccountDialog({
  open,
  email,
  supabase,
  onClose,
}: {
  open: boolean;
  email: string;
  supabase: Client;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"password" | "signout" | null>(null);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const password = String(new FormData(formEl).get("password"));
    if (password.length < 10) return toast("Use at least 10 characters.", { tone: "error" });

    setPending("password");
    const { error } = await supabase.auth.updateUser({ password });
    setPending(null);
    if (error) return toast(error.message, { tone: "error" });
    formEl.reset();
    toast("Password changed");
  }

  async function signOut() {
    setPending("signout");
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Dialog open={open} onClose={onClose} width={400} label="Account">
      <DialogHeader title="Account" onClose={onClose} />
      <div className="space-y-6 overflow-y-auto p-5">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted">Signed in as</div>
          <div className="mt-0.5 truncate font-medium">{email}</div>
        </div>

        <form onSubmit={changePassword} className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium tracking-wide text-muted">New password</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              className="h-11 w-full rounded-xl border border-rule-strong bg-card px-3 text-base outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
          </label>
          <button
            type="submit"
            disabled={pending !== null}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-rule-strong font-semibold hover:bg-ink/5 disabled:opacity-50"
          >
            {pending === "password" && <LoaderCircle className="size-4 animate-spin" />}
            Change password
          </button>
        </form>

        <button
          type="button"
          onClick={signOut}
          disabled={pending !== null}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink/5 font-semibold text-danger hover:bg-danger-soft disabled:opacity-50"
        >
          {pending === "signout" ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          Sign out
        </button>
      </div>
    </Dialog>
  );
}
