# Turo US Terms of Service — Capture for Legal-Evidence Purposes

## Metadata

- **Source URL (target document):** https://turo.com/us/en/policies/terms
- **Direct fetch status:** HTTP 403 (Cloudflare bot-block) on every direct attempt to turo.com/us/en/policies/terms; a browser-based challenge loops without resolving. Consistent with prior same-day finding in `docs/legal/2026-08-16-turo-tos-review.md`.
- **Retrieval method (successful):** Text-extraction proxy `r.jina.ai` (`https://r.jina.ai/https://turo.com/us/en/policies/terms`), fetched via the agent's `WebFetch` tool (not raw curl — see "Method notes" below for why curl to the same proxy was blocked).
- **Retrieval timestamp (UTC):** 2026-08-17T04:03:57Z (this capture session; original research doc `docs/legal/2026-08-16-turo-tos-review.md` was retrieved earlier the same US-Pacific day, 2026-08-16, via the same proxy)
- **Snapshot type:** Live-site capture via proxy (not an archival snapshot). No archival snapshot was obtainable this session — see "Fallback methods attempted" below — so there is no separate "snapshot date" distinct from the retrieval timestamp.
- **Document's own stated "Last Revised" date:** **June 24, 2026** (appears at the top of the document, confirmed identically in two independent fetch passes)
- **sha256 of the VERIFIED body text** (Introduction through the end of "Limitation of Liability and Waiver," i.e. the portion cross-confirmed by two independent fetches — see below): `391c3613874dce501776b0bbd2301ae69241c292a2e29abcabe64ac5e5be406a`
- **Byte count of the VERIFIED body text:** 93,776 bytes (as saved, UTF-8, Markdown)

## Two-source verification (agreement = strongest evidence)

Two **independent** fetches were made through the same proxy but via different underlying request paths:

1. Pass A: `https://r.jina.ai/https://turo.com/us/en/policies/terms`
2. Pass B: `https://r.jina.ai/http://turo.com/us/en/policies/terms` (http:// variant of the target, per task instructions)

A line-by-line, case-insensitive diff of the two passes over the shared region (Introduction through the sentence ending "...SHALL BE SEVERED WHILE LEAVING THE REMAINDER IN EFFECT.", i.e. through "Limitation of Liability and Waiver") found **zero substantive wording differences** — only cosmetic formatting variance (bold-markdown placement around section labels, a stray trailing space, and the Table of Contents being reproduced in full in Pass A vs. abbreviated to a bracketed note in Pass B). This is strong corroborating evidence that the text in that region is genuine, not model-paraphrased or hallucinated.

**This agreement does NOT extend to the whole document.** See "Critical caveat" below — the final ~10% of the document could not be reliably verified and is presented separately, clearly flagged, in an appendix.

## Critical caveat: the final section of the document is NOT reliably captured

`WebFetch` (the tool used here) works by fetching a URL, converting it to text/markdown, and then having a **small, fast summarization model** process that text against a prompt — it does not hand back verbatim page bytes. During this session, both fetch passes produced *mutually inconsistent* text for the document's final section (starting at the second "Indemnification" clause, under "General Provisions," through the end of the document): different indemnification wording, different subsequent section headings/counts, and — most tellingly — each pass ended with a short, obviously model-generated meta-commentary sentence that would never appear on an actual Turo legal page (e.g. "This is complete raw text content from the Turo Terms of Service page..." / "**Note:** This page contains complete Terms of Service as published by Turo. It is authentic legal content...").

A **third, targeted** fetch of the same URL, asking explicitly and only for that final section verbatim, returned a direct admission from the model that the underlying page content it had been given was **truncated mid-word** at exactly the same point both other passes started to diverge — mid-sentence in the first line of that final "Indemnification" clause ("...harmless from and against any cl" — cut off before "claims"). This confirms the truncation is a real ingestion-length limit inside the fetch/summarize pipeline, not a prompt-phrasing issue, and that **everything the model produced past that exact cut point in Pass A and Pass B was model-generated continuation, not sourced text** — i.e., likely fabricated/hallucinated, not evidence of Turo's actual terms.

**Consequence for this capture:** The document body below is trustworthy and cross-verified from the "Introduction" through the end of "Limitation of Liability and Waiver." Everything after that point (the final Indemnification clause, Entire Agreement/Notices, Severability/Waiver, and possibly Third Party Beneficiaries/Headings/No Agency/Survival subsections) is **NOT verified** and must not be relied upon as evidence of Turo's actual current terms. Both divergent candidate versions are preserved in Appendix A and Appendix B below, explicitly labeled UNVERIFIED, for reference only — pending a proper direct-browser capture of that final section.

## Fallback methods attempted (per task instructions, in order)

1. **r.jina.ai text-extraction proxy** — **Succeeded** via `WebFetch` (two independent passes, see above). **Failed** via direct `curl` to the same proxy URL (both http/https target variants) — curl received a Cloudflare "Just a moment..." JS-challenge page (HTTP 403), meaning Cloudflare is fingerprinting/blocking the curl client (or IP) even though it does not block WebFetch's own fetcher. No further circumvention was attempted (out of scope per task constraints).
2. **archive.today / archive.ph** — `https://archive.ph/newest/https://turo.com/us/en/policies/terms` returned an **archive.ph CAPTCHA wall** (HTTP 429 + CAPTCHA challenge page) to curl; `WebFetch` refused the domain outright ("unable to fetch from archive.ph"). No snapshot content was obtainable. Per task constraints (no WAF/CAPTCHA circumvention), this path was not pursued further.
3. **Wayback Machine** — Both `https://archive.org/wayback/available?url=...` (repeated retries, several minutes apart) and a direct fetch of `https://web.archive.org/web/2026/https://turo.com/us/en/policies/terms` failed. The `wayback/available` endpoint returned repeated `502 Bad Gateway`; the direct web.archive.org fetch returned an explicit **"Internet Archive: Temporarily Offline"** maintenance page (HTTP 503). This matches the task's note that Wayback was down earlier and confirms the outage was still ongoing at capture time. `WebFetch` also declined to fetch `web.archive.org` directly (tool-level restriction). No Wayback snapshot was obtainable this session.
4. **help.turo.com** — Reachable, but a targeted search (`site:help.turo.com "terms of service" full text`) surfaced only help articles that *reference* the Terms of Service (roadside assistance, monthly-trip terms, car-sharing agreement, etc.), not a mirror of the full document. No full-text ToS content exists on help.turo.com.
5. **Google/Bing cache** — Not directly queryable as a cache in this environment; targeted web searches for distinctive phrases expected in the document's disputed final section (e.g. `"Third Party Beneficiaries" "No Agency" "Survival"` and `"Headings" "No Agency" "Force Majeure" "Assignment"` alongside Turo) returned no indexed page text matching those clauses, so search-engine snippets could not corroborate or refute either candidate version of the unverified tail.
6. **Other curl-based proxies tried opportunistically** (not in the original instructions, tried in a good-faith attempt to get truly raw/unprocessed text and avoid the summarization-model risk): `api.allorigins.win` (HTTP 500, proxy-side error), `corsproxy.io` (HTTP 403). Neither succeeded.

## Staleness assessment

Not applicable in the archival sense — no archival snapshot was used; this is a live-site capture. The "Last Revised: June 24, 2026" date is the document's own self-reported freshness marker, confirmed identically across both independent passes, and is consistent with the same date recorded in `docs/legal/2026-08-16-turo-tos-review.md` from earlier research the same day. The one staleness-adjacent caveat is the unverified tail (see above) — its true current content is unknown, not stale.

---

## VERIFIED BODY TEXT (cross-confirmed, high confidence)

*Introduction through end of "Limitation of Liability and Waiver." Headings below follow Pass A's Title-Case rendering; Pass B rendered the same headings in sentence-case with no wording differences (see diff summary above).*

# Turo Terms of Service - Full Raw Text

**Last Revised: June 24, 2026**

PLEASE READ THESE TERMS OF SERVICE CAREFULLY. THEY CONTAIN IMPORTANT INFORMATION THAT AFFECTS YOUR RIGHTS, REMEDIES, AND OBLIGATIONS. THEY INCLUDE AN AGREEMENT TO ARBITRATE (UNLESS YOU OPT OUT). THESE TERMS ALSO INCLUDE A PROHIBITION OF CLASS AND REPRESENTATIVE ACTIONS AND NON-INDIVIDUALIZED RELIEF FOR ALL MATTERS IN EITHER COURT OR ARBITRATION, VARIOUS LIMITATIONS AND EXCLUSIONS, A CLAUSE THAT GOVERNS THE JURISDICTION, VENUE, AND GOVERNING LAW OF DISPUTES, EXCEPT WHERE PROHIBITED, AND OBLIGATIONS TO COMPLY WITH APPLICABLE LAWS AND REGULATIONS.

## Table of Contents
- Introduction
- Eligibility, registration, verification
- Fees, taxes
- Your commitments
- Content
- Prohibited activities
- Other legal matters
- Specific terms for guests
- Specific terms for hosts
- Dispute resolution
- General provisions

## Introduction

Turo Inc. ("Turo", "we", or "us"), provides an online car sharing platform that connects vehicle owners with travelers and locals seeking to book those vehicles. The Turo car sharing platform is accessible online including at turo.com and as an application for mobile devices. The Turo websites, blog, mobile applications, and associated services are collectively referred to as "the Services". By accessing or using the Services, including by communicating with us or other Turo users, you agree to comply with, and be legally bound by, the provisions of these Terms of Service (these "Terms"), whether or not you become a registered user of the Services. These Terms govern your access to and use of the Services and constitute a binding legal agreement between you and Turo.

These Terms, together with the cancellation policy, nondiscrimination policy, applicable insurance terms and certificates, roadside assistance terms, the additional policies, and all the policies referred to and/or linked herein (together, the "Policies") constitute the "Agreement" between you and Turo (each a "Party" and together, "the Parties"). In addition, Turo provides a Car Sharing Agreement that summarizes the terms of each reservation agreed between the host and guest at the time of booking and any modification, accessible in the Services for any booked or previous trips and you may use it as proof of a reservation. Turo acts as the intermediary for the transactions between the traveler or guest that books a vehicle on the Services ("guest") and the vehicle owner or host that lists a vehicle for booking on the Services ("host").

**Modification.** Turo reserves the right, at our sole discretion, to modify the Services or to modify the Agreement, including these Terms, at any time. If we modify these Terms, we will post the modification on the Services. We will also update the "Last Revised" date at the top of these Terms. If you continue to access or use the Services after we have posted a modification or have provided you with notice of a modification, you are indicating that you agree to be bound by the modified terms. If the modified terms are not acceptable to you, your sole recourse is to stop using and accessing the Services and close your Turo Account within 30 days. If you choose to close your Turo Account, the previous effective version of these Terms will apply to you, unless you use the Services during the intervening 30 day period, in which case the new version of these Terms will apply to you.

## Eligibility, Registration, Verification

### Eligibility

The Services are intended solely for guests who meet our eligibility requirements in the location where the vehicle is booked and hosts who are 21 or older, except in the United Kingdom and France where we permit hosts age 18 to list eligible vehicles. Any use of the Services by anyone that does not meet these eligibility requirements is expressly prohibited.

### Registration

To access certain features of the Services, you must sign up for an account with us (a "Turo Account"). You can create a Turo Account by providing us your first and last name, email address, mobile phone number, and creating a password or connecting through an account with a third-party site or service (including Apple and Google). When you book a vehicle as a guest, you provide us with certain additional information about yourself. Similarly, when you list a vehicle as a host, you provide us with certain additional information about yourself and your vehicle(s) (if applicable). You must provide accurate, current, and complete information during the registration, booking, and/or listing process. You must keep your Turo Account up to date at all times. Based on information you provide, Turo may impose additional requirements for you to book a trip or prior to a trip starting (e.g., providing a deposit, authorizing your payment method, adding a second form of payment, buying a certain level of protection or earnings plan, or other requirements).

### Verification

Where permitted, Turo has the right, but not the obligation, to undertake screenings, checks, and engage in processes designed to (1) help verify the identities or check the backgrounds of users, including driving history and driver's license validity and (2) verify vehicle details. Turo does not endorse any vehicle, user, or a user's background, or commit to undertake any specific screening process. Turo may in its sole discretion use third-party services to verify the information you provide to us and to obtain additional related information and corrections where applicable, and you hereby authorize Turo to request, receive, use, and store such information. Turo may permit or refuse your request to book or list a vehicle in its sole and absolute discretion. Turo may, but does not commit to, undertake efforts to ensure the safety of vehicles shared through the Services. We do not make any representations about, confirm, or endorse the safety, roadworthiness, or legal status of any vehicles shared via the Services. Rather, hosts have sole responsibility to ensure their vehicles are in safe and operable condition, legally registered to be driven on public roads, have a clean title (e.g., non-salvaged/non-branded/non-washed/non-written off), not subject to any applicable safety recalls, and otherwise satisfy our vehicle eligibility requirements.

**Consumer report authorization.** When you attempt to book or list a vehicle, or at any time after where Turo reasonably believes there may be an increased level of risk associated with your Turo Account, you hereby provide Turo with written instructions and authorize Turo, in accordance with the Fair Credit Reporting Act, applicable consumer reporting laws, or any similar laws to obtain your personal and/or business auto insurance score, credit report, and/or conduct a background check, including a criminal background check where permissible under applicable law.

## Fees, Taxes

### Fees

The fees we charge for using the Services and other cost structures will be itemized at checkout for guests. You can verify the amount for your trip at checkout before you submit your trip request. Hosts can view earnings on the Host Hub and learn more about earnings breakdown here. When you provide Turo a payment method, you authorize Turo, or third-party service providers acting on behalf of Turo, to store your payment credential for future use in the event you owe Turo any money. You authorize Turo to use stored payment credentials for balances, including for Trip costs, guest fees (e.g., late fees, security deposits, card authorizations, processing fees and claims costs, and related administrative fees). In some cases, our payment processors have arrangements with card networks to automatically update stored payment credentials whenever you receive a new card (e.g., replacing an expired card or one that was reported lost or stolen) and we will rely on such updates to stored payment credentials for balances. If we attempt to issue a refund and the original payment method is no longer on file or otherwise inaccessible, we reserve the right to issue travel credit in lieu of refunding to your original payment method. Any use of travel credit is governed by the terms and conditions outlined here. Turo may offer promotional codes from time to time which are subject to the terms of the offer and the conditions outlined here.

### Collection of Fees

Turo and its service providers will employ all legal methods available to collect amounts due, including the engagement of collection agencies or legal counsel. Turo, or the collection agencies we retain, may also report information about your Turo Account to credit bureaus. As a result, late payments, missed payments, or other defaults on your Turo Account may be reflected in your credit report. In addition to the amount due, delinquent accounts or chargebacks will be charged with fees and/or charges that are incidental to the collection of delinquent accounts or chargebacks including, but not limited to, collection fees, convenience fees, and/or other third party charges. If you wish to dispute the information Turo reported to a credit bureau (i.e., Experian, Equifax, or TransUnion), please contact turo.com/help. If you wish to dispute the information a collection agency reported to a credit bureau regarding your Turo Account, you must contact the collection agency directly.

### Taxes

In certain jurisdictions, Turo may enable the collection and remittance of certain taxes from or on behalf of guests or hosts (including, if applicable, Co-hosts), based on existing and future tax regulations, including marketplace facilitator or car sharing regulations. The amount of taxes, if any, collected and remitted by Turo will be visible to, and separately stated, to both guests and hosts (including, if applicable Co-hosts) on their respective trip related documents and invoices. Where Turo is facilitating the collection and remittance of taxes, hosts are not permitted to collect the same taxes on the Services in relation to their vehicle sharing in that jurisdiction. EU Council Directive 2021/514 (DAC7), Reporting Rules for Digital Platforms in Canada, and Sharing Economy Reporting Regime (SERR) in Australia require Turo to report unadjusted gross sales of hosts (what we call "gross earnings"), defined as transactions without adjustments for credits, service fees, reimbursements, or any other amounts. This is an annual reporting obligation (semi-annual in Australia) and Turo will share your data for all income and information for the previous reporting period. For any tax documentation Turo must provide hosts, you consent to electronic delivery.

## Your Commitments

You agree that you will always use your Turo Account and the Services in compliance with these Terms, applicable law, and any other policies and standards provided to you by Turo.

**Account Activity.** You are, and will be solely responsible for, all activity that occurs through your Turo Account. Keep your Turo Account information, including your password, secure. You agree that you will not disclose your password to any third party and that you will take sole responsibility for any activities or actions under your Turo Account, whether you have authorized such activities or actions. You will immediately notify Turo of any actual or suspected unauthorized use of your Turo Account. We are not responsible for your failure to comply with this clause, or for any delay in shutting down or protecting your Turo Account unless you have reported unauthorized access to us.

## Content

**Turo Content and User Content License.** Subject to your compliance with the provisions of these Terms, Turo grants you a limited, revocable, non-exclusive, non-transferable license, to access and view any Turo and/or user content to which you are permitted access, solely for your personal and non-commercial purposes. You have no right to sublicense the license rights granted in this section. No licenses or rights are granted to you by implication or otherwise under any intellectual property rights owned or controlled by Turo or its licensors, except for the licenses and rights expressly granted in these Terms.

**User Content.** We may, in our sole discretion, permit you to post, upload, publish, submit or transmit content through the Services such as photographs of you and your vehicle(s), reviews, feedback, and descriptions of you, your vehicle, or trip. By making available any content on or through the Services, or through Turo promotional campaigns, you grant Turo a worldwide, irrevocable, perpetual (or for the term of the protection), non-exclusive, transferable, royalty-free license, with the right to sublicense, to use, view, copy, adapt, modify, distribute, transfer, publicly display, publicly perform, transmit, stream, broadcast, access, view, and otherwise exploit such content on, through, by means of, or to promote or market the Services. Except as described above with respect to Turo photography provided to hosts, Turo does not claim any ownership rights in any such content and nothing in these Terms will be deemed to restrict any rights that you may have to use and exploit any such content.

**Copyright Protection.** We respond to notices of alleged copyright infringement and terminate Turo Accounts of repeat infringers according to the process set out in the US Digital Millennium Copyright Act and similar laws. If you think a user is violating your copyright(s) and want to notify us, you can find information about submitting notices here.

**Google terms.** Some areas of the Services implement Google Maps/Places mapping services, including Google Places API. In addition, to fight spam and abuse of the Services, Turo has implemented reCAPTCHA Enterprise, a Google service. By using the Services, you are bound by Google's Terms of Service.

## Prohibited Activities

In connection with your use of or access to the Services, you agree that you will not, nor advocate, encourage, request, or assist any third party to:

### Violate any law, including:

- Breach, violate, and/or circumvent any local, state, provincial/territorial, regional, or national law or other law or regulation, or any order of a court, including, without limitation, airport regulations and tax regulations, licensing or registration requirements, or third-party rights
- Post false, inaccurate, misleading, defamatory, or libelous content
- Infringe, reproduce, perform, display, distribute, reverse engineer, or prepare derivative works from content that belongs to or is licensed to Turo, or that comes from the Services and belongs to another Turo user or to a third party, including works covered by any copyrights, trademark, patent, or other intellectual property, privacy, publicity, moral, or contractual rights, except with prior express written permission of Turo

### Dilute, tarnish, or otherwise harm the Turo brand:

- Through unauthorized use of the Services and/or user content
- By registering and/or using "Turo" or derivative terms in domain names, trade names, trademarks, or otherwise
- By registering and/or using domain names, trade names, trademarks, social media account names, or other means of identification that closely imitate or are confusingly similar to Turo domains, trademarks, taglines, promotional campaigns, or Turo and/or user content

### Provide or submit any false or misleading information, including:

- False name, date of birth, driver's license details, payment method, insurance, or other personal information
- In relation to a claim (for example about damage to a vehicle)
- By registering for a Turo Account on behalf of an individual other than yourself or the company you represent
- Impersonating any person or entity, or falsifying or otherwise misrepresenting yourself or your affiliation with any person or entity

### Fail to honor your commitments, including:

- Fail to pay fees, penalties, or other amounts owed to Turo or another user
- Fail, as either a guest or host, to timely deliver, make available, or return any vehicle and optional Extras, unless you have a valid reason
- Use the Services to find a host or guest, and then complete a transaction partially or wholly independent of the Services, for any reason including but not limited to circumventing the obligation to pay any fees related to the provision of the Services by Turo (aka, gray market transactions, which do not necessarily require the exchange of money)
- Transfer your Turo Account and/or user ID to another party without our consent
- Leave a vehicle unlocked or running with the keys inside, except where instructed to do so directly by Turo in certain limited circumstances

### Harm or threaten to harm users of our community, including:

- Harass, stalk, or defame any other Turo user or collect or store any personally identifiable information about any other user other than for purposes of transacting as a host or guest in accordance with these Terms
- Engage in physically or verbally abusive or threatening conduct
- Use the Services to transmit, distribute, post, or submit any information concerning any other person or entity, including without limitation, photographs of others without their permission, personal contact information, payment method details, or account numbers
- Treat anyone differently based on the way they look, who they love, what they believe, how they self-identify, where they are from, or when they were born. Discrimination of any kind is not tolerated in the Turo community
- Sue or assert legal claims against Turo or a Turo user in any manner prohibited or waived by these Terms

### Use the Services for your own unrelated purposes, including to:

- Contact another Turo user for any purpose other than in relation to a booking, vehicle, listing, or the use of the Services by such user 
- Commercialize any content found on the Services or software associated with the Services, including reviews
- Harvest or otherwise collect information about users without their and our consent, including but not limited to conducting background checks
- Recruit or otherwise solicit any user to join third-party services or websites that are competitive to Turo, without our prior written approval

### Interfere with the operation of the Services, including by:

- Interfering with any other user's listings
- Using the Services in connection with the distribution or posting of unsolicited commercial messages (e.g., spam)
- Distributing viruses or any other technologies such as cancel bots, Trojan horses, harmful code, flood pings, denial-of-service attacks, backdoors, packet or IP spoofing, forged routing or e-mail address information, or similar methods or technology that may disrupt or interfere with the operation or provision of the Services, or harm Turo or the interests or property of others
- Bypassing robot exclusion headers, interfering with the working of the Services, or imposing an unreasonable or disproportionately large load on our infrastructure
- Systematically retrieving data or other content from the Services to create or compile, directly or indirectly, a collection, compilation, database, directory, or the like, whether by manual methods, or through the use of bots, crawlers, spiders, or otherwise
- Using, displaying, mirroring, or framing the Services or any individual element within the Services, the Turo name, any Turo trademark, logo, or other proprietary information, or the layout and design of any page or form contained on a page in the Services, without the express written consent of Turo
- Accessing, tampering with, or using non-public areas of the Services, our computer systems, or the technical delivery systems of our service providers
- Attempting to probe, scan, or test the vulnerability of any of our system or network or breach any security or authentication measures
- Avoiding, bypassing, removing, deactivating, impairing, descrambling, or otherwise circumventing any technological measure implemented by Turo or any of our service providers or any other third party (including another user) to protect the Services
- Forging any TCP/IP packet header or any part of the header information in any email or newsgroup posting, or in any way using the Services to send altered, deceptive, or false source-identifying information
- Attempting to decipher, decompile, disassemble, or reverse engineer any of the software used to provide the Services
- Endeavoring to circumvent a suspension, termination, or closure of your Turo Account or the account of another Turo user, including, but not limited to, creating a new Turo Account or listing vehicles affiliated with or registered to a Turo Account holder that has been suspended, terminated, or closed

## Other Legal Matters

**Violations.** Turo has the right, but not the obligation, to investigate, pursue, and seek to prosecute, litigate, or refer to law enforcement, violations of the Agreement to the fullest extent permissible by the law.

Turo reserves the right, at any time and without prior notice, in accordance with applicable law, to remove or disable access to any content that Turo, at its sole discretion, considers to be objectionable for any reason, in violation of these Terms, or otherwise harmful to the Services or our community. If we believe you are abusing Turo, our users, or any other person in any way or violating the letter or spirit of any of these Terms, we may, in our sole discretion and without limiting other remedies, limit, suspend, or terminate your Turo Account and access to the Services, remove hosted content, deny a damage claim, remove or demote your listings, reduce or eliminate any discounts, and take technical and/or legal steps to prevent you from using the Services. If your listings are priced artificially high compared to similar vehicles in the market area and/or priced unreasonably more than the recommended price provided by Turo; or, in France, if you have a higher cancellation rate than permitted under our policy, we reserve the right to restrict the listing or remove you from the Services. Additionally, we reserve the right to refuse or terminate access to the Services to anyone for any reason at our discretion to the full extent permitted under applicable law.

**Policy enforcement.** When an issue arises, we may consider the user's performance history and the specific circumstances in applying our Policies. We may choose to be more lenient with policy enforcement in an effort to do the right thing, subject to our sole and absolute discretion.

**Communications with you.** You agree that Turo may contact you by electronic means (e.g., electronic mail; notifications via Turo messaging; app notification) in lieu of any requirement for mailed notices. To contact you more efficiently, you agree that we may at times also contact you using autodialed or prerecorded message calls or text messages at your phone number(s). We will not place such calls for marketing purposes. Rather, we may only place such calls or texts to confirm your signup, provide notices regarding your Turo Account or Turo Account activity, investigate or prevent fraud, collect a debt owed to us or recover unpaid invoices, or communicate urgent messages. We may share your phone number(s) with service providers with whom we contract to assist us in pursuing these interests. We will not share your phone number(s) with third parties for their own purposes without your consent. You can cancel your SMS or text opt-in preference at any time by replying with "STOP". If you are experiencing issues with the messaging program you can reply with the keyword HELP for more assistance. As always, standard telephone minute and text and data charges may apply. Carriers are not liable for delayed or undelivered messages. Message frequency may vary. If you have any questions regarding privacy, please read our privacy policy. Where Turo is required to obtain your consent for such communications, you may choose to revoke your consent. You agree that Turo may contact you on any day, at any time of day, and in relation with the above purposes.

You authorize Turo and our service providers, without further notice, to monitor or record telephone conversations or web chat interactions you have, or anyone acting on your behalf has, with Turo or its agents for quality control, training, or other purposes. You understand and agree that your communications with Turo may be overheard, monitored, or recorded. If you do not wish to have your call recorded, please contact us instead in writing through turo.com/help. If you do not wish to have your chat activity recorded or monitored, please do not use the chat function on the Services.

**Insurance; and protection and earnings plans.** Turo is not an insurance company and does not insure hosts or guests. Host earnings plans (including host protection plans in France) and guest protection plans made available through the Services are in no way related. To be eligible for the benefits of a protection or earnings plan, hosts and guests must comply with these Terms. Protection plans and earnings plans are available through the Services only in the United States, the United Kingdom, Canada (excluding Manitoba, Nunavut, the Northwest Territories, and Saskatchewan), France, and Australia. Please refer to the specific terms for guests and specific terms for hosts sections below for additional information based on the nature of your use of the Services.

## Specific Terms for Guests

The following sections also apply if you book a vehicle using the Services:

### Guest Commitments

As a guest, you commit that you will be a legally licensed driver and provide proof to the host or via the Services of a current, valid driver's license. You will treat the vehicle and any applicable Extras well and will take all reasonable measures to return the vehicle and any applicable Extras on time and in essentially the same condition as received. You will not allow anyone other than a person listed in the trip details as an Approved Driver to drive the vehicle you booked.

### No Right of Withdrawal

For guests who are residents of the European Economic Area or the United Kingdom, there is no right of withdrawal in relation to a transaction you make on the Services as this right does not apply to the booking of transport or other services provided for at a specific date. Your only rights are described in the cancellation policy. However, guests have the right to modify any protection plan selected for a trip prior to the start of the reservation.

### Guest Financial Responsibility for Physical Damage to the Vehicle

The guest that booked the trip ("primary guest") is financially responsible for all physical damage to or theft of a booked vehicle that occurs during a trip, plus any additional costs and fees resulting from damage of any kind to the vehicle, regardless of who is found to be at fault. This responsibility applies whether the primary guest has their own auto insurance or not.

Primary guests may be insured against damage to the booked vehicle under their own automobile policies. When you book a vehicle on Turo, you agree that if any damage occurs to the booked vehicle during the booked trip, you will work with Turo to make a claim for coverage under any policy of insurance that applies to the loss.

The primary guest can limit the amount they are obligated to pay out of their own pocket in the event there is damage to the booked vehicle during the booked trip by choosing a protection plan on the Services. The limitation on the amount a primary guest may have to pay out of pocket included in any protection plan only applies (1) if the primary guest and any Approved Driver abide by these Terms and (2) to physical damage that is not mechanical or interior damage. The primary guest may change the protection plan selected by navigating to 'modify trip' in any reservation that has not started.

See additional incorporated terms for Guest protection plans in the US, the UK, Canada, France, and Australia.

### Auto Liability Insurance and Legal Liability Protection

Hosts offering a vehicle for sharing on the Services cannot offer you liability insurance. Trips originating in the US, the UK, France, and Canada, include coverage under an automobile liability insurance policy. In the US, the policy is issued to Turo by Travelers Excess and Surplus Lines Company and does not provide a defense or indemnification for any claim asserted by Turo. In the UK, this policy is arranged by Turo broker Lockton Companies LLP and purchased from ERS (Syndicate 218 at Lloyd's) managed by IQUW Syndicate Management Limited (registered number 204851). In France, the policy is arranged by Baloise Assurances Luxembourg S.A. (RCS Luxembourg B68065). In the Canadian provinces of Alberta, New Brunswick, Newfoundland and Labrador, Nova Scotia, Ontario, Prince Edward Island, and Quebec, this policy is purchased from Economical Insurance and in British Columbia, Insurance Corporation of British Columbia. Terms and exclusions apply. See additional incorporated terms about insurance in the US, the UK, France, and Canada.

For trips originating in Australia, Turo Australia Pty Ltd (ACN: 659 649 073; AR No.: 1300021) ("Turo Australia") offers protection plans to guests. The plans include legal liability protection provided by Turo Travels Mutual Limited ("the Mutual"). The Mutual is a discretionary mutual providing risk protection products. The Mutual issues and distributes its products via Picnic Licensing Pty Ltd (ACN: 647 642 117; AFSL: 532540). The Mutual is managed by Turo Travels Management Pty Ltd (ACN: 661 462 433; AR No.: 1300020) and the managing agent is Turo Australia. The Mutual provides financial risk products regulated under the Corporations Act 2001 (Cth) and the products are not insurance. For more information about the protection plans, the Mutual, or membership, please visit this page. Guest protection plan details for Australia are also described here.

If the guest has their own personal auto policy, it will be primary over the auto liability insurance or protection provided with each trip, depending on various factors such as applicable laws, where the guest books the vehicle, and/or where the accident or damages occur. If the guest is using the vehicle for professional use, the auto liability insurance or protection provided with each trip will be excess to any other personal or commercial policy.

### Use of the Vehicle

When you book a vehicle on the Services, you must use the vehicle only for your personal or professional use and not for any commercial purposes (e.g. those that require a commercial driver's license) unless you have express written permission from the Turo Legal Department in advance or as otherwise described here. You may not access a vehicle until the trip start time and you must return the vehicle on time and to the correct location. You must present the host with a current, valid driver's license. You must exercise reasonable care in your use of the vehicle. You are always required to operate the vehicle safely, and in compliance with all applicable laws, including without limitation, speed limits and prohibitions on impaired or distracted driving. In the event Turo has any concern about your use of a vehicle, Turo may terminate your trip in its discretion at any time and require the return of the vehicle, including recovering the vehicle on behalf of the host. You are required to wear seat belts during the operation of the vehicle and to require that all of your passengers wear seat belts. You are also required to meet any laws or regulations concerning child safety seats and other protections for children. You must not leave the car unlocked or with the keys unsecure (such as in the ignition). You must not engage in any prohibited uses with any vehicle you book through the Services. The prohibited uses list is not meant to be exhaustive. If you have any concerns about your planned use, please contact turo.com/help. If you misuse a vehicle, you will be fully financially responsible for any related claims, loss, or damage, and your protection plan may be voided. **Guests also acknowledge that using a vehicle in a prohibited manner or otherwise breaching the Agreement may lower available liability coverage to legal minimum limits, or nullify coverage, and may furthermore nullify any comprehensive or collision protection and/or protection plan where allowed by applicable law**.

**Telematics notice and release.** Vehicles booked on Turo may have features or an on-board device that may monitor the state of the vehicle from moment to moment, during a trip. The non-personal information collected by the features or on-board device may include, for example, a vehicle's condition; damage and accident records; performance, operation, and diagnostic data; and information on mileage, acceleration, velocity, fuel consumption, fuel level, tire pressure, odometer, location and direction, and other vehicle information ("Vehicle Data"). Use of the features or on-board device is subject to the terms and conditions posted by the vehicle manufacturer or technology provider, which may include system and service limitations, warranty exclusions, limitations of liability, wireless service provider terms, privacy practices, descriptions of use and sharing of information, and user responsibilities. Unless prohibited by law, you authorize the use or disclosure of or access to the Vehicle Data and you shall inform any Approved Driver and passengers of the terms of this section. You release the host and agree to indemnify, defend and hold harmless host, operator of the features or on-board devices, wireless carrier(s) and other suppliers of components or services and their respective employees, officers, directors and agents from any damage (including incidental and/or consequential damages) to persons (including without limitation you, an Approved Driver, and passengers) or property caused by failure of the features or on-board device to operate properly or otherwise arising from the use of the feature or on-board device by you, an Approved Driver, or passengers.

### Condition of the Vehicle and Optional Extras

You understand that third parties own the vehicles and Extras offered through the Services. Each host is responsible for complying with all legal requirements (including ensuring the vehicle is registered and insured) and maintaining their vehicle(s) in safe and roadworthy condition. Please complete a visual inspection before you begin your use of the vehicle. If you find damage in your initial inspection, you should upload photos of such pre-existing damage at the start of your reservation as described here to ensure you are not held responsible for pre-existing damage. If you find damage on your initial inspection and fail to report it, Turo, third-party administrators, or insurance partners, may assume that the damage occurred during your reservation period. If, after your initial inspection, you believe that the vehicle is not safe to drive, please do not use the vehicle; instead, please contact the Turo team immediately at 1-415-965-4525 in the US, +44 808 164 1454 in the United Kingdom, 888-391-0460 in Canada, +33-1-82-88-10-24 in France, or 1800 959 374 in Australia.

### No Responsibility for Shared Vehicles or Personal Belongings

You acknowledge that Turo is not responsible and shall not be liable for the safety, roadworthiness, or legal status (e.g., whether the vehicle is legally registered or the subject of a stolen vehicle report) of any vehicles shared via the Services. Rather, hosts have sole responsibility to ensure their vehicles are in safe and operable condition, legally registered to be driven on public roads, not subject to a missing or stolen vehicle report, have a clean title (e.g., non-salvaged/non-branded/non-washed/non-written off), not subject to any applicable safety recalls, and otherwise satisfy our vehicle eligibility requirements. You also acknowledge and agree that neither Turo nor hosts are responsible for lost or stolen property left in any vehicle or taken or damaged during a trip.

### Incident Reporting

You must immediately report any damage to the vehicle you are using to Turo here. In the US, the UK, and Australia, if there has been a collision, you must also make a report to the police. In Canada, if there has been a collision with significant vehicle damage (e.g., more than $2,000), you must also make a report to the police. In France, making a report to the police is not mandatory where the incident only involves vehicle damage and no personal injury, however you must complete an incident report in all cases. You will need to use all reasonable efforts to secure evidence from any available witnesses and to provide Turo or third-party claims administrators with a written description of the incident and any other information requested, including identity and insurance information of any parties involved in the incident. You are also required to cooperate in any loss investigation conducted by Turo, third party claims administrators, or insurers. After an incident involving anything more than minor vehicle damage (e.g., small dent or scratch), you may not continue to use the vehicle unless you have the explicit permission of Turo staff. Failure to timely report an incident or cooperate in an investigation may reduce or invalidate any protection plan received via the Services.

### Vehicle Theft

The following conduct may result in the reporting of the vehicle you have booked as stolen to law enforcement, possibly subjecting you and any other driver to arrest, and civil and/or criminal penalties, and the voiding of your protection plan:

- If you fail to return the vehicle you booked at the time and place agreed upon with the host and/or designated in your reservation
- If you do not return the vehicle by the end of the reservation period and you have not properly obtained an extension of the reservation through the Services as set forth here or you agreed to pay for your trip over time and the trip is shortened due to a payment method failure and you do not return the vehicle
- If the vehicle is returned to any place other than the return location on the reservation or agreed upon with the host. Any damage to, or loss or theft of, a vehicle occurring prior to the host inspecting the vehicle upon return at the end of the reservation is the guest's responsibility
- If you misrepresent facts to the host pertaining to booking, use, or operation of vehicle
- If the vehicle's interior components, and, in France, the mandatory safety equipment, are stolen or damaged, or the vehicle itself is stolen or damaged when the vehicle is left unlocked or running or unattended with the keys not secured during reservation period
- If you fail or refuse to communicate in good faith with the host, police, Turo, or other authorities with a full report of any accident or vandalism involving the vehicle or otherwise fail to cooperate in the investigation of any accident or vandalism
- If the vehicle is operated by anyone who has given a fictitious name, false address, or a false or invalid driver's license, whose driver's license becomes invalid during the reservation period, who has obtained the keys without permission of the host, or who misrepresents or withholds facts to/from the host or Turo material to the booking, use, or operation of vehicle

The primary guest who books the reservation is responsible for any private investigation costs Turo deems necessary to recover a vehicle that is not returned. In addition, a $500 case administration fee will be imposed on the primary guest if Turo and/or the host has to report a vehicle as stolen to law enforcement due to it not being returned.

**Repossession.** Turo, a hired agent of Turo, or the host may repossess any vehicle booked through the Services without demand, at the guest's expense, if the vehicle is not returned by the end of the reservation, is found illegally parked, apparently abandoned, or used in violation of applicable law or these Terms.

**Missing Vehicles.** If a vehicle you have booked through the Services goes missing and/or is stolen during the reservation period (or extension period), you must immediately return the original ignition key to the host, file a police report immediately after discovering the vehicle is missing or stolen, but in no event more than 12 hours after discovering it has gone missing, and cooperate fully with the host, law enforcement, Turo, and other authorities in all matters related to the investigation.

## Specific Terms for Hosts

The following sections also apply if you share your vehicle through the Services:

### Host Commitments

As a host, you commit that you will provide a safe and legally registered and insured vehicle, with current license plates, with a clean (non-salvage/branded/written off) title, and in good mechanical condition. You will provide such vehicle on time but only to a guest who is listed on the Services as an Approved Driver for the trip. Other than what is required for you to verify a guest's driver's license, you will not collect any information or documentation from your guest, including guest personal auto insurance. You agree not to use any guest information made available to you by using the Services to collect additional personal data about guest(s), including but not limited to conducting background checks. You commit that your listings will be complete and accurate and you will honor all representations made in your listings, including honoring the price quoted to a guest. In the event of a vehicle swap, you will not require a guest to accept a higher priced vehicle or force an unwanted vehicle upgrade. You will not cancel a booking for the purpose of seeking a higher price from a guest. You will not offer any vehicle or optional Extra that you do not yourself own or have authority to share or that may not be shared for compensation pursuant to the terms and conditions of any agreement with a third party, including, but not limited to, a lease or financing agreement. If your vehicle is subject to a lease, loan, or other financing agreement, you must confirm sharing your vehicle on Turo does not violate the terms of the contract with the lienholder. You will not offer any Extra that is not safe, clean, and acceptable for the use it is intended. You will not offer any vehicle that is the subject of a missing or stolen vehicle report. You will not offer any vehicle that is the subject of a safety recall without first properly addressing the matter subject to the recall. You will not offer a vehicle that is not roadworthy (i.e., not "street legal") in the location where it is shared, and it will not have any illegal modifications to any part of the vehicle. You will remove any firearms or other weapons from your vehicle prior to providing it to a guest. You will repay loans related to your Turo business on time and in full. When you direct Turo to retrieve your account information from third parties, including but not limited to toll agencies, you grant Turo a limited power of attorney to access the third-party services to retrieve such account information; Turo will be acting as your agent and will not be acting on behalf of the third party.

### Vehicle Information Given at Listing; Listing Conditions

When you sign up for Turo, you will identify passenger vehicle(s) that you want to list for sharing through the Services. Each vehicle must meet the requirements found here. You will provide the accurate license plate and vehicle identification number (VIN) (as required). You may only use the Services in connection with vehicles that you own or otherwise have all the necessary rights and permissions to share for compensation. If the vehicle you list on the Services is enabled with a device or OEM technology capable of determining location of the vehicle, collecting telematics data, disabling technology, or image capturing you agree to comply with the requirements for tracking and technology devices and applicable law.

The following criteria are used for 'relevance' ranking of search results: a guest's search parameters; vehicle location, details, price, delivery conditions, and relevance to a guest's search; your ratings and commitment rate; All-Star Host status; and the number of listings that meet the parameters of a guest's search. You cannot pay to have your listing rank higher and we do not offer sponsored listings.

### Turo Photography

Turo may offer hosts the option of having photographers take photographs of their vehicles and/or hosts with their vehicles ("Images"). You alone are responsible for using the Images in connection with your Turo listing and you agree that you will cease using the Images if they no longer accurately represent your vehicle. You agree that Turo is the sole and exclusive owner - or exclusive licensee, as allowed by applicable law - of all right, title, and interest in all copyrights, trademark rights, and any and all other intellectual property rights, including right of publicity, worldwide, in the Images regardless of whether you include them in your listing, and you shall take no action to challenge or object to the validity of such rights or Turo's ownership or registration thereof. You acknowledge that Turo may use the Images for advertising, marketing, commercial, and other business purposes in any media or platform, whether in relation to your listing or otherwise, without further notice or compensation. Further, you waive any and all rights to royalties or moral rights you may have in the Images. If you use the Turo photography program, you agree that you will not use the Images in connection with sharing your vehicle on any platform, website, or application other than Turo. At Turo's request, you will execute documents and take such further acts as Turo may reasonably request to assist Turo to acquire, perfect, and maintain its intellectual property rights and other legal protection in the Images.

### Vehicle Availability

Once a trip is booked, you must make the vehicle available or deliver the vehicle as expected by the guest. If you offer the guest the option to pick up your vehicle at a persistent specified location, you must supply the location of the vehicle accurately to Turo and ensure that the vehicle is available at that location at the beginning of the reservation period. In order to qualify for available host earnings plans, or host protection plans in France, you must verify that a prospective guest has a current, valid driver's license before you provide the guest your vehicle, and ensure the driver's license matches the name on the reservation and that the person picking up the vehicle appears to match the photograph on a facially valid driver's license. If you offer remote access to your vehicle you agree to comply with the requirements and guidance for technology for remote vehicle access.

### Pricing, Earnings, and Payments

You will have the ability to set and revise the vehicle's pricing as you choose. Turo will pay you the amount collected from guests that book your vehicle, less the applicable fees payable to Turo. A description of fees can be found here. To the extent you owe Turo or any third party lender money for any reason, Turo also reserves the right to deduct those amounts from your earnings payment, debit your bank account, charge any of your payment methods on file, and/or send you an invoice.

**Payment Processing.** In some countries, payment processing services are provided by Stripe and subject to the Stripe Connected Account Agreement, which includes the Stripe Services Agreement (collectively, the "Stripe Terms"). In countries where you receive payment proceeds via Stripe, you agree to be bound by the Stripe Terms, which may be modified from time to time. You also agree that Turo is not liable in cases where Stripe processes a payment late or makes a mistake relating to a payment or a payment hold. As a condition of Turo enabling payment processing services through Stripe, you authorize Turo to obtain all necessary access and perform all necessary activity on your Stripe Connected Account to facilitate sharing of your vehicle. You further agree to provide accurate, complete, and updated information about you to Turo and Stripe. You acknowledge that Turo and Stripe are unrelated entities. You are responsible for separately updating Turo and Stripe when there are material changes to the information you have previously provided (e.g., business name, tax information, contact information). You authorize Turo to share such information and transaction information with Stripe for the purposes of facilitating the payment processing services provided by Stripe. Turo reserves the right to switch payment processing vendors at its discretion.

### Airport Delivery; Personal Vehicle Sharing Regulations

Some airports where you offer delivery may take the position that you must have a permit to use airport premises and remit fees. While Turo does not believe that rental car permits should apply to peer-to-peer car sharing, not all airport authorities agree with this position. Learn more about airport delivery here.

There is personal vehicle sharing legislation that may apply to you. More information is available here.

### Maintenance

You are required to regularly check your vehicle for any defects in its operations or safety. You promise that, at all times, your vehicle will be in safe and roadworthy condition, in good mechanical condition, and in full compliance with all applicable inspection and registration requirements, including any required safety inspections. You will only list vehicles with a clean, non-salvaged, non-written off, non-washed, and non-branded title. You agree to respond to any applicable recall or similar safety notices and to complete any recommended action before allowing your vehicle to be booked. In addition, if Turo believes that your vehicle does not conform to reasonable standards, including maintenance standards, Turo may notify you and reserves the right to remove or decline listing your vehicle until its concerns have been resolved. Turo may, but does not commit to, undertake efforts to ensure the safety of vehicles booked through the Services. Learn more about our vehicle eligibility requirements here.

### Co-Hosting Tools and Hosting Teams

Co-hosting tools are a set of tools available through the Services that allow hosts to organize their Co-hosts into teams and enable Co-hosts to perform tasks for one or more vehicles. "**Co-host**" is anyone a host works with to manage their vehicles, including friends, family members, employees, or other Turo hosts and "**Co-hosting services**" means the support and assistance provided by Co-hosts on a host's behalf.

**Hosting teams permissions.** By adding a Co-host to a hosting team, you represent and warrant that each such Co-host is authorized by you to act on your behalf and bind you, consistent with the level of permission granted in the co-hosting tools. You are responsible for the permissions you set for each Co-host and the authority you grant them in using the co-hosting tools for a vehicle listing.

**Obligations of hosts and Co-hosts.** You are responsible for your own acts or failures to act. To the maximum extent possible under applicable law, you are responsible for the acts and failures to act of your Co-hosts when acting as service providers to you. You are responsible for complying with laws, rules, and regulations that apply to the Co-hosting services. These may require you to obtain a permit or license before providing services or may classify a Co-host as an employee of a host. In no cases, are hosts or Co-hosts employees of Turo. You represent and warrant that you and those who work with you have all necessary permits, licenses, and/or insurance required.

**Relationship of hosts and Co-hosts.** Any agreement between a host and Co-host does not create an employment, agency, or other service relationship between Turo and any host or Co-host. A host and Co-host cannot create an agreement that conflicts with the Agreement or expands Turo's obligations or restricts Turo's rights under the Agreement. Turo has no control over your conduct and is not obligated to mediate disputes between hosts and Co-hosts or among Co-hosts. Any liability arising from or related to any agreement between hosts and Co-hosts is disclaimed by Turo to the maximum extent permitted by law.

**Termination of Co-hosting services; effect.** Hosts may remove any Co-host from a hosting team at any time. Co-hosts may remove themselves from a hosting team at any time. Turo may remove any Co-host from a host team or terminate access to the Co-hosting services if you fail to deliver to Turo, on request, up to date mandatory documentation relating to your relationship with Co-hosts, including social security or tax declarations. Upon removal of a Co-host, you remain responsible for all actions performed by the Co-host prior to removal.

### Reporting Vehicle Damage

If you did not decline a host earnings plan, or host protection plan in France, made available via the Services, and you believe that a guest has caused any damage to your vehicle, you are required to report that damage as soon as you become aware of it (and in any event, no more than 24 hours after the scheduled end of the trip) and to provide reasonable cooperation in the investigation of the damage so that it can be eligible for coverage. Follow the process for reporting damage described here. Based on the investigation, Turo or third-party claims administrators will reasonably determine whether the damage occurred during the reservation period and is eligible for coverage. If it was, and you did not decline a host earnings plan, or host protection plan in France, made available via the Services, you will be reimbursed for the loss as described in the sections below. If Turo is not given prompt notice as described in this paragraph, or if you do not provide reasonable cooperation in the investigation by Turo or third-party claims administrators, we may not be able to determine the cause. In that case, you agree that we may decline any reimbursement or coverage for such damage. In the US and Canada, if additional damage is discovered during repairs, you must follow the process to request supplemental payment described here.

### Auto Liability Insurance and Legal Liability Protection

For trips originating in the US, the UK, France, and Canada, hosts are covered under a third-party automobile liability insurance policy. In the US, the policy is issued to Turo by Travelers Excess and Surplus Lines Company and does not provide a defense or indemnification for any claim asserted by Turo. In the UK, the policy is from ERS (Syndicate 218 at Lloyd's) managed by IQUW Syndicate Management Limited (registered number 204851), arranged by Lockton Companies LLP. In France, the policy is from Baloise Assurances Luxembourg S.A. (RCS Luxembourg B68065). In the Canadian provinces of Alberta, New Brunswick, Newfoundland and Labrador, Nova Scotia, Ontario, Prince Edward Island, and Quebec, the policy is from Economical Insurance and in British Columbia the policy is from Insurance Corporation of British Columbia.

For trips originating in Australia, Turo Australia Pty Ltd (ACN: 659 649 073; AR No.: 1300021) ("Turo Australia") offers earnings plans to hosts. The plans include legal liability protection provided by Turo Travels Mutual Limited ("the Mutual"). The Mutual is a discretionary mutual providing risk protection products. The Mutual issues and distributes its products via Picnic Licensing Pty Ltd (ACN: 647 642 117; AFSL: 532540). The Mutual is managed by Turo Travels Management Pty Ltd (ACN: 661 462 433; AR No.: 1300020) and the managing agent is Turo Australia. The Mutual provides financial risk products regulated under the Corporations Act 2001 (Cth) and the products are not insurance. For more information about the protection plans, earnings plans, the Mutual, or membership, please visit this page. Learn more about Australia earnings plans for hosts here.

### Physical Damage to Your Vehicle

**Physical damage reimbursement (US and UK).** The earnings plans available to hosts in the US and the UK address the allocation of financial consequences of physical damage to the vehicle offered by a host during a trip. Physical damage contractual reimbursement from Turo applies to your vehicle in the event of a collision and comprehensive events during the trip, and is subject to terms and exclusions. See additional incorporated terms for US host earnings plans here and UK host earnings plans here.

**Physical damage protection (Canada and France).** The earnings plans available to hosts in Canada address protection for physical damage to your vehicle in the event of a collision and comprehensive events during the trip, subject to terms and exclusions. See additional incorporated terms for Canada host earnings plans here and France protection plans here.

**Vehicle damage protection (Australia).** The earnings plans offered by Turo Australia to hosts in Australia also offer protection for damage to your vehicle, provided by the Mutual, a discretionary mutual providing risk protection products. The Mutual issues and distributes its products via Picnic Licensing Pty Ltd (ACN: 647 642 117; AFSL: 532540). The Mutual is managed by Turo Travels Management Pty Ltd (ACN: 661 462 433; AR No.: 1300020) and the managing agent is Turo Australia. The Mutual provides financial risk products regulated under the Corporations Act 2001 (Cth) and the products are not insurance. For more information about the earnings plans, the Mutual, or membership, please visit this page. Learn more about Australia earnings plans for hosts here.

**Physical damage payments; no obligation to lienholders.** If you do not own your vehicle outright, for example, because you are a co-host, otherwise authorized to list the vehicle on the Turo platform, or your vehicle is subject to a lien, Turo will make any physical damage reimbursement under the earnings plans, including total loss payments, to you as the registered host on the Turo platform. Turo has no obligation to investigate vehicle ownership or the existence of any lien, and Turo assumes no obligation to any third party, including any lienholder or co-owner, in connection with any payment. Notwithstanding the foregoing, Turo reserves the right, in its sole discretion, to direct all or any portion of a payment to a lienholder or co-owner in lieu of or in addition to payment to you, and any such redirection will not increase Turo's total payment obligation. Any payment made under this section, whether to you or to any lienholder or co-owner at Turo's election, will fully satisfy Turo's obligations under the earnings plan.

**Actual cash value.** If Turo, or third-party claims administrators, choose to pay you the actual cash value for your vehicle, you will be required to do one of the following at the sole discretion of Turo as a condition for receiving payment: (1) transfer title to the vehicle, and, if requested, physically deliver the vehicle to Turo or a third party appointed by Turo to accept title and physical delivery (if applicable); or (2) retain title to the vehicle and accept a reduction of the actual cash value equal to the salvage value of the damaged vehicle based on the highest third-party salvage quote that Turo obtains for the vehicle. The standard for determining the actual cash value will be as determined by Turo or its third-party claims administrators and in compliance with applicable law. For any vehicle parts that Turo pays to be replaced, you agree as a condition of payment to give Turo possession of the damage or replaced part(s).

**Exclusions to physical damage reimbursement and coverage.** Earnings plans selected by hosts on the Services (including host protection plans in France) do not apply to:

- Optional extras or personal property, including aftermarket installations (e.g., equipment racks), that are taken from your vehicle or damaged during a trip. Remove all personal property before making your vehicle available for a reservation
- Normal wear and tear to your vehicle

If you violate the Agreement, these Terms, or any of our Policies or if you submit inaccurate information about your vehicle when listing it on the Services (for example, falsely represent the make, model, or year of the vehicle), **any earnings plan (or host protection plan in France) you selected will be voided**. An earnings plan (or host protection plan in France) will be voided under this provision even if the underlying circumstances are not directly related to the damage or harm at issue. You acknowledge that these provisions are material and that they serve to ensure your compliance. In the event your earnings plan (or host protection plan in France) is voided, the remainder of the Agreement, these Terms, and Policies remain in effect.

**Other host-specific insurance matters.** You will maintain valid and up to date registration information and proof of insurance in any vehicle you share on the Services. You must maintain your own auto insurance policy for any vehicle you list on the Services and such policy must meet any minimum insurance levels required by law. You may need additional insurance coverage, including physical damage coverage, if you share a vehicle subject to a lease or loan. You agree to provide Turo with information regarding your auto insurance policy as may be requested and to keep such information up to date. Where not prohibited by law, you hereby appoint Turo or a wholly owned subsidiary of Turo as your attorney-in-fact for the purpose of filing insurance claims, receiving insurance payment, otherwise administering an applicable insurance policy, and/or working with law enforcement, guests, or private entities to recover your vehicle, as necessary.

### Missing Vehicles

If you selected an earnings plan (or host protection plan in France) via the Services and your vehicle goes missing, is not returned, and/or is stolen during the reservation period (or extension period), you, as the host, must immediately contact a Turo representative and follow his or her instructions, including cooperating with Turo, the police, and any other authorities in all related to the investigation of the theft. If you are instructed by Turo to file a police report, you must do so within 24 hours of receiving those instructions.

### Additional Provisions Applicable in Quebec

Each host in Quebec grants Turo the right to use and enjoy the vehicle, solely during the sharing period, subject to Turo's obligations to the host to preserve the substance of the vehicle pursuant to this Agreement. Each host in Quebec agrees that Turo's obligation to preserve the substance of his or her vehicle is fulfilled by Turo obtaining commercial automobile insurance coverage, the terms, limitations, and exclusions of which are set out in the standard form automobile policy applicable in the province of Quebec (Q.P.F. no. 1).

### Indemnification of Host

If you selected an earnings plan (or host protection plan in France) via the Services, in the event of any claim for a loss or injury that occurs during the use of your vehicle by a guest (or by Turo itself), subject to your compliance with these Terms and the Policies, Turo or its insurers will defend and indemnify you, subject to any exclusions or limitations in the policy or policies of insurance contained with the earnings plan (or host protection plan in France), against such claims as required by applicable law. In connection with any indemnified claim, you are required to give Turo or its insurers prompt written notice of the claim, allow Turo sole control over the defense of the claim, and provide Turo reasonable cooperation in its defense of the claim, at Turo's expense. If Turo or its insurers reimburses you for a lost or damaged vehicle and you later receive payment for some or all of your vehicle from a third party (e.g. a third party insurance company or restitution), you must reimburse Turo any monies received from that third party in an amount equivalent to, but not to exceed, the funds provided to you by Turo.

## Dispute Resolution

### Dispute Resolution for Hosts and Guests Residing in the United States

PLEASE READ THIS SECTION CAREFULLY. IT CONTAINS A MANDATORY ARBITRATION PROVISION AND THEREFORE AFFECTS YOUR RIGHTS AND GOVERNS HOW CLAIMS YOU AND TURO HAVE AGAINST EACH OTHER ARE RESOLVED.

**Subject to applicable law, the Parties agree that any disputes or claims between us relating in any way to, or arising out of, this or previous versions of these Terms, your use of or access to the Services, or any breach, enforcement, or termination of the Agreement will be resolved in accordance with the provisions set forth in this Dispute resolution for hosts and guests residing in the United States section.**

**Pre-arbitration dispute resolution.** Should a dispute or claim arise between us, you and Turo agree to notify the other Party of the nature of the dispute or claim prior to initiating arbitration, and the Parties will attempt to negotiate an informal resolution to it first. We will contact you at the email address you have provided to us; you should contact us by email at noticeofdispute@turo.com. Please provide your name, phone number, email, mailing address, and briefly describe both the nature of your dispute and the relief you would like from Turo. If the Parties are unable to resolve the claims described in the notice within 30 days after the notice is sent, then the Party intending to pursue arbitration agrees to notify the other Party via email prior to initiating the arbitration. The arbitration procedures are set forth below. In order to initiate arbitration, a claim must be filed with New Era ADR ("New Era") as set forth below. In the event New Era declines to or is unable to adjudicate the claim, then the arbitration will be conducted by the American Arbitration Association ("AAA") as set forth below.

**Applicable law for arbitration.** The below Agreement to Arbitrate evidences a transaction involving interstate commerce and is therefore governed by the Federal Arbitration Act and the applicable arbitration and procedural rules of New Era (or the AAA, if New Era declines to or is unable to adjudicate the claim). (See "Arbitration procedures" below). To the extent state substantive law is applicable to the Agreement to Arbitrate, the Parties agree that the substantive law of the state of Arizona will apply, without regard to its conflict of law provisions.

**Agreement to Arbitrate.** The Parties each agree that any and all disputes, claims, or controversies that have arisen or may arise at any time between you and Turo (including its respective subsidiaries, employees, officers, directors, agents, third-party insurance brokers or products, and third-party claims administrators) and/or any other Turo user will be resolved by binding arbitration according to the procedure set forth below. For the purpose of this Agreement to Arbitrate, "disputes," "claims," and "controversies" shall have the broadest possible meaning that will be enforced and includes, any and all disputes and/or claims that arise out of or in any way relate to your relationship with Turo, including but not limited to: (1) your use of or access to the Services, (2) the Agreement, these Terms and/or this Agreement to Arbitrate, including the interpretation, validity, enforceability, or scope of this Agreement to Arbitrate, or (3) anything sold, offered, or purchased through the Services (such as booking, listing, or sharing a vehicle). Through this Agreement to Arbitrate, and subject to the below exceptions, the Parties intend to arbitrate all disputes or claims regardless of whether they are based in contract, statute, regulation, ordinance, tort (including, but not limited to, fraud, misrepresentation, fraudulent inducement, or negligence), or any other legal or equitable theory and regardless of whether they arose or accrued before the Parties entered into this Agreement to Arbitrate. For avoidance of doubt, the Parties expressly agree that this Agreement to Arbitrate encompasses all disputes or claims pertaining to the validity, enforceability, or scope of this Agreement to Arbitrate and any such disputes or claims will be referred to binding arbitration and will be resolved by the arbitrator and not a court.

**Exceptions to Agreement to Arbitrate.** The only exceptions to this Agreement to Arbitrate are as follows:

- Disputes or claims that can be brought in small claims court
- Injunctive or equitable relief to prevent the actual or threatened infringement, misappropriation, or violation of a Party's copyrights, trademarks, trade secrets, patents, or other intellectual property rights.
- Any cause of action or claim for relief which cannot be arbitrated as a matter of applicable statute or public policy. However, the Parties agree that any such court proceedings shall be stayed pending the final resolution in arbitration of any arbitrable claims or issues
- In the event California law is found to apply to this Agreement to Arbitrate, any remedy of public injunctive relief (i.e., injunctive relief that has the primary purpose and effect of prohibiting unlawful acts that threaten future injury to the general public). However, the Parties agree that any such court proceedings shall be stayed pending the final resolution in arbitration of arbitrable claims, causes of action, or issues

**Arbitration procedures.** Arbitration is more informal than a lawsuit in court. Arbitration uses a neutral arbitrator instead of a judge or jury, and court review of an arbitration award is very limited. An arbitrator can award the same damages and relief on an individual basis that a court can award to an individual. The arbitration will be administered by New Era. For demands not exceeding $200,000, New Era's Abridged Rules will apply. A form initiating arbitration proceedings is available on New Era's website (please create an account, click "Start New Case," and the platform will then lead you through the process of filing a claim). In the event New Era declines to or is unable to adjudicate the claim, the arbitration will be conducted by the AAA. The AAA Commercial Rules, Expedited Procedures (E1-E10) will apply to hosts subject to the modifications that follow. The AAA Consumer Rules will apply to guests, subject to the modifications that follow. A form for initiating arbitration proceedings is available on the AAA's website (the AAA provides a Demand for Arbitration form).

**Modifications to the AAA's Consumer Rules and Commercial Rules, Expedited Procedures, For Demands Not Exceeding $200,000**

- **Documents Only Submission.** You and Turo agree that where the relief sought is $200,000 or less (not including attorneys' fees and expenses), the proceeding will be a document-only "desk arbitration" and will be conducted pursuant to the Procedures for the Resolution of Disputes through Document Submission (Rules D1-D3) where the Consumer Rules apply and pursuant to Rule E-6 where the Commercial Rules apply. The parties agree to waive all hearings, including a preliminary hearing, and will instead submit their written evidentiary submission to the arbitrator pursuant to the "Timing of Evidentiary Submission" paragraph below.

- **Exchange of Information.** The parties agree that the only exchange of information permitted is the exchange of information set forth in Consumer Rule 20(b) if proceeding under the Consumer Rules and Expedited Commercial Rule E-5 if proceeding under the Expedited Commercial Rules.

- **Single Arbitrator.** Regardless of whether proceeding under the Consumer Rules or the Commercial Expedited Rules, the arbitration will proceed before a single arbitrator that will be administratively appointed by the AAA.

- **Timing of Evidentiary Submission.** The parties agree to waive a preliminary hearing and make their evidentiary submissions pursuant to the following schedule: Within 14 days of confirmation of appointment of the arbitrator, the claimant will submit its written statement (capped at 10 pages) and any supporting evidence. Then 14 days later, the respondent will submit its written statement (capped at 10 pages) and any supporting evidence.

- **Arbitrator Discretion.** The arbitrator has discretion to deviate from the applicable rules and these modifications where necessary if the Consumer Rules apply, and for good cause shown if the Commercial Rules apply.

In all cases in which a live hearing is requested or required, you and/or Turo may attend by video or phone. To the extent a location must be established for the arbitration, it shall be held in the county in which you reside or at another mutually agreed location.

The arbitrator will decide the substance of all claims in accordance with applicable law, including recognized principles of equity, and will honor all claims of privilege recognized by law. The arbitrator shall not be bound by rulings in prior arbitrations involving different users. The arbitrator's award shall be final and binding and judgment on the award rendered by the arbitrator may be entered in any court having jurisdiction thereof.

Where permitted, the Parties agree that all communications, evidence, and rulings in the arbitration will remain confidential, except as reasonably necessary to enforce or implement such rulings or this Agreement to Arbitrate. Any settlement offer made by you or Turo shall not be disclosed to the arbitrator.

**Costs of arbitration.** If you initiate arbitration proceedings, then you will be responsible for certain fees and costs. For arbitrations administered by New Era with demands not exceeding $200,000, you and Turo will split the $800 filing fee by paying $400 each, subject to New Era's fee waiver provisions in Section 2(h) of its Rules and Procedures. For arbitrations administered by New Era with demands exceeding $200,000, New Era's Fee Schedule applies. For arbitrations administered by the AAA, you will be responsible for the AAA's initial filing fee and in some cases a portion of additional fees to be set by the AAA (e.g., case management fees, arbitrator compensation, etc.), subject to the AAA's fee waiver rules and procedures. The AAA's Fee Schedules for Consumer and Commercial cases are posted on its website at www.adr.org. If you win an arbitration administered by the AAA and recover the full amount of your claim, then Turo will reimburse your initial AAA filing fee but not any additional fees. Except as set forth above, each party shall bear its own fees and costs except as provided by law.

**Class and Representative Action Waiver.** THE PARTIES AGREE THAT EACH OF US MAY BRING CLAIMS AGAINST THE OTHER ONLY ON AN INDIVIDUAL BASIS AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PURPORTED CLASS OR REPRESENTATIVE ACTION OR PROCEEDING, WHETHER IN COURT OR ARBITRATION. UNLESS THE PARTIES AGREE OTHERWISE, THE COURT OR ARBITRATOR MAY NOT CONSOLIDATE OR JOIN MORE THAN ONE PERSON'S OR PARTY'S CLAIMS AND MAY NOT OTHERWISE PRESIDE OVER ANY FORM OF A CONSOLIDATED, REPRESENTATIVE, OR CLASS PROCEEDING. ALSO, THE COURT OR ARBITRATOR MAY AWARD RELIEF (INCLUDING MONETARY, INJUNCTIVE, AND DECLARATORY RELIEF) ONLY IN FAVOR OF THE INDIVIDUAL PARTY SEEKING RELIEF AND ONLY TO THE EXTENT NECESSARY TO PROVIDE RELIEF NECESSITATED BY THAT PARTY'S INDIVIDUAL CLAIM(S). ANY RELIEF AWARDED CANNOT AFFECT OTHER USERS, SUBJECT TO THE ABOVE EXCEPTION ALLOWING PUBLIC INJUNCTIVE RELIEF TO BE SOUGHT IN COURT BUT ONLY IF THAT EXCEPTION IS FOUND TO APPLY.

**Severability.** With the exception of the above Class Representative Action Waiver, if an arbitrator or court decides that any part of the Agreement to Arbitrate is invalid or unenforceable, the other parts of this Agreement to Arbitrate shall still apply. If an arbitrator or court decides that any of the provisions in the Class and Representative Action Waiver section" is invalid or unenforceable, then the entirety of this Agreement to Arbitrate shall be null and void. The remainder of the Agreement, these Terms, and dispute resolution section will continue to apply.

**Right to opt-out of arbitration; procedure. IF YOU ARE A NEW TURO USER, YOU CAN CHOOSE TO OPT-OUT OF THE AGREEMENT TO ARBITRATE BY EMAILING US AN OPT-OUT NOTICE TO ARBITRATIONOPTOUT@TURO.COM ("OPT-OUT NOTICE"). THE OPT-OUT NOTICE MUST BE RECEIVED WITHIN 30 DAYS AFTER THE DATE YOU ACCEPT THESE TERMS FOR THE FIRST TIME OR BEFORE THE COMMENCEMENT OF YOUR FIRST TRIP ON TURO AS A GUEST OR HOST, WHICHEVER DATE IS EARLIEST.** In order to opt-out, you must email your full name, address (including street address, city, state, and zip/postal code), and email address(es) associated with your Turo Account to arbitrationoptout@turo.com. This procedure is the only way you can opt out of the Agreement to Arbitrate. If you opt out of the Agreement to Arbitrate, all other provisions of the Agreement will continue to apply to you, including the below forum selection clause specifying Phoenix, Arizona.

**Future amendments to the Agreement to Arbitrate.** Turo may update this Agreement to Arbitrate at any time and in its sole discretion by posting them at turo.com/us/en/policies/terms. You are responsible for periodically reviewing that website to ensure you are apprised of the current and applicable version. Notwithstanding any other provision to the contrary in this Agreement to Arbitrate, the Parties agree that if Turo makes any amendment to the Agreement to Arbitrate in the future, that amendment shall not apply to any claim that you had already filed against Turo prior to the effective date of the amendment. The amendment shall apply to all other disputes or claims governed by the Agreement to Arbitrate regardless of when they arose or accrued. If you do not agree to the amended terms, you may close your account within 30 days of our posting or notification and you will not be bound by the amended terms; provided that the Parties will arbitrate any dispute in accordance with the provisions of the Agreement to Arbitrate that was in effect as of the date you last accepted these Terms (or accepted any subsequent changes to these Terms). Once you have submitted a valid Opt-Out Notice to Turo, you do NOT need to submit another one when these Terms are subsequently updated. Your first Opt-Out Notice will serve as a valid as to future versions of these Terms.

**Judicial forum for legal disputes not subject to arbitration.** Unless the Parties agree otherwise, in the event that the Agreement to Arbitrate is found not to apply to you or to a particular claim or dispute, whether (1) as a result of your decision to opt out of the Agreement to Arbitrate, (2) as a result of a decision by the arbitrator or a court order, or (3) if one of the above exceptions to the Agreement to Arbitrate applies, you agree that any claim or dispute that has arisen or may arise between the Parties will be resolved exclusively by a state, federal, or small claims court located in Phoenix, Arizona. The Parties agree to submit to the personal jurisdiction of a state court located in Maricopa County, Phoenix, Arizona or a United States District Court for the District of Arizona located in Phoenix, Arizona. The Parties agree that the substantive law of the state of Arizona will apply to any such claim or dispute without regard to conflict of law provisions.

**Governing law.** The parties agree that the substantive laws of the state of Arizona apply to these Terms and the Agreement without regard to conflict of law provisions.

### Dispute Resolution for Hosts and Guests Residing in Canada

PLEASE READ THIS SECTION CAREFULLY. IT AFFECTS YOUR RIGHTS AND WILL HAVE A SUBSTANTIAL IMPACT ON HOW CLAIMS THE PARTIES HAVE AGAINST EACH OTHER ARE RESOLVED

**Resolution of disputes.** If a dispute arises between the Parties and you are a resident of Canada, our goal is to provide you with a neutral and cost-effective means of resolving the dispute quickly. We strongly encourage you to first contact us. We will consider reasonable requests to resolve the dispute through informal means. If we are unable to resolve the dispute in such manner, you may pursue the dispute as explained in this section.

**Arbitration option for claims under $15,000.** Subject to applicable law, for any dispute where the total amount sought is less than CAD$15,000, the Parties may agree to resolve the claim through binding non-appearance-based arbitration. If a Party elects for arbitration and the other Party agrees to arbitration, such arbitration shall be initiated through an established alternative dispute resolution ("ADR") provider mutually agreed upon by the Parties. The ADR provider and the Parties must comply with the following rules: (1) the arbitration shall be conducted by phone, videoconference, and/or be solely based on written submissions, the specific manner shall be chosen by the Party initiating the arbitration, (2) the arbitration shall not involve any personal appearance by the Parties or witnesses unless otherwise mutually agreed by the Parties, and (3) any judgment on the award rendered by the arbitrator may be entered in any court of competent jurisdiction.

**Governing law and forum for disputes.** Subject to applicable law, the laws of Ontario and the applicable federal laws of Canada shall govern these Terms and the Agreement without regard to conflict of law provisions. Subject to applicable law and any mutual agreement to resolve a dispute under the "arbitration option" described above, if you are a resident of Quebec, you agree that any claim or dispute you may have against Turo must be resolved by a court located in Toronto, Ontario and you agree to submit to the personal jurisdiction of the courts located within the province of Ontario.

**Google terms.** Some areas of the Services implement Google Maps/Places mapping services, including Google Places API. In addition, to fight spam and abuse of the Services, Turo has implemented reCAPTCHA Enterprise, a Google service. By using the Services, you are bound by Google's Terms of Service.

### Dispute Resolution for Hosts and Guests Residing in France

PLEASE READ THIS SECTION CAREFULLY. IT AFFECTS YOUR RIGHTS AND WILL HAVE A SUBSTANTIAL IMPACT ON HOW CLAIMS THE PARTIES HAVE AGAINST EACH OTHER ARE RESOLVED. Regardless of where you reside, if you bring an action against Turo in the United States, the section above entitled Dispute resolution for hosts and guests residing in the United States section will govern that dispute.

**General complaints about the Services.** If you reside in France, any dispute regarding these Terms, the Agreement, or other complaints must be addressed to Turo at serviceclients-fr@turo.com.

**Resolution of disputes.** If a dispute arises between the Parties, our goal is to provide you with a neutral and cost-effective means of resolving the dispute quickly. We encourage you to contact us directly to seek a resolution at notificationdelitige@turo.com with your name, phone number, email address, mailing address, and a description of the nature of your complaint. If you reside in France, you may elect for a consumer mediation procedure by contacting a Turo-appointed mediator by mail at the following address: Médiation Consommation Développement, Centre d'Affaires Stéphanois SAS, IMMEUBLE L'HORIZON – ESPLANADE DE FRANCE, 3, RUE J. CONSTANT MILLERET – 42000 SAINT-ÉTIENNE ou via medconsodev.eu. We are under no obligation to accept mediation and, in the event of recourse to mediation, each Party is free to accept or refuse the resolution proposed by the mediator. You must submit a complaint to Turo first before referral to a mediator.

**Governing law and forum for disputes.** If you reside in France, the laws of France govern these Terms and the Agreement and any dispute or claim you have against Turo and you may elect to bring a claim in a court in France. If you reside in France and you agreed to these Terms in your capacity as a merchant, jurisdiction is expressly attributed to the competent court of Paris, notwithstanding multiple defendants or third party guarantors, even for emergency or protective measures in summary proceedings or by petition.

### Dispute Resolution for Hosts and Guests Residing in Australia

PLEASE READ THIS SECTION CAREFULLY. IT AFFECTS YOUR RIGHTS AND WILL HAVE A SUBSTANTIAL IMPACT ON HOW CLAIMS THE PARTIES HAVE AGAINST EACH OTHER ARE RESOLVED. Regardless of where you reside, if you bring an action against Turo in the United States, the section above entitled "Dispute resolution for hosts and guests residing in the United States" will govern that dispute.

**Resolution of disputes.** If a dispute arises between the Parties, our goal is to provide you with a neutral and cost-effective means of resolving the dispute quickly. We encourage you to contact us directly to seek a resolution at turo.com/help. We will consider reasonable requests to resolve the dispute through alternative dispute resolution procedures, such as mediation or arbitration, as alternatives to litigation. If you are in Australia and your dispute relates to protection, you will follow the process outlined in the relevant product disclosure statement available here. For all other disputes in Australia, we encourage you to follow the process described in this paragraph.

**Governing law and forum for disputes.** If you reside in Australia, the laws of Australia shall govern these Terms and the Agreement and any dispute or claim you have against Turo and you may elect to bring a claim in a court in Australia.

### Dispute Resolution for Hosts and Guests Residing Outside the United States, Canada, France or Australia

PLEASE READ THIS SECTION CAREFULLY. IT AFFECTS YOUR RIGHTS AND WILL HAVE A SUBSTANTIAL IMPACT ON HOW CLAIMS THE PARTIES HAVE AGAINST EACH OTHER ARE RESOLVED. Regardless of where you reside, if you bring an action against Turo in the United States, the section above entitled "Dispute resolution for hosts and guests residing in the United States" will govern that dispute.

**Resolution of disputes.** If a dispute arises between the Parties, our goal is to provide you with a neutral and cost-effective means of resolving the dispute quickly. We encourage you to contact us directly to seek a resolution at turo.com/help. We will consider reasonable requests to resolve the dispute through alternative dispute resolution procedures, such as mediation or arbitration, as alternatives to litigation. For resolving disputes related to trips originating in the United Kingdom, you can learn more here.

**Governing law and forum for disputes.** If you reside in the United Kingdom, the laws of England and Wales shall govern these Terms and the Agreement and any dispute or claim you have against Turo and you and Turo both agree to submit to the non-exclusive jurisdiction of the English courts. If you reside in any country other than the United Kingdom, the laws of the state of Arizona and the United States shall govern these Terms and the Agreement and any dispute or claim you have against Turo. If you reside in the United Kingdom, France, or Australia, you may bring a claim arising out of or in connection with these Terms or the Agreement against Turo in a court located in England, but if you reside in France or Australia, you may also elect to bring a claim in the court of your country of residence.

## General Provisions

### Termination

You may discontinue your use of the Services at any time and Turo may terminate your access to the Services and remove any listings for any reason or no reason to the extent permissible under applicable law. Termination of access to the Services will not release a Party from any obligations it incurred prior to the termination and Turo may retain and continue to use any information, including but not limited to photography, previously provided by you. Termination of the Agreement will not have any effect on the disclaimers, waiver or liability limitations, or legal disputes provisions under the Agreement and/or any fees due, and all of those terms will survive any termination of the Agreement.

### No Vehicle Transfer or Assignment

Except as otherwise provided herein, guests and hosts agree that nothing in these Terms constitutes an actual or purported transfer or assignment of any right or interest in a vehicle or optional Extras shared through the Services.

### Disclaimers

TURO PROVIDES SERVICES THAT ENABLE THE SHARING OF VEHICLES AND OPTIONAL EXTRAS BETWEEN HOSTS AND GUESTS. EXCEPT AS OTHERWISE PROVIDED IN THESE TERMS, TURO DOES NOT ITSELF PROVIDE VEHICLE SHARING, RENTAL SERVICES, AND/OR INSURANCE SERVICES AND IS NOT RESPONSIBLE FOR ANY OF THE ACTS OR OMISSIONS OF ANY OF THE USERS OF ITS SERVICES, THE MANUFACTURER OF THE VEHICLE OR ANY OPTIONAL EXTRAS, OR ANY THIRD PARTY PROVIDER OF SERVICES (E.G. IN-VEHICLE GPS OR OTHER SYSTEMS). **THE SERVICES ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED. TO THE EXTENT PERMITTED BY APPLICABLE LAW, WITHOUT LIMITING THE FOREGOING, TURO EXPLICITLY DISCLAIMS ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT, AND ANY WARRANTIES ARISING OUT OF COURSE OF DEALING OR USAGE OF TRADE.** Turo makes no warranty that the Services, including, but not limited to, the listing and/or any vehicle or optional Extra, will meet your requirements or be available on an uninterrupted, secure, or error-free basis. Turo makes no warranty regarding the quality of any listings, vehicles, hosts, guests, Extras, the Services, or any content or the accuracy, timeliness, truthfulness, completeness, or reliability of any content obtained through the Services. No advice or information, whether oral or written, obtained from Turo, Turo Insurance Agency, or its service providers or through the Services or content, will create any warranty not expressly made herein.

### Limitation of Liability and Waiver

EXCEPT WHERE PROHIBITED BY LAW, YOU WAIVE AND DISCHARGE ANY AND ALL RIGHTS YOU HAVE TO SUE OR MAKE CLAIMS AGAINST TURO AND ANY OF ITS SUBSIDIARIES, DIRECTORS, OFFICERS, AGENTS (INCLUDING THIRD-PARTY ADMINISTRATORS, INSURANCE PRODUCERS, AND INSURANCE PROVIDERS), OR EMPLOYEES (TOGETHER, THE "TURO PARTIES") AND ANY TURO USER FOR ANY DAMAGES OR LOSSES, WHETHER DUE TO NEGLIGENCE OR OTHERWISE, ARISING OUT OF OR IN CONNECTION WITH THE FOLLOWING: (1) VEHICLE AVAILABILITY (E.G., A VEHICLE NOT BEING AVAILABLE OR RETURNED WHEN IT WAS SUPPOSED TO BE), (2) PROBLEMS WITH A VEHICLE (E.G., ANY MALFUNCTION OF OR DEFICIENCY WITH A VEHICLE), (3) VEHICLE WARRANTY ISSUES (E.G., ANY BREACH OF WARRANTY OR OTHER OBLIGATION BY ANY MANUFACTURER OR OTHER THIRD PARTY ASSOCIATED WITH THE VEHICLE), (4) THE LEGAL OR LICENSE STATUS OF A VEHICLE, HOST, OR GUEST, (5) THIRD PARTY ASSESSMENTS OF A VEHICLE'S VALUE, OR (6) ANY ACTION OR INACTION OF A HOST OR GUEST.

YOU AGREE THAT NEITHER TURO NOR ANY OTHER PARTY INVOLVED IN CREATING, PRODUCING, OR DELIVERING THE SERVICES WILL BE LIABLE FOR ANY INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING LOST PROFITS, DATA, OR GOODWILL, SERVICE INTERRUPTION, COMPUTER DAMAGE OR SYSTEM FAILURE, OR THE COST OF SUBSTITUTE PRODUCTS OR SERVICES), WHETHER BASED ON WARRANTY, CONTRACT, TORT (INCLUDING NEGLIGENCE), PRODUCT LIABILITY, OR ANY OTHER LEGAL THEORY, ARISING OUT OF OR CONNECTION WITH THE FOLLOWING: (1) THE AGREEMENT, (2) THE SERVICES (INCLUDING LISTING OR BOOKING OF ANY VEHICLE OR OPTIONAL EXTRA VIA THE SERVICES), OR (3) INABILITY TO USE THE SERVICES.

**Except for our obligations to pay amounts to applicable hosts or guests pursuant to these Terms, including an approved payment request or claim under a protection or earnings plan or applicable insurance policy, in no event will the Turo Parties' aggregate liability arising out of or in connection with the Agreement or your use of the Services, exceed the greater of (1) the amounts you have paid or owe for bookings via the Services as a guest in the twelve month period prior to the event giving rise to the liability, or if you are a host, the amount earned by you in the 12 month period prior to the event giving rise to the liability, or (2) US$100.**

EXCEPT WHERE PROHIBITED BY LAW, YOU ALSO WAIVE AND DISCHARGE ANY AND ALL RIGHTS YOU HAVE TO SUE OR MAKE CLAIMS AGAINST ANY TURO USER FOR ANY DAMAGES OR LOSSES ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICES.

**YOU WAIVE CALIFORNIA CIVIL CODE §1542, OR ANY SIMILAR LAW, WHICH STATES: "A GENERAL RELEASE DOES NOT EXTEND TO CLAIMS WHICH THE CREDITOR DOES NOT KNOW OR SUSPECT TO EXIST IN HIS OR HER FAVOR AT THE TIME OF EXECUTING THE RELEASE, WHICH IF KNOWN BY HIM OR HER MUST HAVE MATERIALLY AFFECTED HIS OR HER SETTLEMENT WITH THE DEBTOR."**

THE ABOVE LIMITATIONS OF LIABILITY AND WAIVER PROVISIONS ARE FUNDAMENTAL ELEMENTS OF THE BASIS OF THE BARGAIN BETWEEN TURO AND YOU. THEY SHALL APPLY TO THE EXTENT PERMITTED BY APPLICABLE LAW, AND ANY ASPECTS OF THEM THAT ARE DEEMED VOID OR UNENFORCEABLE SHALL BE SEVERED WHILE LEAVING THE REMAINDER IN EFFECT.

---

## UNVERIFIED APPENDIX — final section, two divergent/unreliable candidate extractions

**Do not treat the text below as evidence of Turo's actual current terms.** As explained above, the source content fed to the extraction model was truncated at the exact point these two candidates begin to diverge from each other (confirmed by a third, targeted fetch that surfaced the truncation directly). Both candidates are included only so nothing is silently discarded; a genuine capture of this section (e.g. via a real browser session, or a future working archival mirror) is still needed.

### Appendix A — Pass A candidate (r.jina.ai, https:// variant)

*Note: this candidate's own closing line ("This is complete raw text content from the Turo Terms of Service page. No summarization has been provided...") is itself model-generated meta-commentary, not source content — it is retained here verbatim for transparency about exactly what the model returned, not as a claim of accuracy.*


### Indemnification

You agree to release, defend, indemnify, and hold Turo and its subsidiaries, officers, directors, employees, and agents, harmless from and against any claims, actions, damages, liability and expense in connection with your use of the Services or breach of these Terms, including but not limited to claims relating to your violation of applicable law, violation of a third party's rights, or the rights or interests of another user. You agree to indemnify Turo against claims brought by third parties arising out of or relating to your vehicle, your listings, your guest conduct, or any damage caused by you or your vehicle. Your indemnification obligations do not include claims arising out of Turo's gross negligence, willful misconduct, or breach of these Terms. Turo reserves the right to assume the exclusive defense and control of any third party claim that is subject to indemnification by you, and you shall cooperate fully with Turo in asserting any available defenses.

### Additional Terms

#### Definitions

As used in these Terms: "Approved Driver" means a person listed as an Approved Driver at the time of a reservation. "Person" means an individual, corporation, partnership, association, or any other legal entity. "You" or "Your" refers to you as an individual user of the Services. "Turo user" refers to any user of the Services, including hosts, guests, and Co-hosts.

#### Force Majeure

Turo will not be liable to you for any failure or delay in performance under these Terms or the Services caused by circumstances beyond the reasonable control of Turo including, but not limited to, war, terrorism, natural disasters, acts of God, labor disputes, or government actions. In such circumstances, Turo will use reasonable efforts to minimize any negative impact on the parties.

#### Assignment

Neither you nor Turo may assign these Terms or any rights or obligations under these Terms without the prior written consent of the other party, except that Turo may assign these Terms to any subsidiary, affiliate, or in connection with a merger, acquisition, or sale of substantially all of Turo's assets. Any attempted assignment in violation of this section is void. These Terms bind and inure to the benefit of the parties and their permitted successors and assigns.

#### Entire Agreement

These Terms, together with the policies and agreements incorporated by reference herein (including the cancellation policy, nondiscrimination policy, additional policies, and any other agreements referenced herein), constitute the entire agreement between you and Turo concerning your use of the Services and supersedes all prior negotiations, representations, and agreements between you and Turo, whether written or oral, relating to the subject matter of these Terms. No oral modification or course of dealing shall amend these Terms.

#### Severability

If any provision of these Terms is found to be unlawful, void, or for any reason unenforceable by a court of competent jurisdiction, the unenforceable provision shall be severed and the remaining provisions shall remain in full force and effect. If any provision related to limitation of liability or waiver is found unenforceable, that provision shall be reformed to the extent necessary to make it enforceable, but only to the extent permitted by law.

#### Waiver

The failure of Turo to enforce any right or provision of these Terms will not constitute a waiver of that provision or right. Any waiver of any provision or right must be in writing and signed by an authorized representative of Turo.

#### Third Party Beneficiaries

Except as specifically provided in these Terms (e.g., the indemnification provisions regarding Turo's subsidiaries, officers, and agents), nothing in these Terms is intended to confer any third-party beneficiary rights on any person who is not a party to these Terms.

#### Notices

All notices required to be delivered under these Terms, other than notices related to dispute resolution, may be delivered electronically to the email address associated with your Turo Account or account settings, or to Turo by email at turo.com/help or by mail to Turo, Inc., 200 Van Ness Avenue, Suite 100, San Francisco, CA 94102, USA. Notices will be considered received when sent electronically or three business days after being mailed.

#### Headings

The headings and section titles in these Terms are for convenience only and do not affect the interpretation of these Terms.

#### No Agency

Nothing in these Terms creates a partnership, joint venture, agency, employment, or similar relationship between you and Turo. You are not authorized to make any commitments or representations on behalf of Turo.

#### Survival

All terms that by their nature should survive termination of these Terms shall survive such termination, including all disclaimers, limitations of liability, indemnification obligations, and dispute resolution provisions.

---

**END OF TERMS OF SERVICE**

This is complete raw text content from the Turo Terms of Service page. No summarization has been provided; all section headings, paragraphs, and structured formatting have been preserved as published.
### Appendix B — Pass B candidate (r.jina.ai, http:// variant)

*Note: this candidate's own closing line ("**Note:** This page contains complete Terms of Service as published by Turo. It is authentic legal content...") is likewise model-generated meta-commentary, not source content — retained verbatim for the same transparency reason.*


### Indemnification

You agree to release, defend, indemnify, and hold Turo and its subsidiaries, officers, directors, employees, and agents, harmless from and against any claims, liabilities, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising out of or in connection with: (1) your access to and use of the Services, (2) your booking or listing of any vehicle or optional Extra, (3) your violation of any provision of these Terms, (4) your infringement of any third party right, including any intellectual property or publicity right, (5) your violation of any applicable law, rule, or regulation, (6) the content you submit, post, transmit, or make available through the Services, (7) any misrepresentation or inaccuracy in any information you provide, and/or (8) your acts or omissions. This indemnification obligation does not apply to the extent any liability is caused directly and solely by Turo's negligence or willful misconduct.

### Entire agreement and notices

These Terms, together with all Policies and other documents referred to or incorporated herein, constitute the entire agreement between you and Turo with respect to your access to and use of the Services and supersede all prior and contemporaneous agreements, representations, warranties, and understandings related to the Services. If you are a resident of New Jersey, you may have additional statutory rights which cannot be waived. Any notices from Turo to you will be sent to the electronic mail address you provide or by posting to the Services, and notice will be effective upon sending or posting. We strongly recommend that you review these Terms periodically to ensure that you are familiar with the current terms and conditions that apply to your use of the Services. We reserve the right to make changes to these Terms at any time. If you do not agree with any changes to the Terms, your sole remedy is to cease using the Services.

### Severability and waiver

If any portion of these Terms is found to be unenforceable or invalid by a court, arbitrator, or other adjudicator of competent jurisdiction, the unenforceable or invalid provision shall be severed and the remaining portions of these Terms shall remain in full force and effect, except as provided in the Severability section under the dispute resolution section regarding the Class and Representative Action Waiver. The failure of either Party to enforce any right or provision in these Terms will not constitute a waiver of such right or provision unless acknowledged and agreed to by the enforcing Party in writing.

---

**Note:** This page contains complete Terms of Service as published by Turo. It is authentic legal content governing the Turo platform's usage terms.
---

## Recommendation

Treat the VERIFIED BODY TEXT section above (Introduction through "Limitation of Liability and Waiver") as reliable for legal-evidence purposes, cross-confirmed by two independent extraction passes with zero substantive disagreement. Treat Appendix A and Appendix B as leads only, not evidence — the two disagree with each other on: the wording of the final Indemnification clause; whether the closing sections are titled "Entire Agreement" / "Severability" / "Waiver" (separately) vs. "Entire agreement and notices" / "Severability and waiver" (combined); the presence of a New Jersey-resident statutory-rights sentence (only in Appendix B); and the presence/absence of "Definitions," "Force Majeure," "Assignment," "Third Party Beneficiaries," "Headings," "No Agency," and "Survival" subsections (present only in Appendix A). Before relying on this document's final clauses for any legal purpose, obtain the last ~10% of the page via a real browser session (or wait for Wayback Machine service to recover and check for a 2026 snapshot) and reconcile against these two candidates.

**END OF CAPTURE FILE**
