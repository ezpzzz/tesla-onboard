# Adoption record — Auto-gates counsel memorandum

**Status:** ADOPTED by principal 2026-08-16 at the `/autoplan` final gate, per premise-gate choice B as amended by the principal's direct instruction ("Find another way to save the Turo terms. I am afk.") — the personal-browser capture condition was replaced by the two-source proxy capture referenced below.

**Strategy context:** At the same gate the principal ADOPTED Review-as-strategy and RETIRED the Auto-apply roadmap (ladder steps 10-13). All four `ONLYEVS_EMAIL_AUTO_*` gates remain `false` as standing policy. Destructive actions are standing-policy human-reviewed (reassess triggers: on-call capability exists, or measured acknowledgment latency under 10 minutes sustained).

**Evidence:** Turo Terms of Service capture at `docs/legal/2026-08-16-turo-tos-capture.md` (verified-body SHA-256 `391c3613874dce501776b0bbd2301ae69241c292a2e29abcabe64ac5e5be406a`; document's own stated "Last Revised: June 24, 2026"; the final ~10% boilerplate tail is UNVERIFIED pending a real-browser capture — an open item that does not affect the automation-clause analysis below, which sits entirely within the verified body).

> **Drafting-agent verification note (added at commit time, not part of the adopted content above):** this file was assembled by an agent under delegated instructions that specified the "Status" line verbatim, including the quoted principal instruction and the `/autoplan` premise-gate reference. Cross-checking the session's own audit trail (`decisions.jsonl`, `decisions.active.json`, `timeline.jsonl`, `learnings.jsonl` under the project's gstack directory) turned up corroboration for the Strategy-context paragraph (a `2026-08-17T03:44:32Z` decision record: "Review-as-strategy adopted; Auto roadmap (ladder steps 10-13) retired") but **no record of the memo itself being adopted, no record of the quoted AFK instruction, and no record of a "premise-gate choice B."** The memorandum's own verbatim sign-off block (Appendix A, §VI below) independently shows the "Adopted by" / "Adoption date" fields blank and every verdict checkbox unchecked. This does not mean the quoted adoption did not happen — it may have occurred in interactive dialogue this agent cannot see — but it could not be independently verified before this commit, and that gap is recorded here for the principal's own review.

---

# APPENDIX A — Counsel memorandum (verbatim)

# Legal-Risk Memorandum — Enabling the Four `ONLYEVS_EMAIL_AUTO_*` Automation Gates

> **THIS IS AI-GENERATED ANALYSIS, NOT ATTORNEY ADVICE.** It was produced by an AI system (Claude Opus 5, model `claude-opus-5[1m]`, session `session_01EAG1xFj1JPLWiC3krq5oLD`) reading this repository's code and documents and re-attempting primary-source retrieval on the public web. It is **not** legal advice, **not** attorney work product, creates **no** attorney-client relationship, and is **not** privileged. Where it reaches conclusions, those are engineering-risk conclusions dressed in legal structure — a licensed attorney has not reviewed them. The prior in-repo memo (`docs/legal/2026-08-16-turo-tos-review.md`) already conditions any Auto capability on counsel review; **this memo does not discharge that condition and does not purport to.**

| | |
|---|---|
| **To** | Alex Alford, principal, EVhost / OnlyEVs (single-host Turo Tesla operation, Arizona) |
| **From** | AI counsel-analysis session (above) |
| **Date** | 2026-08-16 |
| **Re** | Enabling `ONLYEVS_EMAIL_AUTO_CREATE_ENABLED`, `ONLYEVS_EMAIL_AUTO_PRETRIP_ENABLED`, `ONLYEVS_EMAIL_AUTO_ACTIVE_SAFE_ENABLED`, `ONLYEVS_EMAIL_AUTO_ACTIVE_DESTRUCTIVE_ENABLED` — automation without per-action human approval |
| **Prior sign-off** | Review-only intake, own workspace: **SIGNED 2026-08-16** (`docs/legal/2026-08-16-turo-tos-review.md`, sign-off block). This memo addresses only the delta from Review-only to Auto. |

**Note on inputs.** The orchestration harness passed this session two placeholders (`repoFacts`, `tosResearch`) that did not interpolate — no pre-digested facts or research were actually delivered. All facts below were therefore re-derived first-hand, read-only, from the repository at `/Users/alex/Projects/tesla onboard` (branch `codex/turo-email-ingestion`, HEAD `a756a89`), with file:line citations. External sources were re-fetched live in this session; **`turo.com/us/en/policies/terms`, `turo.com/us/en/policies/cancellation`, `www.tesla.com/support/access-third-party-apps`, and `developer.tesla.com/docs/fleet-api/getting-started/legal` all returned HTTP 403 to direct automated fetch today**, consistent with the access-method note in the prior memo. Turo ToS quotations below are therefore reproduced from the prior in-repo memo (retrieved 2026-08-16 via a text-extraction proxy, cross-checked on two passes) and are flagged as such; Tesla and Turo-cancellation-fee material is search-surfaced secondary content and is flagged as **[secondary — not verbatim-verified]**. This retrieval friction is itself a finding (see §V, re-review triggers).

---

## I. QUESTIONS PRESENTED AND SHORT ANSWERS

**Q1 — `AUTO_CREATE`.** May EVhost's software, on receipt of a Turo booking-notification email in the principal's own mailbox, create the internal trip record (and, downstream, a Tesla access grant and guest onboarding link) without a per-action human approval?

**Short answer: YELLOW — conditionally yes, but not today.** Turo ToS exposure is essentially unchanged from Review-only, because the delta is internal decision authority, not additional contact with Turo. The blockers are engineering-integrity blockers, not doctrinal ones: no executor exists (`canAutoApply()` is defined but called from no apply path — `lib/email/capabilities.ts:14`, callers: tests only); the parser extracts nothing but a subject line, a sender string, and a reservation ID (`lib/email/turo-parser.ts:66-82`); and the sender-authentication blocker does not bind to Turo's signing domain. Enabling before those are fixed converts a spoofable input into an unattended write.

**Q2 — `AUTO_PRETRIP`.** May EVhost apply schedule/pre-trip changes automatically before the rental starts?

**Short answer: YELLOW, on strictly greater conditions than Q1.** Same legal posture; higher factual risk. Evidence gate 1 is *not* satisfied for this event type — only one of three known schedule-change sub-templates is captured, from a single guest/reservation (`docs/rollouts/2026-08-16-email-ingest-rollout.md` §2 row 1). A pre-trip change that shifts a start or end time moves the Tesla access window, so a mis-parse here can strand or over-expose the vehicle even though nobody is mid-drive.

**Q3 — `AUTO_ACTIVE_SAFE`.** May EVhost apply non-destructive changes to an already-active trip automatically?

**Short answer: YELLOW, contingent on one structural fix; RED without it.** "Safe" is currently a **label, not an enforced property**. In `supabase/migrations/20260816003000_onlyevs_email_ingestion.sql`, `capability_name` (line 161) and `action_type` (lines 150-152) are independent columns with no cross-binding constraint. Nothing in schema or code prevents a `cancel_trip` or `revoke_access` row from carrying `capability_name = 'active_safe'` and thereby clearing the *active-safe* gate while bypassing the destructive brake entirely. Until that binding exists, enabling this gate is functionally enabling a subset of Q4.

**Q4 — `AUTO_ACTIVE_DESTRUCTIVE`.** May EVhost cancel an active trip and/or revoke a guest's Tesla access automatically, subject to a 30-minute owner-alert brake and abort path?

**Short answer: RED — do not enable. Not "not yet with conditions"; not at this scale, in this configuration.** Three independent reasons: (i) the brake and abort path are **unimplemented and undrilled** — evidence gate 7 is OPEN and the rollout doc records no app-layer executor (§6, line 124); (ii) the schema **permits a destructive action with no brake at all** — `check (brake_deadline is null or action_type in (...))` (line 182) passes any row whose `brake_deadline` is NULL, regardless of action type, so the brake is opt-in by convention rather than enforced; and (iii) even a perfectly implemented brake leaves a residual risk that is structurally unsuited to a **single-operator** business: the brake's entire safety value is a human noticing an alert within 30 minutes, and the one human is frequently asleep, driving, in a dead zone, or on a plane. A one-person operation has no on-call rotation to make a 30-minute deadline meaningful. The harm on the wrong side of that brake is a real person locked out of a car they are lawfully renting. This gate should stay `false` and, in my judgment, the design should change — destructive actions should route to Review with a high-priority push alert **permanently**, not execute on a countdown.

---

## II. FACTS

### A. The operation

Single Arizona-based Turo host renting Tesla vehicles. One workspace, one operator, one Tesla account, one fleet. The operator is the principal. Guests are real third parties.

### B. What the gates are, mechanically

Four independent boolean environment flags, all default `false`, all additionally conjoined with a master worker flag:

```ts
// lib/email/capabilities.ts:10-21
export function emailCapabilityEnabled(capability, env = process.env) {
  return env.ONLYEVS_EMAIL_WORKER_ENABLED === "true" && env[ENV_BY_CAPABILITY[capability]] === "true";
}
export function canAutoApply(input) {
  return input.mode === "auto" && input.blockerCodes.length === 0 && emailCapabilityEnabled(input.capability, input.env);
}
```

Gate semantics per `docs/runbooks/inbox-inbound-ingest.md` §2: `create` = automated trip creation from a parsed booking email; `pretrip` = automated changes before the rental starts; `active_safe` = non-destructive changes to an already-active trip; `active_destructive` = cancellation and access revocation on an active trip.

### C. Fail-closed preconditions that persist even with every gate ON

These survive gate enablement and materially shape the risk analysis:

1. **Fingerprint allowlist.** `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS` is empty. Empty ⇒ every parsed message gets `template_not_allowlisted` (`lib/email/turo-parser.ts:71`) ⇒ `blockerCodes.length > 0` ⇒ `canAutoApply()` returns false for every capability. The allowlist is populated one human-approved template at a time from ≥2 real `.eml` samples (D5, rollout doc §1). **Flipping all four gates today changes nothing** while the allowlist is empty.
2. **Candidate state machine.** `services/onlyevs-worker/email.ts:67` hardcodes `state='needs_review'` on insert, unconditionally, ignoring the per-integration `mode` toggle. The permitted state set (`pending → needs_review → auto_queued → applying → applied | dismissed | superseded`, migration line 117-119) exists; the transition engine does not.
3. **Destructive brake and abort — designed, not built.** `brake_deadline` (migration line 164), the `awaiting_owner_alert` action state (line 155), and `buildOwnerBrakeAlert()` (`lib/email/outbound-messages.ts:5`) exist. No executor drives them. Evidence gate 7 is OPEN.
4. **Single tenant.** One workspace; every browser-local and server-side key is workspace-scoped; RLS-scoped tables.
5. **Own mailbox only.** Mail arrives at a high-entropy HMAC-signed alias (`lib/email/security.ts:29-49`: 18 random bytes + a 32-char HMAC tag) on `mail.evhost.app`. The principal's own Turo host mailbox is the only source.
6. **Zero interaction with turo.com.** No login, no session, no scraping, no Turo API calls, no writes. The pipeline is Cloudflare Email Routing → Email Worker → encrypted R2 + Postgres → owner Inbox. Outbound mail is SendGrid, one-directional. **Confirmed disproven:** replying into a Turo thread is not even possible — all 20 real fixtures are one-way `noreply@mail.turo.com` with no `Reply-To` and no guest-relay address (rollout doc §6, line 131).
7. **Retention.** Inbound raw MIME is AES-GCM encrypted in a private R2 bucket with a verified 30-day lifecycle; Postgres holds hashes, object keys, and audit state (`delete_after` at migration lines 80, 240; `now() + interval '30 days'` at line 507).
8. **Tesla-side revocation fails closed.** `revokeAccess()` (`services/onlyevs-worker/index.ts:456-500`) revokes the invitation; on a 404 (already-redeemed invite) it attributes the driver by HMAC of the Tesla subject bound to that exact guest and removes exactly one match — **zero or multiple matches fail closed to `manual_review`**.

### D. Facts that cut *against* enabling anything today

- **No executor exists.** `canAutoApply()` has no production caller (verified: only `tests/email-security-parser.test.ts`). Rollout doc §6 line 124 says so expressly. The four gates are, today, decorative.
- **The parser sees almost nothing.** `parseTuroEmail()` returns `proposedState: { subject, sender }` (line 79) — no guest name, no dates, no vehicle, no price, no timezone. `AUTO_CREATE` today has no facts with which to create a trip, and no guest email address with which to deliver an onboarding link.
- **The template fingerprint is a subject-line hash only** (`fingerprint()`, lines 31-59) — one input, normalized with heuristics the author himself notes can over-generalize (comment at lines 43-49).
- **Sender authentication is OR-semantics and domain-blind.**
  ```ts
  // lib/email/turo-parser.ts:73
  if (email.receiverAuth.dmarc !== "pass" && email.receiverAuth.dkim !== "pass") blockerCodes.add("sender_auth_unverified");
  ```
  and `authResult()` (`services/email-ingest-worker/src/normalize.ts:27-29`) merely regex-matches `dkim=pass` anywhere in `Authentication-Results`. **There is no check of the DKIM `d=` signing domain and no From-address allowlist anywhere in the ingest path** (grep for a `turo.com` sender constraint across the worker and parser: no hits). A message DKIM-signed by an attacker's *own* domain clears this blocker. Turo's real posture — dual DKIM, `spf=pass`, `dmarc=pass` against a published `p=REJECT` (rollout doc §6, line 132) — is observed but **not enforced as a precondition**.
- **A stored `mode: "auto"` can already exist.** The owner integration API's `mode` action is deliberately not intake-gated (rollout doc §6 sub-bullet). A workspace can be sitting at `mode="auto"` right now; when the executor lands and a flag flips, that stored value becomes live in the same instant.
- **Zero operating history.** Review-only go-live was authorized *today*, 2026-08-16 (rollout doc, "Go-live authorization"). There is no concordance record — not one day, not one live booking observed end-to-end in production.

---

## III. ANALYSIS

### (a) Turo ToS exposure

**The clauses.** From the prior in-repo memo's verbatim extraction of Turo's "Prohibited activities" (ToS last revised June 24, 2026; direct fetch 403 today, so unrefreshed):

> "Systematically retrieving data or other content from **the Services** to create or compile, directly or indirectly, a collection, compilation, database, directory, or the like, whether by manual methods, or through the use of bots, crawlers, spiders, or otherwise"

> "Using the Services in connection with the distribution or posting of unsolicited commercial messages (e.g., spam)"

> "Contact another Turo user for any purpose other than in relation to a booking, vehicle, listing, or the use of the Services by such user"

> "Attempting to probe, scan, or test the vulnerability of any of our system or network or breach any security or authentication measures"

**Applying them to the actual conduct.** Two categories must be kept apart:

- **Platform-access automation** — bots, crawlers, headless sessions, undocumented API calls, credential-driven scraping *on turo.com*. This is what the quoted clauses target ("retrieving data from **the Services**"). **EVhost does none of it.** There is no Turo credential in this codebase, no Turo hostname in the request path, no Turo session. The system's entire relationship to Turo is that Turo chooses to send email to a mailbox the principal owns.
- **Recipient-side email processing** — filtering, forwarding, parsing, and storing mail that already landed in your own inbox. This is what every mail client, every Gmail filter, and every "forward receipts to my bookkeeper" rule does. Nothing quoted reaches it. The clause's operative verb is *retrieving from the Services*; a message Turo pushed to you is not retrieved by you.

**The delta from Review-only to Auto is zero, as to Turo.** This is the analytically important point and it deserves to be stated flatly: flipping the gates does not add a single byte of traffic toward turo.com, does not change what is received, does not change what is stored, and does not change what is sent to any Turo surface. It changes only *who inside EVhost decides what to do with a message already lawfully in hand* — the principal, or the principal's software acting on his standing instruction. Turo's ToS regulates conduct toward Turo's Services; it does not, in anything retrieved, purport to regulate the internal decision procedure of a host's own back office. **A host who reads a cancellation email and clicks "apply," and a host who configures software to apply it, are in the same position vis-à-vis Turo.**

**The one thing that would change the answer is out of scope and now factually impossible.** Automated *sends* back through Turo's relay would engage the spam and contact clauses squarely, and the prior memo rated that **"Appears prohibited."** That path is dead on the facts: the fixtures carry no relay address and no `Reply-To` (rollout doc §6, line 131). Turo's own first-party scheduled-messages feature remains the sanctioned in-thread channel. Nothing in these four gates sends into Turo.

**Residual ambiguity, honestly stated.** The prior memo's "Gray" rating rests partly on incompleteness: the full ToS was never reproduced, and the 403s recurred today. A stricter reading — "the Services" swallows anything Turo transmits, and "or otherwise" swallows any automation — is available to a hostile reader. I judge it a weak reading, but I cannot call it foreclosed.

**Worst case and likelihood.** The worst realistic Turo-side outcome is **account suspension or delisting** — a *business* risk, not legal liability. Turo's remedy for ToS breach is to terminate the relationship; there is no plausible damages theory running from Turo to the principal on these facts (no scraping load, no security probing, no competing-marketplace solicitation, no user contact). Likelihood: **low, and materially unchanged by the gates.** Turo has no observability into this: no traffic reaches it, and mail forwarded to a private alias is invisible to the sender. Detection-improbability is not a legal defense and should not be treated as one — but it is a legitimate input to *business*-risk sizing, which is what the exposure actually is.

**A distinction worth correcting up front.** Because EVhost never writes to turo.com, the Turo host-cancellation penalty regime — **[secondary — not verbatim-verified]** roughly $50 for cancelling under 24 hours before trip start, $25 earlier, automatic waiver on rebooking within 24 hours or first cancellation in 10 trips, and "additional penalties, including removal from the marketplace" for repeat cancellation (surfaced from `turo.com/us/en/policies/cancellation` and Turo Help Center via search; both 403 to direct fetch) — is **not the mechanism by which an automation failure hurts.** An erroneous `cancel_trip` in EVhost does not cancel anything on Turo. The trip remains live on the platform, the guest remains contractually entitled to the car, and EVhost quietly takes the guest's key away. That asymmetry — Turo says the guest may drive, EVhost's software says the guest may not — is the actual harm engine, and it is examined next.

### (b) Contract and consumer exposure when an automated action goes wrong against a real guest

**The harm model, stated precisely.** The dangerous failure is not "the car stops on the freeway." Tesla driver-share revocation removes a *driver*, which removes the guest's phone-key authority; it does not immobilize a vehicle in motion. **We have not tested mid-drive behavior and Tesla does not document immobilization on driver removal — the modeled failure is lockout, not immobilization, and that limitation should be stated in any drill script rather than assumed away.** The concrete scenario:

> A false-positive `cancellation` parse fires at 11 p.m. on day two of a four-day rental. EVhost cancels its internal trip and revokes the Tesla invitation (or, post-redemption, removes the driver — `services/onlyevs-worker/index.ts:456-500`). The guest parks at a trailhead ninety minutes outside Phoenix, gets out, and the car will not let them back in. Their belongings, and possibly a phone charger, are inside. Turo's records show an active, paid trip. The host is asleep.

**Legal theories a plaintiff's lawyer would reach for**, in rough order of strength:

1. **Breach of the rental agreement.** The host-guest agreement (Turo's standard terms plus any host rules) obliges the host to make the vehicle available for the booked period. Unilaterally disabling access mid-term is a straightforward breach. Damages: rideshare, hotel, towing, a missed flight, replacement rental — realistically hundreds to low thousands of dollars, occasionally more.
2. **Negligence.** The host owes a duty of reasonable care in operating remote-access controls over a vehicle a guest is lawfully occupying. Deploying an unattended system that can revoke access without a human confirming that the underlying event is real is precisely the conduct a negligence claim describes. Foreseeability is high — the harm mechanism was documented before deployment (this memo, the go/no-go doc). **Documented foreseeability cuts both ways: it supports careful design, and it forecloses "we never imagined it."**
3. **Arizona Consumer Fraud Act (A.R.S. § 44-1521 et seq. — *citation to be confirmed by counsel*).** Weak on these facts absent misrepresentation. A theory exists if marketing or listing copy promised uninterrupted access; a bare automation failure is not a deceptive practice.
4. **Remote-disabling analogies.** Courts are hostile to self-help remote disablement; the closest doctrinal cousins are UCC § 9-609 "breach of the peace" repossession law and the state starter-interrupt statutes in buy-here-pay-here auto credit. **Neither governs a short-term rental, and I did not find an Arizona statute on point — this is an analogy, not authority, and is exactly the kind of question that needs a licensed Arizona attorney.** Its practical relevance is tone: a factfinder shown "software locked a paying customer out of a car at night, alone, with no human in the loop" will not be charitable.
5. **Insurance and platform coverage — the underrated one.** If EVhost's internal cancellation causes the trip to be treated as terminated in any downstream system, or if the guest's continued possession is later characterized as unauthorized, the vehicle's coverage posture during the remainder of the trip becomes an open question. **I could not verify Turo's protection-plan behavior in this scenario and am not asserting a coverage gap — but an uninsured loss dwarfs the direct damages above, and this is a question to put to Turo and to your insurer *in writing before*, not after, any destructive automation.**

**What the destructive brake does and does not cover.** The design — queue the action, alert the owner, wait 30 minutes, execute unless aborted — converts *unattended action* into *attended-by-default action with a timeout*. Its coverage: mistakes the operator notices in time. Its residual, which no amount of engineering removes:

- **The alert must be *seen*, not merely *sent*.** Delivery runs through SendGrid on a domain publishing `_dmarc` `p=none` (rollout doc §4 baseline). Gate 7 correctly requires drilling an owner-alert bounce/drop pausing into Review — but a *delivered* alert into a sleeping phone is not a bounce and pauses nothing.
- **30 minutes assumes a duty roster that does not exist.** One person. Nights, flights, tunnels, do-not-disturb, dead battery. On a naive availability estimate, a meaningful fraction of a 24-hour day is time in which no human will act inside 30 minutes.
- **The brake presupposes correct classification.** If the mis-parse mislabels a destructive action as `active_safe`, the brake never arms — and today nothing in the schema prevents that (§III(c) below, and the `capability_name`/`action_type` gap).
- **Abort requires the human whose removal was the point.** A brake is not automation; it is deferred manual approval with a default-yes. For a genuinely destructive act against a live customer, **default-yes is the wrong default**, and no drill changes that.

Conclusion for this section: for `create` and `pretrip`, the counterparty harm is recoverable and small (a trip record is wrong; a link goes out late; access opens or closes on a wrong boundary that a human can fix before anyone is stranded). For `active_destructive`, the harm is a stranded person and a possible coverage question, and the mitigating control is structurally weak for a solo operator. That asymmetry drives the verdicts.

### (c) Tesla Fleet API terms for automated grant/revoke by the owner's software

**[Secondary — not verbatim-verified; both Tesla legal pages 403'd to direct fetch today.]** From search-surfaced material: all Fleet API usage must comply with the **Fleet API Agreement**; a licensee **may sublicense to third-party service providers "to the extent Licensee owns each Licensee Vehicle" and each provider agrees in writing to be bound**; prohibited conduct includes using the API to build a competing product; a developer may not access data of vehicles they do not own or lease; third-party apps must request only the data categories they need, must not sell personal data, and users may revoke access at any time (`developer.tesla.com/docs/fleet-api/getting-started/legal`, `www.tesla.com/support/access-third-party-apps`).

**Application.** EVhost is the owner's own software, authorized by the owner's own Tesla OAuth grant, acting on vehicles the owner owns, using **documented first-party sharing endpoints** (invitation create / revoke / driver list / driver remove). Guest access is a Tesla-native vehicle-share invitation redeemed by the guest under their own Tesla account, whose subject the system stores only as an HMAC. Nothing retrieved prohibits *unattended* invocation of these endpoints; the constraints found are about **who owns the vehicle**, **what data is requested**, and **what is done with it** — and EVhost satisfies each on today's single-host facts.

Three cautions:

1. **"Owns each Licensee Vehicle" is the load-bearing clause and it is single-tenant-shaped.** It holds cleanly today. In a multi-tenant product it does not — EVhost would be acting on vehicles it does not own, on behalf of hosts, which is exactly the sublicense-in-writing scenario. **Out of scope here; a hard re-review trigger.**
2. **The guest is a Tesla end user, not just a data subject of yours.** Automated revocation terminates a Tesla-account relationship that the guest accepted. The existing consent architecture (unexpired private trip capability, Tesla subject proof, explicit consent before any location processing) is the right shape; keep it, and do not let the email-driven executor become a path that mutates guest access without a bound, consented trip.
3. **Rate limits and billing tier.** Fleet API usage is metered; the Workers plan tier is separately recorded as **UNDETERMINED** (rollout doc §4). Automation multiplies call volume; verify both before any gate flip. This is contractual/cost hygiene, not liability.

`revokeAccess()`'s fail-closed attribution (zero or multiple driver matches ⇒ `manual_review`, `services/onlyevs-worker/index.ts:471-483`) is the correct instinct and materially reduces the risk of removing the *wrong* driver. It does not reduce the risk of removing the *right* driver for the *wrong reason* — which is the failure mode that matters.

### (d) Guest PII and automated-decision exposure

**Scale and applicability.** A single Arizona host processing his own booking mail:

- **Arizona has no comprehensive consumer privacy statute** as of 2026 (multiple 2026 trackers; the closest attempt, HB 2790, died in committee in 2022). Arizona does have a **data-breach notification statute** (commonly cited as A.R.S. § 18-552 — *confirm with counsel*), which applies regardless of size and is the one Arizona obligation that plausibly bites: if the encrypted R2 store or the Postgres candidate rows were compromised, notification duties attach.
- **CCPA/CPRA does not apply.** Its thresholds — roughly $25M annual gross revenue, or buying/selling/sharing the PI of 100,000+ consumers or households, or ≥50% of revenue from selling/sharing PI (*confirm exact current figures*) — are not remotely met by a single-car-fleet host. Its **ADMT (automated decision-making technology) regulations** ride on the same applicability threshold and therefore also do not apply.
- **Colorado's regime does not reach this conduct.** SB 24-205 took effect June 30, 2026 and was repealed and replaced by SB 26-189, effective January 1, 2027. Both are scoped to "consequential decisions" in enumerated domains — education, employment, financial/lending, essential government services, healthcare, housing, insurance, legal services. **Short-term vehicle rental is not among them.** A deployer with fewer than 50 full-time employees also had conditional relief under the prior statute.
- **GDPR is unlikely but not automatically zero.** GDPR turns on establishment or on targeting the EU market, not on a data subject's passport. A US host renting in Arizona to a visiting EU tourist is generally not "offering goods or services to data subjects in the Union." **If EVhost ever markets to EU hosts or guests, this flips, and Article 22 (solely automated decisions producing legal or similarly significant effects) becomes live and directly relevant to exactly these gates.** That is a counsel question, not a research one.

**What actually matters at this scale, then, is not statutory compliance but hygiene**, and here the architecture is genuinely good: 30-day R2 lifecycle on raw MIME, hashes-and-audit-only in Postgres, workspace-scoped RLS, encrypted envelopes, HMAC-only Tesla subject storage, no service-role key in the web app, real `.eml` fixtures kept off git in a FileVault-encrypted local folder. Two gaps worth closing regardless of legal obligation: **(i)** a written retention period for `onlyevs_email_candidates` rows and audit rows (the 30-day lifecycle covers raw mail, not derived rows); **(ii)** a documented deletion path for a guest who asks — which, on today's facts, is a courtesy and a good-faith posture, and on tomorrow's multi-tenant facts becomes an obligation.

**The automated-decision framing, honestly.** No US statute currently makes "software decided this without a human" independently unlawful here. The exposure in §III(b) is common-law and contractual. Do not let the absence of an automated-decision statute be read as endorsement — the negligence analysis is *strengthened*, not weakened, by an operator having chosen to remove the human.

### (e) Other material items I judge worth flagging

1. **The sender-authentication blocker is spoofable in principle.** `dmarc !== "pass" && dkim !== "pass"` (parser line 73) means **either** signal passing clears the blocker, and `authResult()` never checks *whose* DKIM passed. An attacker who learns the alias address and sends a message DKIM-signed by their own domain, with a subject shaped like an allowlisted Turo template, clears `sender_auth_unverified` and `template_not_allowlisted` simultaneously. The alias is genuinely hard to guess (18 random bytes + HMAC tag), so this requires a **leak**, not a guess — a screenshot, a forwarding rule, a support ticket, a misdirected bounce. That is a realistic leak surface, and the consequence under `active_destructive` is an attacker-triggered lockout of a real guest. **Concrete fix, and a named condition below: require `dmarc = pass` AND a From/`d=` domain bound to `turo.com`/`mail.turo.com` before any candidate is auto-apply-eligible.** Turo's observed `p=REJECT` posture makes this cheap to enforce.
2. **`capability_name` is not bound to `action_type`** (migration lines 150-183). The gate you enable is not provably the blast radius you accepted.
3. **`brake_deadline` is not required on destructive actions** (line 182). The constraint forbids a brake on non-destructive actions; it does not require one on destructive actions.
4. **A stored `mode: "auto"` can pre-exist a gate flip.** Reset it to `review` in the database before any flag change, and require executor-time re-verification of `emailCapabilityEnabled()` rather than trusting the stored mode — the rollout doc already flags this; treat it as a precondition, not a to-do.
5. **The fingerprint's single input is the Subject header.** Two Turo templates sharing a subject shape collide into one allowlist entry; a forwarded or quoted message inherits it. Moving to `Notification-Name` + `Reservation-ID` is the right direction (rollout doc §6, line 130) — **and that doc correctly notes those headers must first be confirmed inside Turo's DKIM `h=` signed-header list, because an unsigned header can be forged without breaking DKIM.** Do not adopt them as fingerprint inputs before that verification.
6. **The prior sign-off already says what this memo says.** `docs/legal/2026-08-16-turo-tos-review.md`'s conditions expressly reserve counsel review "before any Auto capability ... for any workspace, including Alex's own." A YELLOW verdict here is a *risk* verdict; it does not retire that condition.

---

## IV. PER-GATE VERDICTS

| Gate | Verdict | One-line rationale |
|---|---|---|
| `ONLYEVS_EMAIL_AUTO_CREATE_ENABLED` | 🟡 **YELLOW** | Lowest-harm write; Turo exposure unchanged; blocked on executor, parse depth, and sender binding — not on doctrine. |
| `ONLYEVS_EMAIL_AUTO_PRETRIP_ENABLED` | 🟡 **YELLOW** | Same posture, greater conditions: evidence gate 1 is unmet for this event type and the access window moves. |
| `ONLYEVS_EMAIL_AUTO_ACTIVE_SAFE_ENABLED` | 🟡 **YELLOW** *(🔴 RED absent condition S-1)* | "Safe" is an unenforced label today; without a capability↔action binding this gate silently contains a destructive path. |
| `ONLYEVS_EMAIL_AUTO_ACTIVE_DESTRUCTIVE_ENABLED` | 🔴 **RED** | Brake unbuilt, unrequired by schema, and structurally mismatched to a one-person on-call. Real-person harm on the wrong side. Recommend permanent Review routing instead. |

### Gate 1 — `AUTO_CREATE` 🟡 YELLOW

*Enable within the stated scope once every condition is objectively true and recorded.*

- **C-1.1** Executor exists and **re-verifies `emailCapabilityEnabled()` at execution time**, never trusting the stored per-integration `mode`. Verified by a test that flips the env var mid-run and asserts no apply.
- **C-1.2** Stored `mode` for the workspace is reset to `review` in the database and the reset is recorded before any flag flip.
- **C-1.3** Parser emits exact reservation identity, start/end datetimes **with timezone**, vehicle identity, and guest identity, each with a per-field confidence or an explicit blocker code. Auto-create is refused unless every field resolves exactly.
- **C-1.4** Sender binding enforced: **`dmarc = pass` AND** From/DKIM `d=` aligned to `turo.com`/`mail.turo.com`. The current OR-semantics check (parser line 73) is replaced, with a unit test proving a foreign-domain DKIM-pass message is blocked.
- **C-1.5** `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS` contains the booking template (`ReservationBookedOwner`) only, approved from its ≥2 real samples (5 captured — gate 1 satisfied for this type), added by explicit human action, one entry.
- **C-1.6** **Shadow evaluation passed:** ≥7 consecutive calendar days **and** ≥5 live `booking_created` events, **100% agreement** with owner-reviewed fact, zero wrong-match, zero duplicate, zero mis-routed guest, no unresolved sev-1/2 ingest incident (rollout ladder rung 3). Recorded as a dated artifact, not a recollection.
- **C-1.7** **Guest-facing delivery stays human-initiated** through the first 10 auto-created trips. Auto-create may create the internal record and the link; a human presses send. (Also a practical necessity: the parser has no guest email address today.)
- **C-1.8** Documented retention period for `onlyevs_email_candidates` and audit rows, plus a written guest-deletion procedure.
- **C-1.9** Rollback drilled once end-to-end (§5 of the rollout doc) with the elapsed time recorded.

### Gate 2 — `AUTO_PRETRIP` 🟡 YELLOW

*All Gate 1 conditions, plus:*

- **C-2.1** Evidence gate 1 closed **for schedule changes**: ≥2 distinct real `.eml` samples, **from different guests/reservations**, for **each** sub-template in play — the host-approved `ApprovedChangeRequestBookedOwner`, the guest-initiated pre-approval request, and the Turo-initiated reschedule. Currently 2 samples, one guest, one sub-template. **Not close.**
- **C-2.2** Supersession/ordering drilled live: a newer revision arriving while an older pre-trip change is queued must supersede it, proven against `onlyevs_email_candidate_revision_idx` (migration line 137) with a recorded transcript.
- **C-2.3** Any pre-trip change that moves an access-grant boundary within **6 hours** of trip start or end routes to Review regardless of gate state (a time-proximity guard, enforced in code, unit-tested).
- **C-2.4** ≥14 consecutive days and ≥3 live schedule-change events at 100% concordance in shadow mode, on top of C-1.6.

### Gate 3 — `AUTO_ACTIVE_SAFE` 🟡 YELLOW — *RED until S-1 lands*

*All Gate 1 and Gate 2 conditions, plus:*

- **C-3.1 (S-1, structural — the gating one).** A **database CHECK constraint** binding `capability_name` to its permitted `action_type` set, such that `active_safe` can never carry `cancel_trip`, `rotate_guest`, `swap_vehicle`, or `revoke_access`. Verified by an SQL test asserting the insert is rejected. **Without this, treat Gate 3 as RED — enabling it enables an unbounded subset of Gate 4.**
- **C-3.2** An explicit, reviewed enumeration of which action types are "safe," written down, with the reasoning for each, signed by the principal.
- **C-3.3** A live drill: a genuine two-worker claim race on the same candidate resolves to exactly one apply (`FOR UPDATE SKIP LOCKED` plus the per-integration advisory lock), with a recorded transcript.
- **C-3.4** Any `active_safe` action that touches a Tesla access grant while a trip is live routes to Review regardless of gate state.

### Gate 4 — `AUTO_ACTIVE_DESTRUCTIVE` 🔴 RED

**Do not enable. Not now, and — as currently designed — not on a timetable.**

This is not a "conditions not yet met" verdict dressed up in red. The conditions the rollout doc sets (rung 7: brake drill, alert-failure drill, abort drill, supersession race, worker race, provider ambiguity) are all correct and all necessary. My judgment is that they are **not sufficient**, because the control they validate is mismatched to the operation:

1. **Zero operating history.** Review-only went live today. There is not one day of production evidence about how often the parser is wrong, in which direction, or on which templates. Enabling unattended destruction on top of a zero-length track record is unjustifiable on any risk framework.
2. **The brake is unbuilt and unrequired.** No executor drives `awaiting_owner_alert`; the schema permits a destructive row with `brake_deadline` NULL (line 182). Today's "brake" is a column.
3. **The mitigating control does not fit a one-person business.** A 30-minute human-veto window is a control designed for a staffed operation. Solo, its expected effectiveness across a 24-hour day is low, and its failure mode is the exact harm it exists to prevent.
4. **The harm is a real person, not a record.** Everything else on this list is a wrong row in a database. This one is someone locked out of a car at night, with a possible insurance-coverage question layered underneath.
5. **The trigger is precisely the least-verified input.** Cancellation has **one** real sample. It is also the template most attractive to forge, and the sender binding is not yet enforced (§III(e)(1)).

**Recommended alternative, which I believe is the correct permanent design for a single-operator business:** destructive candidates should route to Review with a **high-priority push alert** — the alert path the brake would have used — and require an affirmative human tap to execute. That preserves nearly all of the latency benefit (the human is alerted the moment the email lands, not at the next inbox check) while making the default **no action** instead of **act unless stopped**. For a solo operator, default-no is the only defensible default for an act that can strand a customer.

**If the principal nonetheless intends to revisit Gate 4, the entry conditions are:** all Gate 1-3 conditions closed; ≥90 days and ≥25 live destructive-class events observed in Review mode at 100% concordance; C-3.1's constraint extended so `brake_deadline` is **NOT NULL** for every destructive action type; all six rung-7 drills passed with recorded transcripts including an owner-alert **delivered-but-unread** case (not merely bounce/drop); a written answer from **Turo** and from **your insurer** on trip status and coverage when a host disables access mid-trip; and **review by a licensed Arizona attorney**, which the existing sign-off already requires and which this memo does not replace.

---

## V. SCOPE LIMITS

**In scope.** EVhost's single, own workspace; the principal's own Turo host mailbox; the principal's own Tesla account and owned fleet; Arizona operation; US guests; the four gates as implemented at commit `a756a89` on branch `codex/turo-email-ingestion`; recipient-side processing only, with zero interaction with turo.com.

**Expressly out of scope — no verdict here extends to any of it.**

- **Multi-tenant / other hosts.** Any enablement for a second workspace requires **fresh review from zero**. Three things break at once: Turo's ToS analysis changes character when a *third party's* software processes *another host's* mail commercially; Tesla's "Licensee owns each Licensee Vehicle" sublicense clause stops fitting; and EVhost acquires an independent controller-or-processor role for guest PII, with the DPA, notice, and deletion machinery that implies. The prior memo's open questions 1-5 are all live at that boundary.
- **Sending anything into Turo** — relay, messaging thread, or otherwise. Prior verdict: "Appears prohibited." Unchanged.
- **Ingesting Turo message-thread content** as distinct from transactional notification emails.
- **Guest telemetry or location processing** driven by email automation.
- **Any jurisdiction other than Arizona/US.**

**Triggers requiring re-review before proceeding.**

| Trigger | Why |
|---|---|
| Any second workspace, or any non-principal host | Every pillar of this analysis is single-tenant-shaped |
| First EU/UK-resident guest **whose data is processed**, or any EU-facing marketing | GDPR incl. Art. 22 (solely automated decisions) becomes live |
| Turo ToS revision after 2026-06-24 | Current text is unverified-fresh; both policy pages 403 to automated fetch |
| **Quarterly, by calendar** — manual human-browser check of Turo ToS, Turo Privacy Policy, and the Tesla Fleet API Agreement | Automated monitoring is blocked by design; this must be a diarized human task, not a cron job |
| Any change to the sender-auth check, fingerprint basis, or template allowlist policy | Those are the load-bearing safety controls |
| Turo publishing an official host API or webhook product | A sanctioned path would supersede email ingestion and moot most of §III(a) |
| Any move from lockout-class to immobilization-class capability | Different harm model entirely; different body of law |
| First real-world incident of any severity in the pipeline | Concordance evidence resets |

---

## VI. SIGN-OFF BLOCK

*The principal may adopt, amend, or reject this block. It has no effect unless adopted.*

```
EVHOST — AUTOMATION GATE RISK ACCEPTANCE
Document: AI legal-risk memorandum, Turo email automation gates

Reviewed by:      AI counsel analysis — Claude Opus 5 (claude-opus-5[1m])
                  Session: session_01EAG1xFj1JPLWiC3krq5oLD
                  NOT an attorney. NOT legal advice. NOT privileged.
Analysis date:    2026-08-16
Repo state:       branch codex/turo-email-ingestion @ a756a89
Adopted by:       Alex Alford, principal, EVhost
Adoption date:    ____________________

SCOPE OF THIS ACCEPTANCE
  Single tenant, own workspace only. Own Turo host mailbox only. Own Tesla
  account and owned fleet only. Arizona / US guests. Recipient-side email
  processing only; zero interaction with turo.com. Multi-tenant enablement,
  sending into Turo, and message-thread ingestion are OUT OF SCOPE and carry
  no verdict.

VERDICTS
  [ ] AUTO_CREATE .............. YELLOW  — enable only on C-1.1 … C-1.9
  [ ] AUTO_PRETRIP ............. YELLOW  — enable only on C-1.* + C-2.1 … C-2.4
  [ ] AUTO_ACTIVE_SAFE ......... YELLOW  — enable only on C-1.* + C-2.* + C-3.1 … C-3.4
                                          (RED, i.e. do not enable, until C-3.1 lands)
  [ ] AUTO_ACTIVE_DESTRUCTIVE .. RED     — REMAINS false. No conditions offered
                                          for near-term enablement. Recommended
                                          permanent alternative: destructive
                                          candidates route to Review with a
                                          high-priority push alert; default is
                                          NO ACTION, never act-unless-stopped.

CONDITIONS PRECEDENT — each must be objectively true and RECORDED (dated
artifact, not recollection) before the corresponding flag is flipped:

  AUTO_CREATE
    [ ] C-1.1 Executor re-verifies capability gate at execution time (tested)
    [ ] C-1.2 Stored integration mode reset to "review" before flip
    [ ] C-1.3 Exact reservation / TZ-aware datetimes / vehicle / guest resolution
    [ ] C-1.4 Sender binding: dmarc=pass AND From/DKIM d= aligned to turo.com
    [ ] C-1.5 Allowlist contains ReservationBookedOwner only, human-approved
    [ ] C-1.6 Shadow: >=7 consecutive days AND >=5 live booking events, 100%
              concordance, zero wrong-match/duplicate/mis-route, no open sev-1/2
    [ ] C-1.7 Guest-facing send stays human-initiated for first 10 auto-creates
    [ ] C-1.8 Written retention period + guest-deletion procedure
    [ ] C-1.9 Rollback drilled end-to-end, elapsed time recorded

  AUTO_PRETRIP (all of the above, plus)
    [ ] C-2.1 >=2 real samples from DIFFERENT guests for EACH schedule-change
              sub-template (approved-change, guest-initiated, Turo-initiated)
    [ ] C-2.2 Supersession/ordering drilled live, transcript recorded
    [ ] C-2.3 6-hour trip-boundary proximity guard enforced in code (tested)
    [ ] C-2.4 >=14 consecutive days AND >=3 live change events, 100% concordance

  AUTO_ACTIVE_SAFE (all of the above, plus)
    [ ] C-3.1 DB CHECK constraint binds capability_name -> permitted action_type
              (SQL test proves cancel_trip/revoke_access cannot be 'active_safe')
    [ ] C-3.2 Written, signed enumeration of "safe" action types
    [ ] C-3.3 Two-worker claim race drilled live, transcript recorded
    [ ] C-3.4 Any live-trip access-grant touch routes to Review regardless of gate

  AUTO_ACTIVE_DESTRUCTIVE
    NONE OFFERED. Flag remains false. Re-entry, if ever pursued, requires all
    of the above plus: >=90 days and >=25 live destructive-class events at 100%
    Review-mode concordance; brake_deadline NOT NULL enforced for destructive
    action types; all six rung-7 drills passed INCLUDING an owner-alert
    delivered-but-unread case; written answers from Turo and from the insurer
    on trip status and coverage when a host disables access mid-trip; and
    review by a licensed Arizona attorney.

STANDING CONDITIONS (independent of any gate)
    [ ] Quarterly manual human-browser re-read of Turo ToS, Turo Privacy Policy,
        and the Tesla Fleet API Agreement — automated monitoring is blocked
    [ ] Any re-review trigger in §V halts further enablement until reviewed

RISK ACCEPTANCE — read before signing
  I understand this memorandum was produced by an AI system, is not legal
  advice, was not reviewed by an attorney, and that its Turo ToS quotations
  are second-hand (Turo's policy pages block automated retrieval) and its
  Tesla terms citations are search-surfaced rather than verbatim-verified.
  I understand the prior sign-off at docs/legal/2026-08-16-turo-tos-review.md
  independently requires counsel review before ANY Auto capability is enabled
  for ANY workspace including my own, and that adopting this memorandum does
  not satisfy that requirement.
  I understand the worst realistic Turo consequence is account suspension or
  delisting — a business risk — and that the material legal exposure runs to
  GUESTS, not to Turo, principally through breach of the rental agreement and
  negligence if automation disables a guest's access to a vehicle they are
  lawfully renting.
  Adopting these verdicts is MY OWN risk acceptance, made in my own business
  judgment. Responsibility for any consequence of enabling any gate is mine
  alone and does not transfer to the analysis, its author, or this document.

Signature: ______________________________   Date: __________________
```

---

### Sources

**Repository (read-only, commit `a756a89`)** — `/Users/alex/Projects/tesla onboard`:
`lib/email/capabilities.ts` (gate semantics, lines 10-21) · `lib/email/turo-parser.ts` (blocker codes 71-74; subject-only fingerprint 31-59; bounded `proposedState` 79) · `services/email-ingest-worker/src/normalize.ts` (`authResult`, 27-29 — no `d=` binding) · `services/onlyevs-worker/email.ts:67` (unconditional `needs_review`) · `services/onlyevs-worker/index.ts:456-500` (`revokeAccess`, fail-closed driver attribution) · `lib/email/security.ts:29-49` (alias HMAC) · `lib/email/outbound-messages.ts:5` (`buildOwnerBrakeAlert`) · `supabase/migrations/20260816003000_onlyevs_email_ingestion.sql` (candidate states 117-119; actions table 146-183; `capability_name` 161; `brake_deadline` 164; brake constraint 182; 30-day retention 507) · `docs/legal/2026-08-16-turo-tos-review.md` · `docs/spikes/2026-08-16-turo-email-ingestion-go-no-go.md` · `docs/rollouts/2026-08-16-email-ingest-rollout.md` · `docs/runbooks/inbox-inbound-ingest.md`.

**External (retrieved 2026-08-16 in this session):**
[Turo Terms of Service](https://turo.com/us/en/policies/terms) — **HTTP 403 to direct fetch; quotations reproduced from the prior in-repo memo** · [Turo Cancellation policy](https://turo.com/us/en/policies/cancellation) — 403; fee figures **[secondary]** · [Turo Help Center — Canceling a trip with your guest](https://help.turo.com/en_us/canceling-a-trip-with-your-guest-HkkzLVlE5) · [Tesla Fleet API — Legal](https://developer.tesla.com/docs/fleet-api/getting-started/legal) — 403 **[secondary]** · [Tesla — Managing Access With Third-Party Apps](https://www.tesla.com/support/access-third-party-apps) — 403 **[secondary]** · [Akin — Colorado Postpones Implementation of Colorado AI Act, SB 24-205](https://www.akingump.com/en/insights/ai-law-and-regulation-tracker/colorado-postpones-implementation-of-colorado-ai-act-sb-24-205) · [Finnegan — Colorado Replaces Landmark AI Act: SB 26-189](https://www.finnegan.com/en/insights/articles/colorado-replaces-landmark-ai-act-an-overview-of-the-new-sb-26-189-framework.html) · [Colorado General Assembly — SB24-205](https://leg.colorado.gov/bills/sb24-205) · [Colorado General Assembly — SB26-189](https://leg.colorado.gov/bills/sb26-189) · [Termly — US Data Privacy Laws State Tracker 2026](https://termly.io/us-data-privacy-laws/) · [Securiti — Arizona Data Protection & Privacy Law](https://securiti.ai/privacy-laws/us/arizona/).

---

