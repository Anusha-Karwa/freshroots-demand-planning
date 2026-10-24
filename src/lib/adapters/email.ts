import { Resend } from "resend";
import { schema, type Db } from "@/db";
import { mode } from "@/lib/integrations";

/** Resend when RESEND_API_KEY + EMAIL_FROM are set; otherwise the email is printed and saved to mock_emails. */

export interface Email { to: string | undefined; subject: string; text: string; html?: string }

export async function sendEmail(db: Db, email: Email): Promise<{ status: "sent" | "mock" | "skipped" | "failed"; detail?: string }> {
  const live = mode("email") === "live";
  const to = email.to?.trim();

  if (!live) {
    const recipient = to || "(recipient not set)";
    console.log(`[mock email] to=${recipient} subject="${email.subject}"\n${email.text}\n`);
    await db.insert(schema.mockEmails).values({ to: recipient, subject: email.subject, body: email.text });
    await db.insert(schema.emailLog).values({ mode: "mock", to: recipient, subject: email.subject, status: "sent" });
    return { status: "mock" };
  }

  if (!to) {
    await db.insert(schema.emailLog).values({ mode: "live", to: "-", subject: email.subject, status: "skipped", detail: "recipient env var not set" });
    return { status: "skipped", detail: "recipient not set" };
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to: to.split(",").map((s) => s.trim()),
      subject: email.subject,
      text: email.text,
      html: email.html ?? textToHtml(email.text),
    });
    if (error) throw new Error(`${error.name}: ${error.message}`);
    await db.insert(schema.emailLog).values({ mode: "live", to, subject: email.subject, status: "sent", detail: data?.id });
    return { status: "sent", detail: data?.id };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[email] failed to send "${email.subject}" to ${to}: ${detail}`);
    await db.insert(schema.emailLog).values({ mode: "live", to, subject: email.subject, status: "failed", detail });
    return { status: "failed", detail };
  }
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function textToHtml(text: string) {
  const linked = escape(text).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${linked}</div>`;
}
