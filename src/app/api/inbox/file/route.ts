import { accessToken, getAttachment } from "@/lib/gmail";
import { failure, mailConnection, signedInClient } from "@/lib/inbox-server";

// Shows one attachment of an inbox email, to look at before importing.
export async function GET(request: Request) {
  const supabase = await signedInClient();
  if (!supabase) return new Response("Not signed in", { status: 401 });
  const params = new URL(request.url).searchParams;

  try {
    const { data: item } = await supabase.from("inbox_items").select("gmail_id,attachments").eq("id", params.get("id") ?? "").maybeSingle();
    const part = params.get("part") ?? "";
    const known = (item?.attachments as { part: string }[] | undefined)?.some((a) => a.part === part);
    if (!item || !known) return new Response("Not found", { status: 404 });
    const connection = await mailConnection(supabase);
    if (!connection) return new Response("Inbox not connected", { status: 409 });

    const file = await getAttachment(await accessToken(connection.refresh_token), item.gmail_id, part);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return failure(err);
  }
}
