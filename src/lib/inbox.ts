import type { Client } from "@/lib/documents";

// An email in the accounting inbox, waiting to be imported or skipped.
export type InboxAttachment = {
  part: string; // Gmail part id
  filename: string;
  mime: string;
  size: number;
  suggested: boolean; // ticked by default: PDFs and real (not inline) pictures
};

export type InboxItem = {
  id: string;
  mailbox: string;
  gmail_id: string;
  received_at: string;
  sender: string | null;
  subject: string | null;
  snippet: string | null;
  attachments: InboxAttachment[];
};

export type InboxState = { connected: string | null; checkedAt: string | null; items: InboxItem[] };

export const INBOX_COLUMNS = "id,mailbox,gmail_id,received_at,sender,subject,snippet,attachments" as const;

export async function fetchInbox(supabase: Client): Promise<InboxState> {
  const [{ data: connections }, { data: items }] = await Promise.all([
    supabase.from("mail_connections").select("email,last_checked_at").limit(1),
    supabase.from("inbox_items").select(INBOX_COLUMNS).eq("status", "pending").order("received_at", { ascending: false }),
  ]);
  const connection = connections?.[0];
  return {
    connected: connection?.email ?? null,
    checkedAt: connection?.last_checked_at ?? null,
    items: (items ?? []) as unknown as InboxItem[],
  };
}

// "Google Payments <payments-noreply@google.com>" → "Google Payments"
export function senderName(sender: string | null) {
  if (!sender) return "Unknown sender";
  const name = sender.replace(/<[^>]*>/, "").replace(/"/g, "").trim();
  return name || sender.replace(/[<>]/g, "");
}

export function gmailLink(item: Pick<InboxItem, "mailbox" | "gmail_id">) {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(item.mailbox)}#all/${item.gmail_id}`;
}
