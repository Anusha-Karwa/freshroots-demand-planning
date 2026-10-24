/**
 * Signed session cookie: base64url(JSON) + "." + HMAC-SHA256. Uses Web Crypto only, so the same code runs in
 * proxy.ts and in server components. Two roles: planner (Raghav: decides, edits rules) and viewer (Deepa / CEO).
 */

export type Role = "planner" | "viewer";
export interface Session { name: string; role: Role; exp: number }

export const COOKIE = "fr_session";
export const SESSION_DAYS = 14;

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export const authEnabled = () => Boolean(process.env.DASHBOARD_PASSWORD?.trim());
const secret = () => process.env.AUTH_SECRET?.trim() || process.env.CRON_SECRET?.trim() || process.env.DASHBOARD_PASSWORD?.trim() || "dev-only";

async function hmac(data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

export async function signSession(s: Omit<Session, "exp">, now = Date.now()): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...s, exp: now + SESSION_DAYS * 86_400_000 })));
  return `${body}.${await hmac(body)}`;
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function verifySession(token: string | undefined, now = Date.now()): Promise<Session | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(sig, await hmac(body))) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Session;
    if (typeof s.exp !== "number" || s.exp < now) return null;
    if (s.role !== "planner" && s.role !== "viewer") return null;
    return s;
  } catch {
    return null;
  }
}

/** Which role a password unlocks, if any. */
export function roleForPassword(password: string): Role | null {
  const planner = process.env.DASHBOARD_PASSWORD?.trim();
  const viewer = process.env.VIEWER_PASSWORD?.trim();
  if (planner && safeEqual(password, planner)) return "planner";
  if (viewer && safeEqual(password, viewer)) return "viewer";
  return null;
}
