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
  /**
   * Aborts the SendGrid request after this many ms, surfacing an "ambiguous"
   * SendGridDeliveryError (see below) rather than hanging forever. Opt-in and
   * omitted by default so `sendGridTripReminder` -- the pre-existing live
   * owner-facing path -- keeps its original unbounded-wait call signature and
   * behavior unchanged; only the email-action executor's dark
   * `sendGridEmailAction` path (services/onlyevs-worker/email.ts, which holds
   * a leased outbox job that must not block forever on a stuck fetch) opts in.
   */
  timeoutMs?: number;
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

/**
 * Thrown by `sendGridMessage` so callers can tell "SendGrid explicitly
 * rejected this" (`definite` -- safe to surface as a final failure or retry
 * with corrected input) apart from "the request timed out or the network
 * failed before we learned SendGrid's answer" (`ambiguous` -- SendGrid may
 * have already queued the send; blind-retrying risks a duplicate delivery,
 * e.g. a second owner-alert email for the same destructive action). Callers
 * that drive a durable delivery row (see the action pipeline in
 * services/onlyevs-worker/email.ts) must branch on `classification` rather
 * than retrying every failure the same way.
 */
export class SendGridDeliveryError extends Error {
  constructor(message: string, readonly classification: "ambiguous" | "definite") {
    super(message);
    this.name = "SendGridDeliveryError";
  }
}

const SENDGRID_SEND_TIMEOUT_MS = 10_000;

export async function sendGridMessage(
  config: SendGridConfig,
  message: SendGridMessage,
): Promise<{ messageId: string | null }> {
  const replyTo = message.replyTo && /^\S+@\S+\.\S+$/.test(message.replyTo) ? { email: message.replyTo } : undefined;
  if (!/^\S+@\S+\.\S+$/.test(message.recipient) || !message.subject.trim() || !message.text.trim() || !message.html.trim()) {
    throw new Error("sendgrid_invalid_message");
  }
  let response: Response;
  try {
    response = await fetch("https://api.sendgrid.com/v3/mail/send", {
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
      ...(message.timeoutMs ? { signal: AbortSignal.timeout(message.timeoutMs) } : {}),
    });
  } catch (error) {
    // A network error or timeout means we never learned whether SendGrid
    // received the request -- never blind-retry this the same way as an
    // explicit rejection.
    throw new SendGridDeliveryError(
      error instanceof Error ? error.message : "sendgrid_request_failed",
      "ambiguous",
    );
  }
  if (!response.ok) {
    // SendGrid answered with an explicit rejection: the request definitely
    // did not queue a send.
    throw new SendGridDeliveryError(`sendgrid_${response.status}`, "definite");
  }
  return { messageId: response.headers.get("x-message-id") };
}

/**
 * Convenience wrapper for the email action pipeline's owner-alert deliveries:
 * wires the stable message id and the `evhost_workspace_id`/`evhost_delivery_id`
 * custom args the SendGrid event webhook (app/api/internal/sendgrid/events/route.ts)
 * already expects, so a `processed`/`bounce`/`dropped` webhook event can be
 * traced back to the durable `onlyevs_email_deliveries` row that started it.
 */
export async function sendGridEmailAction(input: {
  config: SendGridConfig;
  recipient: string;
  subject: string;
  text: string;
  html: string;
  workspaceId: string;
  deliveryId: string;
}): Promise<{ messageId: string | null }> {
  return sendGridMessage(input.config, {
    recipient: input.recipient,
    subject: input.subject,
    text: input.text,
    html: input.html,
    stableMessageId: `evhost-email-action-${input.deliveryId}@mail.evhost.app`,
    customArgs: {
      evhost_workspace_id: input.workspaceId,
      evhost_delivery_id: input.deliveryId,
    },
    timeoutMs: SENDGRID_SEND_TIMEOUT_MS,
  });
}
