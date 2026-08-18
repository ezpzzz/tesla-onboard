"use client";

import { useParams } from "next/navigation";
import { OwnerMailDetail } from "@/components/owner/OwnerMailDetail";

export default function OwnerMailDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <div className="mx-auto max-w-3xl">
      <OwnerMailDetail messageId={params.id} />
    </div>
  );
}
