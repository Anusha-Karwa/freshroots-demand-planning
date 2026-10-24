import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authEnabled, COOKIE, verifySession, type Session } from "./session";

/** The signed-in user. With no DASHBOARD_PASSWORD (local dev), everyone is the planner. */
export async function getSession(): Promise<Session> {
  if (!authEnabled()) return { name: "Local planner", role: "planner", exp: Infinity };
  const s = await verifySession((await cookies()).get(COOKIE)?.value);
  if (!s) redirect("/login");
  return s;
}

/** For server actions that change something: only the planner may. */
export async function requirePlanner(): Promise<Session> {
  const s = await getSession();
  if (s.role !== "planner") throw new Error("Read-only access: only the demand planner can do this.");
  return s;
}
