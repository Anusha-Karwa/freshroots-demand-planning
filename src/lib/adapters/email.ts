import { Resend } from "resend";
import { getDb, schema } from "@/lib/db";
import { integrationMode } from "@/lib/integrations";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface SendResult {
  mode: "live" | "mock";
  id?: string;
}

/** Sends via Resend when configured; otherwise logs to console + mock_emails. */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  if (integrationMode("resend") === "live") {
    if (!msg.to.includes("@")) {
      console.warn(`[email] no recipient address for "${msg.subject}" (${msg.to}) — skipped`);
      return { mode: "live" };
    }
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    });
    if (error) throw new Error(`Resend: ${error.message}`);
    return { mode: "live", id: data?.id };
  }
  console.log(`[email:MOCK] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
  const db = await getDb();
  const [row] = await db
    .insert(schema.mockEmails)
    .values({ to: msg.to, subject: msg.subject, body: msg.text })
    .returning({ id: schema.mockEmails.id });
  return { mode: "mock", id: String(row.id) };
}
