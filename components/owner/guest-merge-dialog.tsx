"use client";

/**
 * Guest merge confirmation dialog (Phase 7, design review Issue 5 / 5A).
 *
 * Spec, verbatim from the design doc: "title names the consequence
 * ('Merge Riley T. into Sam K.?'), body states exactly what happens with
 * real counts ('4 trips and 2 identity keys move to Sam K. Riley T.'s
 * record is removed. You can re-split by key later.'), primary button
 * carries the consequence verb ('Merge records'), never a bare
 * 'Are you sure?'". Mobile renders as the same near-full-height native
 * `<dialog>` bottom sheet pattern used by components/owner/OwnerInbox.tsx
 * (visible Close, scrollable body, safe-area padding, sticky actions);
 * desktop renders the same `<dialog>` element centered instead.
 *
 * `tripsToMove`/`keysToMove` are caller-supplied counts, not computed here —
 * identity keys never reach the client (see lib/owner/guest-linking.ts's
 * header comment), so the authoritative count can only come from a
 * server-side merge-preview call. This component is the presentation layer;
 * it renders whatever counts it is given and never guesses one.
 */

import { useEffect, useRef } from "react";
import type { Guest } from "@/lib/owner/types";
import { Button } from "@/components/ui";

export interface GuestMergeCopy {
  title: string;
  body: string;
  confirmLabel: string;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Pure copy builder — exact wording from the design's Issue 5 example,
 * generalized over real counts and names. Never a bare "Are you sure?". */
export function buildGuestMergeCopy(
  source: Pick<Guest, "displayName">,
  target: Pick<Guest, "displayName">,
  tripsToMove: number,
  keysToMove: number,
): GuestMergeCopy {
  const sourceName = source.displayName.trim() || "This guest";
  const targetName = target.displayName.trim() || "this guest";
  const tripsPart = pluralize(tripsToMove, "trip", "trips");
  const keysPart = pluralize(keysToMove, "identity key", "identity keys");
  // Names like "Sam K." can already end in a period (an initial's
  // abbreviation) — never double it into "Sam K..".
  const targetSentence = targetName.endsWith(".") ? targetName : `${targetName}.`;
  return {
    title: `Merge ${sourceName} into ${targetName}?`,
    body: `${tripsPart} and ${keysPart} move to ${targetSentence} ${sourceName}'s record is removed. You can re-split by key later.`,
    confirmLabel: "Merge records",
  };
}

export interface GuestMergeDialogProps {
  open: boolean;
  source: Guest;
  target: Guest;
  tripsToMove: number;
  keysToMove: number;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function GuestMergeDialog({
  open,
  source,
  target,
  tripsToMove,
  keysToMove,
  busy = false,
  onConfirm,
  onCancel,
}: GuestMergeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const copy = buildGuestMergeCopy(source, target, tripsToMove, keysToMove);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="guest-merge-dialog-title"
      onClose={onCancel}
      // Mobile: near-full-height bottom sheet, matching OwnerInbox's
      // `<dialog>` pattern exactly. Desktop (md+): centered card.
      className="m-0 mt-auto h-[88dvh] max-h-[88dvh] w-full max-w-none rounded-t-2xl border-0 bg-white p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-h-[85vh] md:w-[440px] md:rounded-2xl"
    >
      <div className="flex h-full flex-col md:h-auto">
        <div className="flex items-center justify-between border-b border-line p-4">
          <strong id="guest-merge-dialog-title" className="text-sm">
            {copy.title}
          </strong>
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="min-h-11 rounded-md px-3 text-sm"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 md:flex-none">
          <p className="text-sm text-ink-soft">{copy.body}</p>
        </div>
        <div className="border-t border-line bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="brand" onClick={onConfirm} disabled={busy}>
              {busy ? "Merging…" : copy.confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
