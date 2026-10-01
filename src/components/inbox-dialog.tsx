"use client";

import { useState } from "react";
import { ExternalLink, FileText, Image as ImageIcon, Inbox, LoaderCircle, Mail, RotateCw } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/dialog";
import { formatBytes, formatDay } from "@/lib/format";
import { EMAIL_PART, gmailLink, senderName, type InboxAttachment, type InboxItem, type InboxState } from "@/lib/inbox";

// Emails that reached the accounting inbox: nothing is imported (or read by
// Claude) until the user picks the attachments and taps Import.
export function InboxDialog({
  open,
  inbox,
  checking,
  busy,
  onClose,
  onCheck,
  onImport,
  onSkip,
}: {
  open: boolean;
  inbox: InboxState;
  checking: boolean;
  busy: Set<string>; // item ids being imported or skipped
  onClose: () => void;
  onCheck: () => void;
  onImport: (items: { item: InboxItem; parts: string[] }[]) => void;
  onSkip: (item: InboxItem) => void;
}) {
  // Ticked attachments per email; defaults to the suggested ones.
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const partsOf = (item: InboxItem) => picked[item.id] ?? item.attachments.filter((a) => a.suggested).map((a) => a.part);
  const ready = inbox.items.filter((item) => partsOf(item).length > 0);

  function toggle(item: InboxItem, part: string) {
    const current = partsOf(item);
    setPicked((p) => ({ ...p, [item.id]: current.includes(part) ? current.filter((x) => x !== part) : [...current, part] }));
  }

  return (
    <Dialog open={open} onClose={onClose} variant="drawer" label="Inbox">
      <DialogHeader title="Inbox" onClose={onClose}>
        {inbox.connected && (
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-60"
          >
            <RotateCw className={`size-4 ${checking ? "animate-spin" : ""}`} /> Check now
          </button>
        )}
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {!inbox.connected ? (
          <NotConnected />
        ) : inbox.items.length === 0 ? (
          <div className="mt-12 text-center">
            <Inbox className="mx-auto size-8 text-muted" />
            <p className="mt-3 font-medium">Nothing to review</p>
            <p className="mt-1 text-sm text-muted">Forward invoices to {inbox.connected}; they show up here.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {inbox.items.map((item) => (
              <Email
                key={item.id}
                item={item}
                parts={partsOf(item)}
                busy={busy.has(item.id)}
                onToggle={(part) => toggle(item, part)}
                onImport={() => onImport([{ item, parts: partsOf(item) }])}
                onSkip={() => onSkip(item)}
              />
            ))}
          </ul>
        )}
      </div>

      {inbox.connected && (
        <div className="flex items-center gap-3 border-t border-rule px-5 py-3">
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            {inbox.connected}
            {inbox.checkedAt ? ` · checked ${timeAgo(inbox.checkedAt)}` : ""}
          </span>
          {ready.length > 1 && (
            <button
              type="button"
              onClick={() => onImport(ready.map((item) => ({ item, parts: partsOf(item) })))}
              disabled={busy.size > 0}
              className="h-10 shrink-0 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-50"
            >
              Import all ({ready.length})
            </button>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Email({
  item,
  parts,
  busy,
  onToggle,
  onImport,
  onSkip,
}: {
  item: InboxItem;
  parts: string[];
  busy: boolean;
  onToggle: (part: string) => void;
  onImport: () => void;
  onSkip: () => void;
}) {
  return (
    <li className="rounded-2xl border border-rule bg-card p-4" aria-label={item.subject ?? "Email"}>
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate font-semibold">{senderName(item.sender)}</span>
        <span className="nums shrink-0 text-xs text-muted">{formatDay(item.received_at.slice(0, 10))}</span>
      </div>
      <p className="mt-0.5 truncate text-sm">{item.subject || "(no subject)"}</p>

      {item.snippet && <p className="mt-1 line-clamp-2 text-xs text-muted">{item.snippet}</p>}

      <ul className="mt-3 space-y-1">
        {[...item.attachments, EMAIL_ITSELF].map((a) => {
          const Icon = a.part === EMAIL_PART ? Mail : a.mime === "application/pdf" ? FileText : ImageIcon;
          return (
            <li key={a.part} className="flex items-center gap-2.5 text-sm">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={parts.includes(a.part)}
                  onChange={() => onToggle(a.part)}
                  disabled={busy}
                  className="size-[1.1rem] shrink-0 cursor-pointer accent-(--color-accent)"
                />
                <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <span className={`truncate ${a.part === EMAIL_PART ? "text-ink-2" : ""}`}>{a.filename}</span>
                {a.size > 0 && <span className="nums shrink-0 text-xs text-muted">{formatBytes(a.size)}</span>}
              </label>
              <a
                href={`/api/inbox/file?id=${item.id}&part=${encodeURIComponent(a.part)}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`View ${a.filename}`}
                className="shrink-0 font-medium text-accent hover:underline"
              >
                View
              </a>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center justify-end gap-2">
        {busy ? (
          <LoaderCircle className="mr-auto size-4 animate-spin text-accent" />
        ) : (
          <a
            href={gmailLink(item)}
            target="_blank"
            rel="noreferrer"
            className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"
          >
            Gmail <ExternalLink className="size-3.5" />
          </a>
        )}
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="h-9 rounded-full px-4 text-sm font-semibold text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-50"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={busy || parts.length === 0}
          className="h-9 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-40"
        >
          Import{parts.length > 1 ? ` ${parts.length}` : ""}
        </button>
      </div>
    </li>
  );
}

// Never ticked by default: most emails without attachments aren't documents.
const EMAIL_ITSELF: InboxAttachment = { part: EMAIL_PART, filename: "The email itself (as PDF)", mime: "application/pdf", size: 0, suggested: false };

function NotConnected() {
  return (
    <div className="mt-10 text-center">
      <Mail className="mx-auto size-8 text-muted" />
      <p className="mt-3 font-medium">Connect the accounting mailbox</p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
        The app then lists emails sent to it here. You choose what gets imported; it can only read mail.
      </p>
      <a
        href="/api/inbox/connect"
        className="mt-5 inline-flex h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
      >
        Connect with Google
      </a>
    </div>
  );
}

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDay(iso.slice(0, 10));
}

// Above the document list when emails wait for review.
export function InboxStrip({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-4 flex w-full animate-rise items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-left text-sm font-medium text-accent hover:border-accent"
    >
      <Inbox className="size-4 shrink-0" />
      <span className="flex-1">
        {count} {count === 1 ? "email" : "emails"} to review
      </span>
      <span className="font-semibold">Review</span>
    </button>
  );
}
