import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authUrl, gmailConfigured } from "@/lib/gmail";
import { callbackUrl, signedInClient } from "@/lib/inbox-server";

// Starts Google consent for read-only access to the accounting mailbox.
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  if (!(await signedInClient())) return Response.redirect(`${origin}/login`);
  if (!gmailConfigured()) return Response.redirect(`${origin}/?inbox=not_configured`);

  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("inbox_state", state, { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", maxAge: 600, path: "/api/inbox" });
  return Response.redirect(authUrl(callbackUrl(request), state));
}
