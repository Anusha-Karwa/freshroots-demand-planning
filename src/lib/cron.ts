import { mode } from "@/lib/integrations";
import { safeEqual } from "@/lib/auth/session";

/** Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". Without a secret (local dev) the endpoints are open. */
export function cronAuthorized(req: Request) {
  if (mode("cron") === "mock") return !process.env.VERCEL;
  return safeEqual(req.headers.get("authorization") ?? "", `Bearer ${process.env.CRON_SECRET!.trim()}`);
}
