"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { m } from "motion/react";
import { KeyRound, LoaderCircle, LogOut, Mail, Sparkles } from "lucide-react";
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
      <div className="space-y-5 overflow-y-auto overscroll-contain p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-base font-semibold text-accent-ink uppercase shadow-raised">
            {email.slice(0, 1) || "?"}
          </span>
          <div className="min-w-0">
            <div className="text-xs font-medium tracking-wide text-muted">Signed in as</div>
            <div className="mt-0.5 truncate font-medium">{email}</div>
          </div>
        </div>

        <ReadingCost docs={docs} />

        <Appearance />

        {inbox !== undefined && (
          <div>
            <div className="text-xs font-medium tracking-wide text-muted">Email inbox</div>
            {inbox ? (
              <div className="mt-1.5 flex items-center gap-2 rounded-2xl border border-rule py-1.5 pr-1.5 pl-3">
                <Mail className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate font-medium">{inbox}</span>
                <button
                  type="button"
                  onClick={onOpenInbox}
                  className="press h-8 rounded-full px-3 text-sm font-semibold text-accent hover:bg-accent-soft"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={disconnect}
                  className="press h-8 rounded-full px-3 text-sm font-medium text-muted hover:bg-danger-soft hover:text-danger"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <a
                href="/api/inbox/connect"
                className="press mt-1.5 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-rule-strong/80 bg-card font-semibold shadow-card hover:bg-paper"
              >
                <Mail className="size-4" /> Connect the accounting mailbox
              </a>
            )}
          </div>
        )}

        <form onSubmit={changePassword} className="space-y-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-muted">New password</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              className="h-11 w-full rounded-xl border border-rule-strong/80 bg-card px-3 text-base shadow-card outline-none transition hover:border-rule-strong focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
          </label>
          <button
            type="submit"
            disabled={pending !== null}
            className="press flex h-11 w-full items-center justify-center gap-2 rounded-full border border-rule-strong/80 bg-card font-semibold shadow-card hover:bg-paper disabled:opacity-50"
          >
            {pending === "password" ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            Change password
          </button>
        </form>

        <button
          type="button"
          onClick={signOut}
          disabled={pending !== null}
          className="press flex h-11 w-full items-center justify-center gap-2 rounded-full bg-danger-soft font-semibold text-danger hover:brightness-95 disabled:opacity-50"
        >
          {pending === "signout" ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          Sign out
        </button>
      </div>
    </Dialog>
  );
}

type Theme = "dark" | "light" | "system";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Not remembered after a reload; fine.
  }
}

// Dark unless chosen otherwise; remembered on this device (applied early by the layout).
// A segmented control whose thumb slides to the choice (21st.dev "Segmented Control").
function Appearance() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === "undefined") return "dark";
    const t = document.documentElement.dataset.theme;
    return t === "light" || t === "system" ? t : "dark";
  });
  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }
  return (
    <div>
      <div className="text-xs font-medium tracking-wide text-muted">Appearance</div>
      <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-full bg-ink/[0.055] p-1" role="radiogroup" aria-label="Appearance">
        {(
          [
            ["dark", "Dark"],
            ["light", "Light"],
            ["system", "Device"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            onClick={() => choose(value)}
            className={`press relative h-9 rounded-full text-sm font-semibold ${theme === value ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            {theme === value && (
              <m.span
                layoutId="appearance-thumb"
                className="absolute inset-0 rounded-full bg-raised shadow-raised"
                transition={{ type: "spring", duration: 0.4, bounce: 0.12 }}
              />
            )}
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>
    </div>
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
    <div className="flex items-center gap-3 rounded-2xl border border-rule bg-paper px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
        <Sparkles className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="text-xs font-medium tracking-wide text-muted">Reading cost this month</div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
          <span className="nums text-lg font-medium">{usd(monthCost)}</span>
          <span className="text-sm text-muted">
            {monthCount} {monthCount === 1 ? "document" : "documents"} · {usd(allCost)} in total
          </span>
        </div>
      </div>
    </div>
  );
}
