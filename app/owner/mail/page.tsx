import { Suspense } from "react";
import { PageHeader } from "@/components/evhost-ui";
import { OwnerMailList } from "@/components/owner/OwnerMailList";

export default function OwnerMailPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Full email archive"
        title="Mail"
        description="Every captured Turo email, in full, for your whole team — searchable, linked to bookings and trips, and yours to delete on request."
      />
      <Suspense fallback={<div className="py-8 text-center text-sm text-muted">Loading mail…</div>}>
        <OwnerMailList />
      </Suspense>
    </div>
  );
}
