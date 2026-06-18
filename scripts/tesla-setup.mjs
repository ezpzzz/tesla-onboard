#!/usr/bin/env node
/**
 * Tesla Fleet API setup helper. Three commands:
 *
 *   node --env-file=.env.local scripts/tesla-setup.mjs genkeys
 *     Generate an EC P-256 keypair. Writes tesla-private-key.pem (KEEP SECRET,
 *     gitignored) and tesla-public-key.pem (served at the .well-known path).
 *
 *   node --env-file=.env.local scripts/tesla-setup.mjs register
 *     One-time partner-account registration: gets a partner token via the
 *     client_credentials grant, then POSTs your domain to /api/1/partner_accounts.
 *     Only needed if Tesla requires partner registration for your app.
 *
 *   node --env-file=.env.local scripts/tesla-setup.mjs verify
 *     Check the public key Tesla has on file for your domain.
 *
 * Requires Node 20+ (for global fetch and --env-file). Reads TESLA_CLIENT_ID,
 * TESLA_CLIENT_SECRET, TESLA_AUDIENCE, TESLA_SCOPES, TESLA_APP_DOMAIN from env.
 */

import crypto from "node:crypto";
import { writeFileSync } from "node:fs";

const TOKEN_URL = "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token";
const AUDIENCE =
  process.env.TESLA_AUDIENCE ?? "https://fleet-api.prd.na.vn.cloud.tesla.com";

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function genkeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1", // secp256r1, as Tesla requires
  });
  writeFileSync(
    "tesla-private-key.pem",
    privateKey.export({ type: "pkcs8", format: "pem" }),
  );
  writeFileSync(
    "tesla-public-key.pem",
    publicKey.export({ type: "spki", format: "pem" }),
  );
  console.log("Wrote tesla-private-key.pem (keep secret) and tesla-public-key.pem");
  console.log(
    "The public key is now served at /.well-known/appspecific/com.tesla.3p.public-key.pem",
  );
}

async function partnerToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: need("TESLA_CLIENT_ID"),
    client_secret: need("TESLA_CLIENT_SECRET"),
    scope: process.env.TESLA_SCOPES ?? "openid vehicle_device_data",
    audience: AUDIENCE,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    console.error(`Partner token failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  return (await res.json()).access_token;
}

async function register() {
  const domain = need("TESLA_APP_DOMAIN");
  const token = await partnerToken();
  const res = await fetch(`${AUDIENCE}/api/1/partner_accounts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ domain }),
  });
  console.log(`POST /api/1/partner_accounts → ${res.status}`);
  console.log(await res.text());
}

async function verify() {
  const domain = need("TESLA_APP_DOMAIN");
  const token = await partnerToken();
  const res = await fetch(
    `${AUDIENCE}/api/1/partner_accounts/public_key?domain=${encodeURIComponent(domain)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  console.log(`GET /api/1/partner_accounts/public_key → ${res.status}`);
  console.log(await res.text());
}

const cmd = process.argv[2];
const commands = { genkeys, register, verify };
if (!commands[cmd]) {
  console.error("Usage: tesla-setup.mjs <genkeys|register|verify>");
  process.exit(1);
}
await commands[cmd]();
