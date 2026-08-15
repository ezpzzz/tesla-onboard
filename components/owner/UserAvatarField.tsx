"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ownerAvatarUrl,
  ownerDisplayName,
  ownerUploadedAvatarPath,
  type OwnerAuthUserLike,
} from "@/lib/owner/owner-avatar";
import { OwnerAvatar } from "@/components/owner/OwnerAvatar";
import { Button, Card } from "@/components/ui";

const MAX_BYTES = 2 * 1024 * 1024;

export function UserAvatarField() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("Owner");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient().auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      const user = data.user as OwnerAuthUserLike;
      setName(ownerDisplayName(user));
      setAvatarUrl(ownerAvatarUrl(user));
      setUploaded(Boolean(ownerUploadedAvatarPath(user)));
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      setMessage("Choose a PNG, JPEG, or WebP image no larger than 2 MB.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/owner/avatar", { method: "POST", body: form });
      const body = await response.json().catch(() => ({})) as { avatarUrl?: string; error?: string };
      if (!response.ok || !body.avatarUrl) throw new Error(body.error ?? "Avatar upload failed.");
      setAvatarUrl(body.avatarUrl);
      setUploaded(true);
      setMessage("Profile photo updated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message.replaceAll("_", " ") : "Avatar upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/owner/avatar", { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { avatarUrl?: string | null; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Avatar removal failed.");
      setAvatarUrl(body.avatarUrl ?? null);
      setUploaded(false);
      setMessage(body.avatarUrl ? "Using your sign-in provider photo." : "Using your initials.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message.replaceAll("_", " ") : "Avatar removal failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-md p-5">
      <div className="flex items-start gap-4">
        <OwnerAvatar avatarUrl={avatarUrl} name={name} className="h-16 w-16 text-lg ring-1 ring-line" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">Profile photo</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            EVhost uses your Google, Apple, or other sign-in photo when available. An upload overrides it.
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        name="owner-avatar"
        type="file"
        aria-label="Choose profile photo"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = "";
        }}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy || loading} onClick={() => inputRef.current?.click()}>
          {busy ? "Updating…" : uploaded || avatarUrl ? "Replace photo" : "Upload photo"}
        </Button>
        {uploaded ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()}>Remove upload</Button> : null}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">PNG, JPEG, or WebP up to 2 MB. Photos are cropped to a circle in the app.</p>
      {message ? <p role="status" className="mt-2 text-xs leading-relaxed text-muted">{message}</p> : null}
    </Card>
  );
}
