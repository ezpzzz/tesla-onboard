# Turo email evidence record (gate 2)

Status: evidence detail supporting
[`docs/spikes/2026-08-16-turo-email-ingestion-go-no-go.md`](2026-08-16-turo-email-ingestion-go-no-go.md).
That doc is the release-governing gate list; the coverage gaps it records
remain open. Rollout sequencing lives in
[`docs/rollouts/2026-08-16-email-ingest-rollout.md`](../rollouts/2026-08-16-email-ingest-rollout.md);
day-to-day operation is
[`docs/runbooks/inbox-inbound-ingest.md`](../runbooks/inbox-inbound-ingest.md).
**No fingerprint has been approved.** `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS`
remains empty in every environment; nothing here authorizes populating it.

## a. Provenance

- 20 real, unmodified, direct-delivery `.eml` messages, captured from the
  receiving Gmail account's own message store (not forwarded copies).
- Stored only in the local, gitignored interim fixture location
  (`.turo-email-examples/`), never committed to git, never copied elsewhere.
- All 20 have distinct `Message-ID` headers (verified: 20 unique values
  across 20 files).

## b. Template taxonomy

Fingerprint is `sha256("turo-subject-v2\x1f" + normalized-subject)`, current
`lib/email/turo-parser.ts`. Normalization lowercases the subject, collapses a
leading `<name> has ...` token and a possessive `<name>'s ...` token to
`<name>`/`<name>'s`, and collapses digit runs to `#`.

| Notification-Name | Subject pattern (guest name → `<Name>`) | Samples | Parsed eventType | turo-subject-v2 fingerprint (sha256 hex) | Reservation-ID header present |
|---|---|---|---|---|---|
| ReservationBookedOwner | `<Name>'s trip with your Tesla Model 3 is booked!` | 5 | booking | `408a0a25580a6cf76d37809bf1bbc62dac527021c6c138da7eb121a2870dfc90` | y (5/5) |
| MessageOwner | `<Name> has sent you a message about your Tesla Model 3` | 3 | guest_message | `acf5b38fc95ef8633ad142b1a23dcf0656065153234d1b8681f861ffa82259a3` | y (3/3) |
| ApprovedChangeRequestBookedOwner | `You've confirmed <Name>'s change request with your Tesla Model 3` | 2 | change | `10f3fce9560c7099d2b31deb9b4d6c575a9504336adfaa0b809129de1cb956a8` | y (2/2) |
| ReimbursementPaidOwner | `<Name> has been charged for your reimbursement invoice` | 4 | noise | `034b46d6310833d90fbd996f4ea3a6220cf75315de48621ea436ff63c71fa725` | y (4/4) |
| ReimbursementSubmittedOwner | `Reimbursement invoice` (no name token) | 4 | noise | `d0786535885d05df3b91da08ed1fbb716b8275469752612422356d09354e8669` | y (4/4) |
| PaymentSentOwner | `Your earnings are on the way!` | 2 | noise | `ec84029ef965885935f0e41704924ab0c793153612f3a7b0a2a0ea7eac0adaf9` | n (0/2) |

20/20 fixtures accounted for across exactly 6 fingerprints; every fixture's
`Notification-Name` header maps 1:1 onto its subject-derived fingerprint
bucket (cross-checked independently from the header, not just the subject
text). `eventType` above is what the current parser actually returns for
every sample in the row (verified per-file, not just per-bucket).

## c. Authentication posture (verbatim, sampled across fixtures — identical shape on every fixture checked)

- `From: Turo <noreply@mail.turo.com>` on every sample; no `Reply-To` header
  on any of the 20 samples.
- `Message-ID: <token>@email.amazonses.com`.
- `Return-Path: <token>@return.mail.turo.com`.
- Dual DKIM pass: `dkim=pass header.i=@mail.turo.com ...` **and**
  `dkim=pass header.i=@amazonses.com ...` both present in the same
  `Authentication-Results` header on every sample.
- `spf=pass` (envelope sender `...@return.mail.turo.com`).
- `dmarc=pass (p=REJECT sp=QUARANTINE dis=NONE) header.from=turo.com`.
- Gmail single-hop ARC only (`ARC-Seal`, `ARC-Message-Signature`,
  `ARC-Authentication-Results` — one instance of each, i.e. Gmail's own
  ingestion hop, not a multi-hop forward chain). No `Received:` chain
  artifacts consistent with a relay/forward through a third mailbox.
- Custom headers present: `Notification-Name` (20/20), `Driver-ID` (20/20),
  `Feedback-ID` (20/20), `Reservation-ID` (10/20 — absent on both
  `PaymentSentOwner` earnings samples, which are account-level, not
  reservation-scoped).
- MIME: `multipart/alternative`, text and HTML parts present, zero
  attachments, on every sample. Sizes range ~16KB (earnings, no reservation
  detail block) to ~36KB (message/change-request samples with quoted guest
  text), consistent with a ~16-36KB envelope across the set.

## d. Findings

- **Pre-fix fingerprint instability, fixed.** Before the v2
  name-normalization pass, the 5 `ReservationBookedOwner` samples (5
  different guest first names in the subject) hashed to 5 distinct
  fingerprints instead of 1, because the raw subject text was hashed
  unnormalized. The v2 fingerprint function generalizes a leading
  `<name> has ...` token and a possessive `<name>'s ...` token before
  hashing. Re-run confirms convergence: all 5 booking samples now hash to
  the single fingerprint above, and the same holds for every other
  name-bearing template (guest message: 3→1, change: 2→1, reimbursement
  charged: 4→1).
- **Change-request misclassification, fixed.** `You've confirmed <Name>'s
  change request...` previously fell through to `unknown` because the
  classifier's change-keyword set didn't cover Turo's real
  `ApprovedChangeRequestBookedOwner` subject wording. The classifier now
  matches `change request` explicitly; both real change-confirmation
  samples classify as `change`, not `unknown`.
- **Relay-reply disproven.** No `Reply-To` header appears on any of the 20
  samples, and there is no evidence of a reply-to-Turo-relay-address path in
  these fixtures — every sample's only reply-relevant header is the
  no-reply `From` address.
- **`Notification-Name` as a future direction, with a caveat.** The header
  maps cleanly 1:1 with the subject-fingerprint buckets in this sample set,
  which suggests it could be a more robust template key than a
  subject-text hash. This is **unverified** as an authentication anchor:
  `Notification-Name` is not currently covered by either DKIM signature's
  `h=` (signed-header) list in these samples, so unlike the subject (which
  DKIM does cover), it is not itself cryptographically bound to the message.
  Any future move to key off it would need that gap addressed first — this
  is a direction, not a decision, and nothing here changes what the parser
  keys off today.

## e. Coverage and gaps

| Event type | Status | Notes |
|---|---|---|
| Booking | Captured | 5 distinct real samples, 1 fingerprint |
| Guest message | Captured | 3 distinct real samples, 1 fingerprint |
| Schedule change | Partial | 2 samples, same guest/reservation, only the host-approved `ApprovedChangeRequestBookedOwner` sub-template. Guest-initiated pre-approval-request and Turo-initiated reschedule templates not yet captured. |
| Cancellation | Open | 0 samples captured. |

For the two open gaps (schedule-change format variants, cancellation),
capture via Gmail's "Download original" on a real occurrence when one
arrives naturally, same as the 20 samples already captured — do not
synthesize or request a cancellation to manufacture a fixture.

## No approval implied

This document is an evidence record, not an authorization. No template
fingerprint listed above has been approved for any Auto capability.
`EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS` stays empty in every
environment until a human explicitly approves specific fingerprints through
whatever review process the go/no-go doc's gates ultimately require, which
this document does not itself define.
