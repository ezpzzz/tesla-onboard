import { PageHeader } from "@/components/evhost-ui";
import { OwnerInbox } from "@/components/owner/OwnerInbox";

export default function OwnerInboxPage() { return <div className="mx-auto max-w-4xl space-y-6"><PageHeader eyebrow="Bookings and updates" title="Inbox" description="Review Turo emails and calendar changes before they affect a trip or guest access." /><OwnerInbox /></div>; }
