# evhost.app background services

The web deployment uses its Supabase service-role key only in the server-only
reminder route, and only to call the narrow reminder-material and delivery RPCs.
It never sends that key or reminder ciphertext to client code. Durable Tesla
access, custom-domain activation, and telemetry ingestion run separately as the
scoped `onlyevs_worker` database role created by the migration.

Production topology:

1. Tesla's official `fleet-telemetry` Helm chart terminates vehicle mTLS and
   publishes decoded JSON to private Kafka topics `onlyevs_V` and
   `onlyevs_connectivity` with reliable acknowledgements.
2. Tesla's official `tesla-http-proxy` signs Fleet Telemetry configuration
   calls with the application virtual key; only `onlyevs-worker` may reach it.
3. `onlyevs-worker` consumes those topics and claims trip/domain/Google
   Calendar sync work with `FOR UPDATE SKIP LOCKED`. Calendar events refresh
   every 15 minutes into a review-only queue; they never create trips by
   themselves. Two replicas are safe and provider calls are reconciled against
   durable state. Session advisory locks serialize rotating refresh-token use
   per integration without blocking other workspaces.
4. The database LOGIN used in `ONLYEVS_WORKER_DATABASE_URL` is provisioned
   outside migrations and receives only `GRANT onlyevs_worker`.
5. The same worker can claim encrypted Turo email parse jobs in batches of five
   with concurrency two. This lane remains inert while
   `ONLYEVS_EMAIL_WORKER_ENABLED=false`. Raw MIME and its normalized manifest
   are stored together in an authenticated `EVMAIL1` envelope in private R2;
   the database holds hashes, object references, parser output, and audit state.

The web app may complete a Google Calendar OAuth grant and its initial bounded
event import before this worker is deployed. It must describe that state as an
initial import only; automatic refresh is available only while the operations
service is enabled and healthy.

Before deployment, replace every `REPLACE_*` value, pin the worker image and
official Tesla chart/image to immutable versions, create Kafka topics with
retention appropriate to transient processing, provision TLS from a public CA,
and validate the telemetry certificate with Tesla's `check_server_cert.sh`.
Do not store the Tesla private signing key in these manifests; use the platform
secret manager/HSM.

`vehicle-command-proxy-deployment.yaml` is intentionally a template. Replace
the image placeholder with an immutable digest from Tesla's official
`tesla/vehicle-command` image, provide the signing key and TLS secrets through
the platform secret manager, and set `ONLYEVS_TESLA_COMMAND_PROXY_URL` to a
private HTTPS name whose certificate the worker trusts. Never expose the proxy
as a public unauthenticated service.

## Private email intake rollout

The Cloudflare Email Worker lives in `services/email-ingest-worker`. Its checked
in Wrangler configuration has no route and keeps intake disabled. Do not attach
`mail.evhost.app`, create or replace MX records, populate secrets, or enable any
flag until `docs/spikes/2026-08-16-turo-email-ingestion-go-no-go.md` is approved.

When approved, create a private R2 bucket with a verified 30-day lifecycle,
inject the alias/capture/KEK keyrings through secret storage, deploy an immutable
Worker version, and use a controlled address before adding the Email Routing
catch-all. Enable web intake for that controlled workspace first. The parser
worker and each of the four risk gates are separate later changes. SendGrid is
outbound-only; its signed Event Webhook targets
`/api/internal/sendgrid/events` and must pass a delivered-mail canary.

Rollback is intentionally boring: disable web intake, all four Auto gates, and
the parser worker; pause affected integrations; then detach the catch-all Worker.
Do not delete audit rows or R2 objects manually—retention cleanup remains the
source of truth.

The vehicle configuration emitted by the app is deliberately bounded to
`Soc`, `EstBatteryRange`, `Odometer`, `DetailedChargeState`, `Locked`, and
`Location`. Baseline telemetry never requests Location. The worker adds it only
while one exact vehicle has a bound, consented, active trip-access window, at a
300-second interval plus 500-metre minimum delta. Coordinates are persisted
only for that trip, envelope-encrypted, and deleted after 30 days; the worker
removes Location from the vehicle configuration when the window closes.

## evhost.app canonical-origin cutover

`evhost.app` is the platform hostname, not a tenant custom domain. Keep it and
`www.evhost.app` in the reserved-host list and attach them directly to the
production Vercel project. Do not submit either through the workspace domain
queue.

1. Add `evhost.app` and `www.evhost.app` to the production Vercel project and
   copy the exact current ownership and routing records returned by Vercel.
2. Create those records in the authoritative Cloudflare zone. Keep ownership
   TXT records DNS-only. Start Vercel routing A/CNAME records DNS-only while
   Vercel verifies ownership, routing, and certificate issuance; do not
   substitute remembered Vercel IPs for the provider response.
3. After both hosts pass HTTPS, make `evhost.app` primary and redirect `www`
   to the apex. Keep the previous production hostname attached as a rollback
   alias until the full auth and guest-flow verification below passes.
4. Set the web/worker canonical origin and callback values to `https://evhost.app`:
   `ONLYEVS_CANONICAL_ORIGIN`, `TESLA_REDIRECT_URI`,
   `TESLA_OWNER_REDIRECT_URI`, and `GOOGLE_CALENDAR_REDIRECT_URI`. Add
   `https://evhost.app/auth/callback` to the existing Supabase redirect
   allowlist. Register the two Tesla callbacks and Google callback in their
   respective provider dashboards before rebuilding the web app.
5. Redeploy, then verify apex and `www` HTTPS, `/owner` auth gating, password
   and magic-link callbacks, both Tesla OAuth actors, Google Calendar OAuth,
   one tenant custom domain, an unpublished guest gate, and a published guest
   trip. Only then retire the previous canonical redirect registrations.

Cloudflare proxying is a separate, reversible decision after the Vercel origin
is healthy. If enabled later, retest host preservation, OAuth origin checks,
cache bypass for auth/API responses, and certificate behavior before calling
the proxied path production-ready.
