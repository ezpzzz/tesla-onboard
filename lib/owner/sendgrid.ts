import "server-only";

import { buildReminderMessage, type ReminderMessageInput } from "@/lib/owner/reminder-message";

interface SendGridConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

export interface SendGridMessage {
  recipient: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string | null;
  stableMessageId?: string;
  customArgs?: Record<string, string>;
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
  return sendGridMessage(input.config, {
    recipient: input.recipient,
    replyTo: input.replyTo,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

export async function sendGridMessage(
  config: SendGridConfig,
  message: SendGridMessage,
): Promise<{ messageId: string | null }> {
  const replyTo = message.replyTo && /^\S+@\S+\.\S+$/.test(message.replyTo) ? { email: message.replyTo } : undefined;
  if (!/^\S+@\S+\.\S+$/.test(message.recipient) || !message.subject.trim() || !message.text.trim() || !message.html.trim()) {
    throw new Error("sendgrid_invalid_message");
  }
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: message.recipient }], ...(message.customArgs ? { custom_args: message.customArgs } : {}) }],
      from: { email: config.fromEmail, name: config.fromName },
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(message.stableMessageId ? { headers: { "Message-ID": message.stableMessageId } } : {}),
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
