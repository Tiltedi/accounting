"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import {
  ArrowRight,
  BookCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  FileWarning,
  Inbox,
  Landmark,
  Sparkles,
  Table2,
  ChartColumn,
} from "lucide-react";
import { AccountDialog } from "@/components/account-dialog";
import { AppHeader } from "@/components/app-header";
import { pendingCounts } from "@/components/bank-view";
import { findMatches, loadDismissed, type Transaction } from "@/lib/bank";
import type { Doc } from "@/lib/documents";
import { formatDay, formatMoney, formatMonth, formatShortDay, formatShortMonth } from "@/lib/format";
import type { InboxState } from "@/lib/inbox";
import {
  byCategory,
  lastFullQuarter,
  lastMonths,
  monthlyOut,
  niceMax,
  quarterCheck,
  quarterLabel,
  quarterOf,
  shiftQuarter,
  todoCounts,
} from "@/lib/overview";
import { createClient } from "@/lib/supabase/client";

type Icon = ComponentType<{ className?: string }>;

// Fraction digits spelled out: Node and browsers default differently for compact currency.
const compact = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 });
const euros = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Start page: what's left to do, whether the last quarter is ready for the
// accountant, where the money went, and what came in lately.
export function HomeView({
  docs,
  txs,
  initialInbox,
  email,
  today,
}: {
  docs: Doc[];
  txs: Transaction[];
  initialInbox: InboxState;
  email: string;
  today: string; // the server's date, so server and browser render the same months
}) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [inbox, setInbox] = useState(initialInbox);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [account, setAccount] = useState(false);

  // Dismissed suggestions live in this browser only (as on the Bank page).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage after hydration
    setDismissed(loadDismissed());
  }, []);

  // New mail since the last check (as Documents does on open); fresh numbers
  // when coming back to the app.
  const connected = Boolean(initialInbox.connected);
  useEffect(() => {
    const sync = async () => {
      try {
        const response = await fetch("/api/inbox/sync", { method: "POST" });
        if (response.ok) setInbox((await response.json()) as InboxState);
      } catch {
        // Offline: keep the last known count.
      }
    };
    if (connected) void sync();
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 30_000) return;
      last = Date.now();
      router.refresh();
      if (connected) void sync();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [connected, router]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, router]);

  const matches = useMemo(() => findMatches(txs, docs, dismissed), [txs, docs, dismissed]);
  const pending = useMemo(() => pendingCounts(matches, txs), [matches, txs]);

  return (
    <div className="min-h-dvh">
      <AppHeader active="/" email={email} badges={pending} onAccount={() => setAccount(true)} />

      <main className="mx-auto max-w-5xl animate-page-in px-4 pt-4 pb-16 sm:px-6 sm:pt-6">
        <h1 className="sr-only">Home</h1>
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <QuarterCard txs={txs} docs={docs} matches={matches} today={today} />
          <TodoCard txs={txs} docs={docs} matches={matches} inbox={inbox} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <MonthlyChart txs={txs} docs={docs} today={today} />
          <CategoryChart docs={docs} today={today} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <RecentCard docs={docs} />
          <SourcesCard txs={txs} docs={docs} inbox={inbox} today={today} />
        </div>
      </main>

      <AccountDialog
        open={account}
        email={email}
        supabase={supabase}
        docs={docs}
        inbox={inbox.connected}
        onOpenInbox={() => router.push("/documents?show=inbox")}
        onDisconnected={() => setInbox({ connected: null, checkedAt: null, items: [] })}
        onClose={() => setAccount(false)}
      />
    </div>
  );
}

// ----- Building blocks ---------------------------------------------------------------

function Card({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`flex flex-col rounded-2xl border border-rule bg-card p-4 shadow-card sm:p-5 ${className}`}>
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

// ----- Quarter check -------------------------------------------------------------------

function QuarterCard({ txs, docs, matches, today }: { txs: Transaction[]; docs: Doc[]; matches: ReturnType<typeof findMatches>; today: string }) {
  const current = quarterOf(today);
  const [quarter, setQuarter] = useState(() => lastFullQuarter(today));
  const check = useMemo(() => quarterCheck(txs, docs, matches, quarter), [txs, docs, matches, quarter]);
  const firstQuarter = useMemo(() => {
    const dates = [...txs.map((t) => t.booked_on), ...docs.map((d) => d.doc_date)].sort();
    return dates.length ? quarterOf(dates[0]) : current;
  }, [txs, docs, current]);

  // Rounded down: 100% only when nothing is left.
  const percent = check.lines ? Math.floor((check.done / check.lines) * 100) : 0;
  const missing = check.missing.bank + check.missing.card;
  const toApprove = check.check.bank + check.check.card;
  const ready = check.lines > 0 && missing + toApprove === 0;
  const label = quarterLabel(quarter);

  return (
    <Card
      title="Ready for the accountant?"
      subtitle={quarter === current ? "This quarter so far" : "Every payment needs a receipt, or no receipt needed"}
      action={
        <div className="flex items-center rounded-full border border-rule">
          <button
            type="button"
            aria-label="Previous quarter"
            disabled={quarter <= firstQuarter}
            onClick={() => setQuarter((q) => shiftQuarter(q, -1))}
            className="press grid size-8 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span key={quarter} className="w-[4.5rem] animate-fade-in text-center text-sm font-semibold">
            {label}
          </span>
          <button
            type="button"
            aria-label="Next quarter"
            disabled={quarter >= current}
            onClick={() => setQuarter((q) => shiftQuarter(q, 1))}
            className="press grid size-8 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      }
    >
      {check.lines === 0 ? (
        <p className="py-6 text-sm text-muted">No bank or card lines in {label} yet. Import a statement on the Bank page.</p>
      ) : (
        <>
          <div className="flex items-end gap-3">
            <span key={quarter} className="animate-fade-in text-5xl font-semibold tracking-tight">
              {percent}%
            </span>
            <span className="mb-1.5 text-sm text-muted">
              {ready ? (
                <span className="inline-flex items-center gap-1 font-medium text-accent">
                  <Check className="size-4" /> all {check.lines} payments covered
                </span>
              ) : (
                <>
                  {check.done} of {plural(check.lines, "payment")} covered
                </>
              )}
            </span>
          </div>
          <div
            role="meter"
            aria-label={`${label} payments covered`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="mt-3 h-2 overflow-hidden rounded-full bg-accent-soft"
          >
            <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out" style={{ width: `${percent}%` }} />
          </div>

          <ul className="mt-4 space-y-1">
            {missing > 0 && (
              <QuarterRow
                href={check.missing.bank || !check.missing.card ? "/bank" : "/card"}
                tone="danger"
                text={`${plural(missing, "payment")} without a receipt`}
                detail={[
                  check.missingOut > 0 ? formatMoney(check.missingOut, "EUR") : null,
                  check.missing.bank && check.missing.card ? `${check.missing.bank} bank · ${check.missing.card} card` : null,
                ]}
              />
            )}
            {toApprove > 0 && (
              <QuarterRow
                href={check.check.bank || !check.check.card ? "/bank?tab=check" : "/card?tab=check"}
                tone="accent"
                text={`${plural(toApprove, "receipt")} found, to approve`}
                detail={[check.check.bank && check.check.card ? `${check.check.bank} bank · ${check.check.card} card` : null]}
              />
            )}
            {check.unbooked > 0 && (
              <QuarterRow
                href="/documents?status=unbooked"
                tone="muted"
                text={`${plural(check.unbooked, "document")} not booked yet`}
                detail={[`of ${check.docs}`]}
              />
            )}
          </ul>
        </>
      )}

      <div className="mt-auto flex pt-4">
        <Link
          href={`/documents?show=download&quarter=${quarter}`}
          className="press inline-flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink shadow-raised hover:bg-accent-hover"
        >
          <Download className="size-4" />
          Download {label}
        </Link>
      </div>
    </Card>
  );
}

function QuarterRow({ href, tone, text, detail }: { href: string; tone: "danger" | "accent" | "muted"; text: string; detail: (string | null)[] }) {
  const dot = tone === "danger" ? "bg-danger" : tone === "accent" ? "bg-accent" : "bg-ink/25";
  const extra = detail.filter(Boolean).join(" · ");
  return (
    <li>
      <Link href={href} className="press group -mx-2 flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm hover:bg-ink/[0.04]">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{text}</span>
          {extra && <span className="text-muted"> · {extra}</span>}
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

// ----- To do ------------------------------------------------------------------------------

function TodoCard({ txs, docs, matches, inbox }: { txs: Transaction[]; docs: Doc[]; matches: ReturnType<typeof findMatches>; inbox: InboxState }) {
  const counts = useMemo(() => todoCounts(txs, matches), [txs, matches]);
  const hasCard = txs.some((t) => t.source === "card");
  const failed = docs.filter((d) => d.status === "failed").length;
  const unbooked = docs.filter((d) => !d.booked_at).length;

  const rows: { href: string; icon: Icon; label: string; count: number; tone: "danger" | "accent" | "muted"; hide?: boolean }[] = [
    { href: "/bank", icon: Landmark, label: "Bank: missing receipt", count: counts.bank.missing, tone: "danger" },
    { href: "/bank?tab=check", icon: Landmark, label: "Bank: to approve", count: counts.bank.check, tone: "accent" },
    { href: "/card", icon: CreditCard, label: "Card: missing receipt", count: counts.card.missing, tone: "danger", hide: !hasCard },
    { href: "/card?tab=check", icon: CreditCard, label: "Card: to approve", count: counts.card.check, tone: "accent", hide: !hasCard },
    { href: "/documents?show=inbox", icon: Inbox, label: "Emails to review", count: inbox.items.length, tone: "accent", hide: !inbox.connected },
    { href: "/documents?status=unbooked", icon: BookCheck, label: "Documents not booked", count: unbooked, tone: "muted" },
    { href: "/documents", icon: FileWarning, label: "Documents not read", count: failed, tone: "danger", hide: !failed },
  ];
  const visible = rows.filter((row) => !row.hide);
  const open = visible.filter((row) => row.count > 0).length;

  return (
    <Card title="To do" subtitle={open ? `${plural(open, "list")} with something waiting` : "Nothing waiting"}>
      <ul className="-mx-2 flex flex-col">
        {visible.map((row) => {
          const RowIcon = row.icon;
          const done = row.count === 0;
          return (
            <li key={row.href}>
              <Link
                href={row.href}
                aria-label={`${row.label}: ${row.count}`}
                className={`press group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-ink/[0.04] ${done ? "text-muted" : ""}`}
              >
                <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${done ? "bg-ink/[0.04]" : "bg-ink/[0.06] text-ink-2"}`}>
                  <RowIcon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.label}</span>
                {done ? (
                  <Check className="size-4 shrink-0 text-accent" />
                ) : (
                  <span
                    key={row.count}
                    className={`nums min-w-6 animate-pop rounded-full px-2 text-center text-xs leading-6 font-semibold ${
                      row.tone === "danger" ? "bg-danger-soft text-danger" : row.tone === "accent" ? "bg-accent-soft text-accent" : "bg-ink/[0.07] text-ink-2"
                    }`}
                  >
                    {row.count}
                  </span>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ----- Charts ------------------------------------------------------------------------------

function ViewToggle({ table, onChange }: { table: boolean; onChange: (table: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!table)}
      aria-label={table ? "Show as chart" : "Show as table"}
      title={table ? "Show as chart" : "Show as table"}
      className="press grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
    >
      {table ? <ChartColumn className="size-4" /> : <Table2 className="size-4" />}
    </button>
  );
}

function MonthlyChart({ txs, docs, today }: { txs: Transaction[]; docs: Doc[]; today: string }) {
  const [table, setTable] = useState(false);
  const { months, foreign } = useMemo(() => monthlyOut(txs, docs, lastMonths(today)), [txs, docs, today]);
  const total = months.reduce((sum, m) => sum + m.amount, 0);
  const top = niceMax(Math.max(...months.map((m) => m.amount)));
  const peak = months.reduce((best, m) => (m.amount > best.amount ? m : best), months[0]);
  const thisMonth = today.slice(0, 7);

  return (
    <Card
      title="Money out per month"
      subtitle={
        <>
          Bank and card, last 12 months · <span className="nums">{formatMoney(total, "EUR")}</span>
          {foreign > 0 && ` · ${plural(foreign, "line")} in other currencies not counted`}
        </>
      }
      action={<ViewToggle table={table} onChange={setTable} />}
    >
      {total === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No payments in the last 12 months yet.</p>
      ) : table ? (
        <MoneyTable rows={months.map((m) => [formatMonth(m.month) + (m.month === thisMonth ? " (so far)" : ""), m.amount])} head="Month" />
      ) : (
        <div className="relative mt-1 h-48 pl-11">
          {/* Axis: three hairlines with rounded values */}
          {[1, 0.5, 0].map((f) => (
            <div key={f} className="pointer-events-none absolute right-0 left-11 border-t border-rule" style={{ bottom: `calc(1.25rem + ${f} * (100% - 1.25rem))` }}>
              <span className="nums absolute -top-2 -left-11 w-9 text-right text-[0.65rem] text-muted">{compact.format(top * f)}</span>
            </div>
          ))}
          <ul aria-label="Money out per month" className="relative flex h-full">
            {months.map((m, i) => {
              const height = (m.amount / top) * 100;
              const partial = m.month === thisMonth;
              const edge = i < 2 ? "left-0" : i > months.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2";
              return (
                <li
                  key={m.month}
                  tabIndex={0}
                  aria-label={`${formatMonth(m.month)}${partial ? " so far" : ""}: ${formatMoney(m.amount, "EUR")}`}
                  className="group relative flex h-full min-w-0 flex-1 flex-col items-center outline-none"
                >
                  <div className="relative flex w-full flex-1 items-end justify-center px-[2px]">
                    {m === peak && m.amount > 0 && (
                      <span className="nums pointer-events-none absolute text-[0.65rem] font-medium text-ink-2 group-hover:opacity-0 group-focus:opacity-0" style={{ bottom: `calc(${height}% + 4px)` }}>
                        {compact.format(m.amount)}
                      </span>
                    )}
                    <span
                      className={`block w-full max-w-6 origin-bottom animate-grow-up rounded-t-[4px] transition-[filter] group-hover:brightness-110 group-focus:brightness-110 ${
                        partial ? "bg-accent/45" : "bg-accent"
                      }`}
                      style={{ height: `${height}%`, minHeight: m.amount > 0 ? 2 : 0, animationDelay: `${i * 30}ms` } as CSSProperties}
                    />
                    {/* Tooltip */}
                    <span
                      className={`pointer-events-none absolute z-10 rounded-lg bg-ink px-2.5 py-1.5 text-center whitespace-nowrap text-paper opacity-0 shadow-float transition-opacity group-hover:opacity-100 group-focus:opacity-100 ${edge}`}
                      style={{ bottom: `calc(${height}% + 8px)` }}
                    >
                      <span className="nums block text-sm font-semibold">{formatMoney(m.amount, "EUR")}</span>
                      <span className="block text-[0.7rem] opacity-70">
                        {formatMonth(m.month)}
                        {partial && " so far"}
                      </span>
                    </span>
                  </div>
                  <span className={`h-5 pt-1 text-[0.65rem] text-muted ${i % 2 ? "max-sm:invisible" : ""}`}>{formatShortMonth(m.month)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

function CategoryChart({ docs, today }: { docs: Doc[]; today: string }) {
  const [table, setTable] = useState(false);
  const { rows, foreign } = useMemo(() => byCategory(docs, lastMonths(today)), [docs, today]);
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const top = Math.max(...rows.map((r) => r.amount), 1);

  return (
    <Card
      title="Spending by category"
      subtitle={
        <>
          From your documents, last 12 months
          {foreign > 0 && ` · ${plural(foreign, "document")} in other currencies not counted`}
        </>
      }
      action={<ViewToggle table={table} onChange={setTable} />}
    >
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No documents in the last 12 months yet.</p>
      ) : table ? (
        <MoneyTable rows={rows.map((r) => [`${r.category} (${r.count})`, r.amount])} head="Category" />
      ) : (
        <ul aria-label="Spending by category" className="mt-1 space-y-2.5">
          {rows.map((row, i) => {
            const share = Math.round((row.amount / total) * 100);
            return (
              <li
                key={row.category}
                tabIndex={0}
                title={`${plural(row.count, "document")} · ${share}% of the total`}
                aria-label={`${row.category}: ${formatMoney(row.amount, "EUR")}, ${plural(row.count, "document")}, ${share}%`}
                className="group grid grid-cols-[minmax(0,6.5rem)_1fr] items-center gap-3 rounded-md outline-none sm:grid-cols-[minmax(0,8rem)_1fr]"
              >
                <span className="truncate text-sm text-ink-2">{row.category}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span
                      className="block h-3.5 origin-left animate-grow-right rounded-r-[4px] bg-accent transition-[filter] group-hover:brightness-110 group-focus:brightness-110"
                      style={{ width: `${(row.amount / top) * 100}%`, minWidth: 2, animationDelay: `${i * 50}ms` }}
                    />
                  </span>
                  <span className="nums w-[5.5rem] shrink-0 text-right text-xs font-medium whitespace-nowrap">
                    {euros.format(row.amount)}
                    <span className="font-normal text-muted"> · {share}%</span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function MoneyTable({ rows, head }: { rows: [string, number][]; head: string }) {
  return (
    <div className="max-h-56 animate-fade-in overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="pb-1.5 font-medium">{head}</th>
            <th className="pb-1.5 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, amount]) => (
            <tr key={label} className="border-t border-rule">
              <td className="py-1.5">{label}</td>
              <td className="nums py-1.5 text-right">{formatMoney(amount, "EUR")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----- Recent ------------------------------------------------------------------------------

function RecentCard({ docs }: { docs: Doc[] }) {
  const recent = useMemo(() => [...docs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5), [docs]);
  return (
    <Card
      title="Recently added"
      action={
        <Link href="/documents" className="press inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-sm font-medium text-accent hover:bg-accent-soft">
          All <ChevronRight className="size-4" />
        </Link>
      }
    >
      {recent.length === 0 ? (
        <p className="py-6 text-sm text-muted">Nothing yet. Scan or upload a receipt on Documents.</p>
      ) : (
        <ul className="-mx-2">
          {recent.map((d) => (
            <li key={d.id}>
              <Link href="/documents" className="press flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-ink/[0.04]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{d.vendor || d.file_name}</span>
                  <span className="block truncate text-xs text-muted">
                    Added {formatShortDay(d.created_at.slice(0, 10))}
                    {d.category && ` · ${d.category}`}
                  </span>
                </span>
                {d.status === "processing" ? (
                  <span className="shimmer-text text-xs font-medium">Reading…</span>
                ) : d.status === "failed" ? (
                  <span className="text-xs font-medium text-danger">Not read</span>
                ) : (
                  d.total != null && <span className="nums text-sm">{formatMoney(d.total, d.currency)}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SourcesCard({ txs, docs, inbox, today }: { txs: Transaction[]; docs: Doc[]; inbox: InboxState; today: string }) {
  const latest = (source: "bank" | "card") => txs.find((t) => t.source === source)?.booked_on ?? null; // txs are newest first
  const bank = latest("bank");
  const card = latest("card");
  const month = today.slice(0, 7);
  const reads = docs.filter((d) => d.ai_cost_usd != null && d.created_at.slice(0, 7) === month);
  const cost = reads.reduce((sum, d) => sum + (d.ai_cost_usd ?? 0), 0);

  const rows: { icon: Icon; label: string; value: string; href?: string }[] = [
    { icon: Landmark, label: "Bank lines up to", value: bank ? formatDay(bank) : "None yet", href: "/bank" },
    { icon: CreditCard, label: "Card lines up to", value: card ? formatDay(card) : "None yet", href: "/card" },
    {
      icon: Inbox,
      label: "Email inbox",
      value: inbox.connected ? (inbox.items.length ? `${inbox.items.length} to review` : "Nothing new") : "Not connected",
      href: "/documents?show=inbox",
    },
    { icon: Sparkles, label: "Reading cost this month", value: `$${cost.toFixed(3)} · ${plural(reads.length, "document")}` },
  ];

  return (
    <Card title="Up to date?" subtitle="Import new statements when these fall behind">
      <ul className="-mx-2">
        {rows.map((row) => {
          const RowIcon = row.icon;
          const body = (
            <>
              <RowIcon className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{row.label}</span>
              <span className="nums shrink-0 text-sm font-medium">{row.value}</span>
            </>
          );
          return (
            <li key={row.label}>
              {row.href ? (
                <Link href={row.href} className="press flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-ink/[0.04]">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-2 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
