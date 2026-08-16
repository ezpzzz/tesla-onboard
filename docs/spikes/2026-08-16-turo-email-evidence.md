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

- 21 real, unmodified, direct-delivery `.eml` messages, captured from the
  receiving Gmail account's own message store (not forwarded copies): 20
  analyzed in full detail as of this doc's original pass, plus 1 additional
  cancellation sample captured 2026-08-16 (see §b and §e — its
  `Notification-Name`, parsed `eventType`, and `turo-subject-v2` fingerprint
  are recorded below; its DKIM/SPF/DMARC/ARC/MIME detail has not yet been
  independently transcribed into §c the way the first 20 were).
- Stored only in the local, gitignored interim fixture location
  (`.turo-email-examples/`) on a FileVault-encrypted machine — decided
  2026-08-16 to be the approved encrypted test-fixture location (see
  `docs/rollouts/2026-08-16-email-ingest-rollout.md` §7) — never committed to
  git, never copied elsewhere.
- All 20 of the originally-analyzed samples have distinct `Message-ID`
  headers (verified: 20 unique values across 20 files). The 21st
  (cancellation) sample's `Message-ID` uniqueness against the other 20 has
  not yet been independently re-checked in this pass.

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
| CancelledReservationOwner | `<Name> has cancelled their trip with your Tesla Model 3` | 1 | cancellation | `b5821f32c3a1609b99819de62b48ac595d158832514838e5608e481f6f232ff3` | not yet independently recorded (1/1) |

20/20 of the originally-analyzed fixtures are accounted for across exactly 6
fingerprints; every one of those fixtures' `Notification-Name` header maps
1:1 onto its subject-derived fingerprint bucket (cross-checked independently
from the header, not just the subject text). `eventType` above is what the
current parser actually returns for every sample in each of those 6 rows
(verified per-file, not just per-bucket).

The `CancelledReservationOwner` row (2026-08-16) is derived differently, by
necessity, and is called out separately: its `Notification-Name` and
`eventType` come from direct inspection of the single captured real fixture,
but its fingerprint was **not** computed by reading that file's actual
subject line — it was independently re-derived by calling the repo's
exported `parseTuroEmail()` (`lib/email/turo-parser.ts`) from a scratch
script outside the repo (`/private/tmp`, not committed anywhere) against the
literal subject template `"<Name> has cancelled their trip with your Tesla
Model 3"`, substituted with two different fake guest first names ("Taylor"
and "Jordan") — never the real guest's name from the fixture. Both runs
returned `eventType: "cancellation"` and the identical fingerprint above,
confirming the v2 name-normalization pass converges regardless of which name
fills the token, exactly as it does for the other 6 rows. This method was
chosen specifically so the real guest's name never has to be read into, or
written into, this or any other document.

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

This section (DKIM/SPF/DMARC/ARC/header/MIME detail) still describes only
the original 20 fixtures. The 21st (`CancelledReservationOwner`) fixture
captured 2026-08-16 has not yet had this same header-by-header transcription
done — its `Notification-Name`, parsed `eventType`, and fingerprint are
recorded in §b, but full gate-2 evidence for it is still outstanding.

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
| Cancellation | Partial (1/2) | 1 real sample captured 2026-08-16 (`CancelledReservationOwner`; parses as `eventType: "cancellation"`; `turo-subject-v2` fingerprint `b5821f32c3a1609b99819de62b48ac595d158832514838e5608e481f6f232ff3`, converges across two fake-name test inputs — see §b). Second sample from a different guest still required before gate 1's ≥2-sample bar is met. |

For the remaining open gaps (schedule-change format variants, a second
cancellation sample from a different guest), capture via Gmail's "Download
original" on a real occurrence when one arrives naturally, same as the 21
samples already captured — do not synthesize or request a cancellation to
manufacture a fixture.

## No approval implied

This document is an evidence record, not an authorization. No template
fingerprint listed above has been approved for any Auto capability.
`EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS` stays empty in every
environment until a human explicitly approves specific fingerprints through
whatever review process the go/no-go doc's gates ultimately require, which
this document does not itself define.
