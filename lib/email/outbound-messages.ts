export interface OperationalEmailMessage { subject: string; text: string; html: string }

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function buildOwnerBrakeAlert(input: { guestName: string; change: string; deadline: string; inboxUrl: string }): OperationalEmailMessage {
  const subject = `Action scheduled for ${input.guestName}'s trip`;
  const text = `${input.change}\n\nThis change will apply after ${input.deadline}. Open EVhost Inbox to review or abort: ${input.inboxUrl}`;
  return { subject, text, html: `<p>${escapeHtml(input.change)}</p><p>This change will apply after <strong>${escapeHtml(input.deadline)}</strong>.</p><p><a href="${escapeHtml(input.inboxUrl)}">Review or abort in EVhost Inbox</a></p>` };
}

export function buildGuestOnboardingDelivery(input: { guestName: string; vehicleName: string; onboardingUrl: string; hostName: string }): OperationalEmailMessage {
  const subject = `Get ready for your ${input.vehicleName}`;
  const text = `Hi ${input.guestName},\n\n${input.hostName} invited you to prepare for your upcoming Tesla trip. Open your private EVhost guide: ${input.onboardingUrl}`;
  return { subject, text, html: `<p>Hi ${escapeHtml(input.guestName)},</p><p>${escapeHtml(input.hostName)} invited you to prepare for your upcoming Tesla trip.</p><p><a href="${escapeHtml(input.onboardingUrl)}">Open your private EVhost guide</a></p>` };
}
