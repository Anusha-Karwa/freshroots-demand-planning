import { NextResponse, type NextRequest } from "next/server";
import { authEnabled, COOKIE, verifySession } from "@/lib/auth/session";

/** Sends visitors without a valid session to /login. Cron endpoints check CRON_SECRET themselves. */
export async function proxy(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  if (await verifySession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  const url = new URL("/login", req.url);
  if (req.nextUrl.pathname !== "/") url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/cron|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
