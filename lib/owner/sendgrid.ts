import "server-only";

import { buildReminderMessage, type ReminderMessageInput } from "@/lib/owner/reminder-message";

interface SendGridConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

export function sendGridConfigFromEnv(): SendGridConfig | null {
  const apiKey = process.env.SENDGRID_API_KEY?.trim() ?? "";
  const fromEmail = process.env.SENDGRID_FROM_EMAIL?.trim().toLowerCase() ?? "";
  const fromName = process.env.SENDGRID_FROM_NAME?.trim() || "EVhost Trips";
  if (!apiKey || !/^\S+@\S+\.\S+$/.test(fromEmail) || fromName.length > 120) return null;
  return { apiKey, fromEmail, fromName };
}

export async function sendGridTripReminder(input: ReminderMessageInput & {
  recipient: string;
  replyTo?: string | null;
  config: SendGridConfig;
}): Promise<{ messageId: string | null }> {
  const message = buildReminderMessage(input);
  const replyTo = input.replyTo && /^\S+@\S+\.\S+$/.test(input.replyTo) ? { email: input.replyTo } : undefined;
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.recipient }] }],
      from: { email: input.config.fromEmail, name: input.config.fromName },
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: message.subject,
      content: [
        { type: "text/plain", value: message.text },
        { type: "text/html", value: message.html },
      ],
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`sendgrid_${response.status}`);
  }
  return { messageId: response.headers.get("x-message-id") };
}
