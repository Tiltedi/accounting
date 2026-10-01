"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LoaderCircle, LogOut, Mail } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/dialog";
import { toast } from "@/components/toaster";
import type { Client, Doc } from "@/lib/documents";

export function AccountDialog({
  open,
  email,
  supabase,
  docs = [],
  inbox,
  onOpenInbox,
  onDisconnected,
  onClose,
}: {
  open: boolean;
  email: string;
  supabase: Client;
  docs?: Doc[];
  inbox?: string | null; // connected mailbox; undefined where the page doesn't show the inbox
  onOpenInbox?: () => void;
  onDisconnected?: () => void;
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

  async function disconnect() {
    if (!window.confirm(`Stop reading ${inbox}? Emails waiting for review are kept.`)) return;
    const { error } = await supabase.from("mail_connections").delete().eq("email", inbox!);
    if (error) return toast(error.message, { tone: "error" });
    onDisconnected?.();
    toast("Inbox disconnected");
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

        <ReadingCost docs={docs} />

        {inbox !== undefined && (
          <div>
            <div className="text-xs font-medium tracking-wide text-muted">Email inbox</div>
            {inbox ? (
              <div className="mt-0.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{inbox}</span>
                <button type="button" onClick={onOpenInbox} className="text-sm font-semibold text-accent hover:underline">
                  Open
                </button>
                <button type="button" onClick={disconnect} className="text-sm font-medium text-muted hover:text-danger">
                  Disconnect
                </button>
              </div>
            ) : (
              <a
                href="/api/inbox/connect"
                className="mt-1.5 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-rule-strong font-semibold hover:bg-ink/5"
              >
                <Mail className="size-4" /> Connect the accounting mailbox
              </a>
            )}
          </div>
        )}

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

// What automatic reading has cost, from each read's token usage.
function ReadingCost({ docs }: { docs: Doc[] }) {
  const month = new Date().toISOString().slice(0, 7);
  let monthCost = 0;
  let monthCount = 0;
  let allCost = 0;
  for (const d of docs) {
    if (d.ai_cost_usd == null) continue;
    allCost += d.ai_cost_usd;
    if (d.created_at.slice(0, 7) === month) {
      monthCost += d.ai_cost_usd;
      monthCount++;
    }
  }
  const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
  return (
    <div>
      <div className="text-xs font-medium tracking-wide text-muted">Reading cost this month</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="nums font-medium">{usd(monthCost)}</span>
        <span className="text-sm text-muted">
          {monthCount} {monthCount === 1 ? "document" : "documents"} · {usd(allCost)} in total
        </span>
      </div>
    </div>
  );
}
