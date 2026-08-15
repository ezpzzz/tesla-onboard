"use client";

import { useEffect, useState } from "react";
import { cn } from "@/components/ui";

export function OwnerAvatar({
  avatarUrl,
  name,
  className,
}: {
  avatarUrl?: string | null;
  name?: string | null;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initial = name?.trim().charAt(0).toUpperCase() || "A";
  const showImage = Boolean(avatarUrl && avatarUrl !== failedUrl);

  useEffect(() => {
    if (avatarUrl !== failedUrl) setFailedUrl(null);
  }, [avatarUrl, failedUrl]);

  return (
    <span
      data-owner-avatar={showImage ? "image" : "initials"}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface text-sm font-semibold text-ink",
        className,
      )}
    >
      {showImage ? (
        // Provider and EVhost upload URLs are protocol/path validated before rendering.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl!}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailedUrl(avatarUrl!)}
        />
      ) : initial}
    </span>
  );
}
