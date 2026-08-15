"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { sendGuestReminder } from "@/lib/owner/trip-repository";

export function ReminderButton({ tripId, className, fullWidth = false }: { tripId: string; className?: string; fullWidth?: boolean }) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setSending(true);
    setMessage(null);
    setError(null);
    try {
      const receipt = await sendGuestReminder(tripId);
      setMessage(`Sent to ${receipt.recipient}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The reminder could not be sent.");
    } finally {
      setSending(false);
    }
  }
  return <div className={className}><Button type="button" variant="brand" fullWidth={fullWidth} disabled={sending} onClick={() => void send()}>{sending ? "Sending…" : message ?? "Send reminder"}</Button>{error ? <p role="alert" className="mt-2 text-xs leading-5 text-danger">{error}</p> : null}<span className="sr-only" aria-live="polite">{message}</span></div>;
}
