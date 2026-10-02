import { cookies } from "next/headers";
import { exchangeCode, GmailError, sealToken } from "@/lib/gmail";
import { callbackUrl, signedInClient } from "@/lib/inbox-server";

// Google sends the user back here: keep the (encrypted) refresh token.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (result: string) => Response.redirect(`${url.origin}/documents?inbox=${result}`);
  const supabase = await signedInClient();
  if (!supabase) return Response.redirect(`${url.origin}/login`);

  const jar = await cookies();
  const expected = jar.get("inbox_state")?.value;
  jar.delete({ name: "inbox_state", path: "/api/inbox" });
  if (url.searchParams.get("error")) return back("declined");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return back("failed");

  try {
    const { refreshToken, email } = await exchangeCode(code, callbackUrl(request));
    await supabase.from("mail_connections").delete().neq("email", email);
    const { error } = await supabase
      .from("mail_connections")
      .upsert({ email, refresh_token: sealToken(refreshToken) }, { onConflict: "email" });
    if (error) throw error;
    return back("connected");
  } catch (err) {
    console.error("inbox connect:", err instanceof GmailError ? err.message : err);
    return back("failed");
  }
}
