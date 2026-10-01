// Server-only helpers shared by the /api/inbox routes.
import { GmailError } from "@/lib/gmail";
import { createClient } from "@/lib/supabase/server";

export async function signedInClient() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ? supabase : null;
}

export async function mailConnection(supabase: NonNullable<Awaited<ReturnType<typeof signedInClient>>>) {
  const { data, error } = await supabase.from("mail_connections").select("id,email,refresh_token,last_checked_at").limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export function failure(err: unknown) {
  const message = err instanceof GmailError ? err.message : err instanceof Error ? err.message : "Something went wrong";
  if (!(err instanceof GmailError)) console.error("inbox:", err);
  return Response.json({ error: message }, { status: err instanceof GmailError ? 502 : 500 });
}

// Where Google sends the user back after consent; must be listed in the OAuth client.
export function callbackUrl(request: Request) {
  return `${new URL(request.url).origin}/api/inbox/callback`;
}
