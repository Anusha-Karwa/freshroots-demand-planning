/**
 * Vercel Cron calls these routes with "Authorization: Bearer <CRON_SECRET>". With no CRON_SECRET set the
 * routes only answer outside production (local testing).
 */
export function cronAuthorized(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production";
  return authHeader === `Bearer ${secret}`;
}
