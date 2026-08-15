export interface ReminderMessageInput {
  companyName: string;
  guestName: string;
  vehicleName: string;
  pickupDate: string;
  pickupLocation: string | null;
  portalUrl: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function maskEmail(value: string): string {
  const [local, domain] = value.trim().toLowerCase().split("@");
  if (!local || !domain) return "Guest email";
  const shown = local.slice(0, Math.min(2, local.length));
  return `${shown}${"•".repeat(Math.max(2, Math.min(6, local.length - shown.length)))}@${domain}`;
}

export function buildReminderMessage(input: ReminderMessageInput) {
  const firstName = input.guestName.trim().split(/\s+/)[0] || "there";
  const locationText = input.pickupLocation ? ` at ${input.pickupLocation}` : "";
  const subject = `${input.companyName}: prepare for your ${input.vehicleName} trip`;
  const text = [
    `Hi ${firstName},`,
    "",
    `Your ${input.vehicleName} trip with ${input.companyName} begins ${input.pickupDate}${locationText}.`,
    "Open your private trip portal to finish the guide and review pickup details:",
    input.portalUrl,
    "",
    "This link is private. Please do not forward it.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f8fa;color:#161a1f;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #d8dee4;border-radius:8px;padding:32px"><div style="font-size:22px;font-weight:700;letter-spacing:-.5px">evhost.app <span style="color:#087fd1">■</span></div><h1 style="font-size:26px;line-height:1.2;margin:32px 0 12px">Your trip is coming up</h1><p style="font-size:16px;line-height:1.6">Hi ${escapeHtml(firstName)},</p><p style="font-size:16px;line-height:1.6">Your <strong>${escapeHtml(input.vehicleName)}</strong> trip with ${escapeHtml(input.companyName)} begins ${escapeHtml(input.pickupDate)}${escapeHtml(locationText)}.</p><p style="margin:28px 0"><a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;background:#087fd1;color:#fff;text-decoration:none;border-radius:6px;padding:14px 22px;font-weight:700">Open private trip portal</a></p><p style="font-size:13px;line-height:1.5;color:#56616d">This link is private. Please do not forward it.</p></div></div></body></html>`;
  return { subject, text, html };
}
