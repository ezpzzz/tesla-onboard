"use client";

/**
 * Client fetch for GET /api/owner/mail/[id]/content (T11 route,
 * app/api/owner/mail/[id]/content/route.ts) and the download URL builder
 * for GET /api/owner/mail/[id]/attachments/[aid]. Mirrors that route's
 * response shape exactly -- see lib/owner/mail-content-server.ts's
 * MailContentState for the server-side source of truth this shadows.
 */

/** Mirrors lib/owner/mail-content-server.ts's MailAttachmentManifestEntry,
 * redeclared here (not imported) so this client module never pulls in that
 * "server-only"-guarded file even as a type-only reference. */
export interface MailAttachmentManifestEntry {
  id: string;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number;
  contentId: string | null;
  inlined: boolean;
}

export type MailContentFetchState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "unconfigured" }
  | { kind: "too_large" }
  | { kind: "decrypt_error" }
  | { kind: "unauthorized" }
  | { kind: "error" }
  | {
      kind: "content";
      subject: string;
      sender: string;
      sentAtMs: number;
      html: string | null;
      text: string;
      attachments: MailAttachmentManifestEntry[];
      inline: Record<string, string>;
    };

interface ContentRouteBody {
  state?: string;
  subject?: string;
  sender?: string;
  sentAtMs?: number;
  html?: string | null;
  text?: string;
  attachments?: MailAttachmentManifestEntry[];
  inline?: Record<string, string>;
}

export async function fetchMailContent(workspaceId: string, messageId: string): Promise<MailContentFetchState> {
  let response: Response;
  try {
    response = await fetch(
      `/api/owner/mail/${encodeURIComponent(messageId)}/content?workspaceId=${encodeURIComponent(workspaceId)}`,
      { credentials: "include" },
    );
  } catch {
    return { kind: "error" };
  }
  if (response.status === 401) return { kind: "unauthorized" };
  let body: ContentRouteBody;
  try {
    body = (await response.json()) as ContentRouteBody;
  } catch {
    return { kind: "error" };
  }
  switch (body.state) {
    case "content":
      return {
        kind: "content",
        subject: body.subject ?? "",
        sender: body.sender ?? "",
        sentAtMs: body.sentAtMs ?? Date.now(),
        html: body.html ?? null,
        text: body.text ?? "",
        attachments: body.attachments ?? [],
        inline: body.inline ?? {},
      };
    case "not_found":
      return { kind: "not_found" };
    case "unconfigured":
      return { kind: "unconfigured" };
    case "too_large":
      return { kind: "too_large" };
    case "decrypt_error":
      return { kind: "decrypt_error" };
    default:
      return { kind: "error" };
  }
}

/** Same-origin, authed, `Cache-Control: no-store` download for one
 * attachment -- never a re-hosted or third-party URL. */
export function mailAttachmentDownloadUrl(workspaceId: string, messageId: string, attachmentId: string): string {
  return `/api/owner/mail/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}?workspaceId=${encodeURIComponent(workspaceId)}`;
}
