import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static files, icons and the web app manifest.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2|txt)$).*)",
  ],
};
