# Turo Terms of Service Review — Email Ingestion & Automated Onboarding Messages

**Purpose:** Research memo to support Alex's sign-off on gate 4 of `docs/spikes/2026-08-16-turo-email-ingestion-go-no-go.md`. Alex is a Turo host running EVhost, initially processing his own host-notification emails, with an eye toward productizing this for other hosts later.

**Retrieved on:** 2026-08-16

**Sources consulted:**
- Turo Terms of Service — https://turo.com/us/en/policies/terms (page states "Last Revised: June 24, 2026")
- Turo Privacy Policy — https://turo.com/us/en/policies/privacy (page states "Last Revised: October 31, 2025")
- Turo Additional Policies (index) — https://turo.com/us/en/policies/additional-policies
- Turo Help Center — "Messaging your guest" — https://help.turo.com/en_us/messaging-your-guest-r1oqSNlV5

**Access method note:** `turo.com/us/en/policies/terms` and `turo.com/us/en/policies/additional-policies` returned HTTP 403 to direct automated fetch (likely bot-blocking on the edge/CDN). Content for those two pages was retrieved via a text-extraction proxy (`r.jina.ai`) fronting the same URLs, cross-checked against a second independent fetch of the Terms page for consistency (the "Prohibited activities" quotes below matched on both passes). The Privacy Policy and the Help Center article were fetched directly with no blocking. Where a claim below could not be pinned to a direct quote from these fetches, it is marked as **unverified** rather than presented as sourced.

---

## (a) Does anything prohibit or constrain a host running automated tooling over Turo notification emails the host himself receives (forwarding to own infrastructure, parsing, storing)?

**Verdict: Gray — likely permitted for the host's own notification emails as received in his own inbox, but the Terms' anti-scraping/anti-bot language is written broadly enough to create ambiguity, and it was not possible to confirm there is no narrower email-specific clause.**

What the Terms of Service ("Prohibited activities" section) say, verbatim:

> "Systematically retrieving data or other content from the Services to create or compile, directly or indirectly, a collection, compilation, database, directory, or the like, whether by manual methods, or through the use of bots, crawlers, spiders, or otherwise"

> "Attempting to probe, scan, or test the vulnerability of any of our system or network or breach any security or authentication measures"

> "Attempting to decipher, decompile, disassemble, or reverse engineer any of the software used to provide the Services"

**Reasoning:**
- These clauses are aimed at scraping/probing **the Services** (turo.com, the app, Turo's servers/APIs) — not at what a user does with an email Turo itself chooses to send to that user's own inbox. An email that already landed in Alex's own mailbox is not "retrieved from the Services" by bot/crawler/scraper in the ordinary sense of that clause; it's mail the host is simply reading, filtering, and forwarding the way any email client does.
- Parsing/forwarding your own received email to your own infrastructure is fundamentally different from scraping turo.com or calling undocumented Turo APIs. Nothing quoted above reaches "what you do with a message once it's in your inbox."
- However, the clause language is broad ("or otherwise") and untested against this specific fact pattern. No clause was found that explicitly blesses or forbids parsing one's own notification emails, and I could not fully verify the complete Terms document (see below) — so residual risk is that a stricter reading treats "the Services" as encompassing anything Turo transmits, including emails, and that Turo could construe automated parsing as circumventing intended access patterns.
- A stronger, unambiguous path (using the official host API/webhooks rather than emails) was not identified in what was retrieved — nothing in the fetched material referenced a public/partner API alternative for host notifications.

**What would change the answer:**
- Finding an explicit clause governing email/notification content specifically (not found in what was retrieved — see "not verified" below).
- Confirmation from Turo (support/partnerships) that email-based automation for a host's own bookings is acceptable, in writing.
- Any anti-automation clause that names "notifications," "emails," or "your account communications" specifically, which was not surfaced by the two independent fetches of the Terms page.

**Not fully verified:** The Terms of Service is a long, multi-section legal document. The 403 on direct fetch meant reliance on a proxy extraction; the full document was summarized rather than reproduced in total on the second pass. It is possible a clause bearing on this question exists elsewhere in the document (e.g., in an "acceptable use," "API," or "intellectual property/license to use content we send you" section) that this research did not surface. **This should be treated as incomplete review of the full document text, not a clean bill of health.**

---

## (b) Retention/deletion obligations for guest personal data contained in those emails; where GDPR/CCPA-style duties attach independent of Turo

**Verdict: Gray/appears permitted with obligations — Turo's own retention standard is need-based (no fixed period), but once EVhost/Alex holds guest personal data pulled from these emails, general data-protection law duties attach to Alex/EVhost directly, independent of anything Turo's policy says.**

Turo Privacy Policy, verbatim ("Last Revised: October 31, 2025"):

> "We retain personal information where we have an ongoing legitimate business need to do so (for example, to provide you with a service you have requested; to comply with applicable legal, tax, or accounting requirements; to establish or defend legal claims; or for fraud prevention)."

> "we may be unable to delete information needed to comply with applicable laws, detect or prevent fraud, collect any fees owed, resolve disputes, assist with or process claims, troubleshoot problems, assist with any audits and investigations"

On GDPR-style rights (Turo's own policy, applicable to Turo as a controller of the data it holds):

> "you may ask us to take the following actions in relation to your personal information that we hold: Access...Correct. Update or correct inaccuracies in your personal information. Delete. Delete your personal information. Transfer...Restrict. Restrict the processing of your personal information. Object."

On CCPA/CPRA (California), Turo's own policy:

> "You can request the following information about how we have collected and used your Personal Information: The categories of Personal Information that we have collected..."
> "You can request that we delete the Personal Information that we have collected from you."
> "we do not sell personal information to third parties and have not sold Personal Information during the twelve months preceding"

On what Turo discloses to hosts (the legal basis for Alex having guest data at all):

> "If you agree to a booking through the Services, we may provide your information to the other party in that transaction as reasonably necessary to facilitate the transaction including in some cases post-trip."
> "Turo may provide your mobile phone number to facilitate communication, your driver's license information to confirm license validity and for identity verification"

**Reasoning:**
- Turo's policy explains *Turo's* retention obligations as data controller for its own systems. It does **not** state, and I found no clause stating, retention/deletion duties that bind a **host** as a downstream recipient of guest personal data. The Privacy Policy is silent on what a host must do with guest PII once Turo has lawfully disclosed it "to facilitate the transaction."
- That gap does not mean no duties apply — it means the duties come from **general privacy law directly**, not from Turo's contract:
  - **GDPR** (if any EU/UK guest's data is involved, or if EVhost is offered to EU-based hosts/guests): once Alex/EVhost stores and processes guest personal data (name, email, phone, possibly driver's license/trip details) pulled from emails, Alex/EVhost is very likely a data controller (or processor, if acting purely on behalf of hosts) in its own right for that processing, independent of Turo's status as the original controller. That triggers lawful-basis, minimization, security, retention-limitation, and (if selling to other hosts) potentially controller-to-controller or controller-processor documentation obligations. This is a legal conclusion outside what a ToS review can settle — flagged as an open question for counsel.
  - **CCPA/CPRA** (California guests): similar analysis — if EVhost's processing meets CCPA's business/service-provider thresholds, independent obligations (notice, deletion-request handling, no unauthorized "sale"/"sharing" of the data) attach to EVhost regardless of what Turo's own policy promises guests.
- Practically, for a single host processing his own emails for his own trips, the immediate risk is low-volume, but the *legal characterization* (controller vs. processor, whether thresholds are met) doesn't change with volume — it's a "yes/no" duty, not a sliding scale, in most frameworks. This gates whether the productized multi-tenant version needs a privacy notice, retention policy, and deletion workflow of its own — which the go/no-go doc likely already anticipates (`features stay default-false`, `only Alex's own emails first`).

**What would change the answer:**
- Whether any guest is an EU/UK/California resident (triggers the specific regimes above).
- Whether EVhost's own retention window for parsed guest data is defined and short (reduces exposure) vs. indefinite.
- Counsel confirmation of EVhost's controller/processor role once this is offered to other hosts (this is explicitly flagged as needing legal, not research, judgment).

---

## (c) Constraints specific to guest MESSAGES (the anonymized relay) versus transactional notifications

**Verdict: Gray, and functionally likely moot for this project** — the "messages" clauses target host↔guest chat, not Turo's transactional/notification emails to the host, but the distinction matters for scope discipline.

Turo Terms of Service, verbatim ("Prohibited activities"):

> "harass, stalk, or defame any other Turo user"
> "use the Services to transmit...any information concerning any other person...without their permission" *(quoted fragment; full clause not independently reproduced beyond this extraction — treat as partial)*
> "Contact another Turo user for any purpose other than in relation to a booking, vehicle, listing, or the use of the Services by such user"

Turo Help Center, "Messaging your guest," verbatim:

> "Keep all communication between you and your guests in Turo messaging so our support agents have a record to settle any disputes."
> "Trip change agreements made in messaging only aren't valid, as we won't have a record of the change."
> "A guest can message you only after they've booked a trip in one of your vehicles."

**Reasoning:**
- The project in scope (per the go/no-go doc's framing) is ingesting **host-notification emails** (booking confirmations, trip alerts, etc.) — not the in-app anonymized guest-message thread itself. Nothing retrieved suggests notification emails and the messaging thread are the same data stream or governed by the same clause.
- The messaging-specific guidance ("keep communication in Turo messaging," record-of-dispute framing) is a **best-practice/support recommendation**, not a phrased prohibition on any specific automated behavior — it's advisory ("so our support agents have a record"), not an enforcement clause with automation language.
- No clause was found explicitly regulating automated *reading* of the message thread (as distinct from sending into it — see (d)). If a future iteration of this project were to parse or store the anonymized guest-message thread content (not just transactional emails), that would be a materially different, less-clearly-supported case than parsing booking/notification emails, and should get its own review pass before being built.
- One claim surfaced by a general web search ("Turo doesn't allow guests and hosts to communicate prior to a booking request") could **not** be confirmed as an exact quote from a primary Turo source in this session — it is dropped from any verdict above and flagged as **unverified**, not relied upon.

**What would change the answer:**
- If the productized feature later ingests message-thread content (not just notification emails), re-review specifically against messaging-thread rules, which were not the focus of what was retrieved here.

---

## (d) May automated/generated onboarding messages be SENT back through Turo's guest relay address? Anything on automation, spam, solicitation, or off-platform contact.

**Verdict: Appears prohibited (or at minimum, strongly discouraged) as currently scoped — do not build this without a separate, explicit review.**

Turo Terms of Service, verbatim ("Prohibited activities"):

> "Using the Services in connection with the distribution or posting of unsolicited commercial messages (e.g., spam)"

> "Contact another Turo user for any purpose other than in relation to a booking, vehicle, listing, or the use of the Services by such user"

> "Recruit or otherwise solicit any user to join third-party services or websites that are competitive to Turo, without our prior written approval"

**Reasoning:**
- The "contact ... for any purpose other than in relation to a booking, vehicle, listing, or the use of the Services" clause is broad enough to *arguably* cover trip-onboarding content (it does relate to "the booking"/"the vehicle"), but the message would be **automated/generated and sent through Turo's relay infrastructure using automation Turo did not build or sanction** — that combination is squarely adjacent to the spam clause and to the general prohibition on bots/automated tooling interacting with the Services (see (a) quotes: "through the use of bots, crawlers, spiders, or otherwise").
- Nothing retrieved from Turo's Terms, Privacy Policy, or the "Messaging your guest" help article affirmatively authorizes sending automated/bot-generated messages through Turo's own messaging surface — every reference to messaging (help article) frames it as a human-driven host action, including the one templating/scheduling feature Turo itself offers ("create message templates" and "schedule them at key points" via Turo's **own** first-party feature, linked from the help article) — which is notable: Turo already provides an *official, sanctioned* path for host-scheduled automated-looking messages (scheduled templates). That existing first-party feature is the closest thing to precedent found, and it argues for using Turo's own scheduled-message tooling (if it fits the need) rather than a self-built automation layer hitting the relay from EVhost's own infrastructure.
- Building a system where EVhost's server round-trips generated onboarding content back into Turo's guest-message relay (as opposed to a human host clicking "send" on templated copy inside Turo's own UI) is the highest-risk piece of this whole spike relative to the Terms language found.

**What would change the answer:**
- Using Turo's own first-party "scheduled messages" / templates feature (a human-configured, Turo-native automation) instead of an externally-triggered send through the relay — this looks like the sanctioned path, not a workaround.
- Written confirmation from Turo that a specific automated integration is acceptable.
- Scoping this to Alex's own account only, with him manually reviewing/sending each message (removing the "automated" character of the send itself), at least until Turo's position is confirmed.

---

## Open questions only Alex can answer

1. Will EVhost, even in its single-host phase, ever process a non-US (EU/UK) or California-resident guest's personal data? (Determines whether GDPR/CCPA independent-controller obligations bite immediately vs. later.)
2. What is EVhost's intended retention period for parsed guest PII (name, email, phone, trip dates) pulled from notification emails? Is there a deletion/expiry plan today?
3. Does Alex want to pursue Turo's first-party "scheduled messages" feature as the send path for onboarding content, instead of an EVhost-triggered automated send through the relay?
4. Has Alex (or should he) reach out to Turo directly (partnerships/support) to get written confirmation on email-parsing automation before productizing for other hosts — given this research could not fully verify the complete Terms document text?
5. When productizing for other hosts, will EVhost hold a data processing role (processor for hosts) or independent controller role for guest PII? This changes the DPA/consent obligations substantially and needs counsel, not just ToS reading.

## Framing

**This is a research memo, not legal advice.** It reflects a best-effort reading of Turo's publicly posted Terms of Service, Privacy Policy, and Help Center content as retrieved on 2026-08-16, via a mix of direct and proxied fetches (see access-method note above) because the Terms and Additional Policies pages blocked direct automated retrieval. Portions of the full Terms of Service text could not be independently confirmed beyond the "Prohibited activities" section reproduced above; treat this as a partial-document review. **This memo requires Alex's sign-off, and counsel review before any multi-tenant/other-host enablement of email ingestion or automated message-sending.**

## Sign-off block

- **Name:** ____________________
- **Date:** ____________________
- **Decision:** ☐ Approved to proceed (single-host, own-email scope only) ☐ Approved with conditions (list below) ☐ Not approved — needs counsel first ☐ Not approved — needs Turo written confirmation first

**Conditions / notes:**
