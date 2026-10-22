import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Shared-password login with two roles (MVP):
 *   planner — Raghav: decides on recommendations, edits rules, uploads data
 *   viewer  — Deepa / CEO: read-only
 * No DASHBOARD_PASSWORD set → local dev mode: everyone is the planner, no login.
 */

export type Role = "planner" | "viewer";
export interface User {
  name: string;
  role: Role;
}

const COOKIE = "fr_session";
const MAX_AGE_S = 60 * 60 * 24 * 14;

export const authEnabled = () => Boolean(process.env.DASHBOARD_PASSWORD?.trim());

const secret = () => process.env.AUTH_SECRET || process.env.CRON_SECRET || process.env.DASHBOARD_PASSWORD || "dev";
const sign = (payload: string) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function encodeSession(user: User, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: now + MAX_AGE_S * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(value: string | undefined, now = Date.now()): User | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof data.exp !== "number" || data.exp < now) return null;
    if (data.role !== "planner" && data.role !== "viewer") return null;
    return { name: String(data.name).slice(0, 60), role: data.role };
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

export async function currentUser(): Promise<User | null> {
  if (!authEnabled()) return { name: "Raghav (dev mode)", role: "planner" };
  return decodeSession((await cookies()).get(COOKIE)?.value);
}

/** For pages: the signed-in user, or a redirect to /login. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** For server actions that change data: planner only. */
export async function requirePlanner(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "planner") throw new Error("Only the planner can do this.");
  return user;
}

export async function setSession(user: User) {
  (await cookies()).set(COOKIE, encodeSession(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_S,
    path: "/",
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}
