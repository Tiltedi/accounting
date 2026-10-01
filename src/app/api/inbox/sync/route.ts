import { accessToken, getMessage, listMessages } from "@/lib/gmail";
import { fetchInbox } from "@/lib/inbox";
import { failure, mailConnection, signedInClient } from "@/lib/inbox-server";
import { createLimiter } from "@/lib/files";
import type { Json } from "@/lib/database.types";

export const maxDuration = 60;

const FIRST_LOOK_DAYS = 60; // first check: the last two months of mail
const OVERLAP_DAYS = 2; // later checks overlap; known emails are skipped
const PER_CHECK = 40;

// Looks for new emails in the connected mailbox; they wait as pending items.
export async function POST() {
  const supabase = await signedInClient();
  if (!supabase) return Response.json({ error: "Not signed in" }, { status: 401 });

  try {
    const connection = await mailConnection(supabase);
    if (!connection) return Response.json(await fetchInbox(supabase));

    const token = await accessToken(connection.refresh_token);
    const since = connection.last_checked_at
      ? Date.parse(connection.last_checked_at) - OVERLAP_DAYS * 86_400_000
      : Date.now() - FIRST_LOOK_DAYS * 86_400_000;
    const ids = await listMessages(token, `in:inbox after:${Math.floor(since / 1000)}`, 100);

    if (ids.length) {
      const { data: known, error } = await supabase.from("inbox_items").select("gmail_id").in("gmail_id", ids);
      if (error) throw error;
      const seen = new Set((known ?? []).map((k) => k.gmail_id));
      const fresh = ids.filter((id) => !seen.has(id)).slice(0, PER_CHECK);
      const limit = createLimiter(5);
      const messages = await Promise.all(fresh.map((id) => limit(() => getMessage(token, id))));
      if (messages.length) {
        const { error: insertError } = await supabase.from("inbox_items").upsert(
          messages.map((m) => ({
            mailbox: connection.email,
            gmail_id: m.id,
            received_at: m.receivedAt,
            sender: m.sender,
            subject: m.subject,
            snippet: m.snippet,
            attachments: m.attachments as unknown as Json,
          })),
          { onConflict: "gmail_id", ignoreDuplicates: true },
        );
        if (insertError) throw insertError;
      }
    }

    await supabase.from("mail_connections").update({ last_checked_at: new Date().toISOString() }).eq("id", connection.id);
    return Response.json(await fetchInbox(supabase));
  } catch (err) {
    return failure(err);
  }
}
