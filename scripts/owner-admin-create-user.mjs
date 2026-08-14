#!/usr/bin/env node
/**
 * Owner-dashboard admin helper: create (or reset) a sign-in user for /owner
 * in the shared Supabase Auth project. Operator-only — this script is never
 * imported by app code, and it is the ONLY place the service-role key is
 * used anywhere in this repo.
 *
 *   node --env-file=.env.local scripts/owner-admin-create-user.mjs <email> [password]
 *
 * If no password is given, one is generated and printed once — save it.
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY (full admin access to the Supabase
 * project — find it in Project Settings -> API -> service_role key) and
 * NEXT_PUBLIC_SUPABASE_URL. The service-role key is shell-env-only: it is
 * NOT one of the app's NEXT_PUBLIC_* vars and must never be added to
 * .env.example or any file the app itself reads.
 *
 * Requires Node 18+ (for --env-file) and the @supabase/supabase-js package
 * already a dependency of this repo.
 */

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    if (name === "SUPABASE_SERVICE_ROLE_KEY") {
      console.error(
        "Find it in the Supabase dashboard: Project Settings -> API -> service_role key.\n" +
          "Set it in your shell or an untracked file for this script only — never in .env.example.",
      );
    }
    process.exit(1);
  }
  return v;
}

const email = process.argv[2];
if (!email) {
  console.error("Usage: owner-admin-create-user.mjs <email> [password]");
  process.exit(1);
}
const generatedPassword = process.argv[3] == null;
const password = process.argv[3] ?? randomBytes(12).toString("base64url");

const url = need("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = need("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (error) {
  console.error(`createUser failed: ${error.message}`);
  process.exit(1);
}

console.log(`Created owner user: ${data.user?.email} (${data.user?.id})`);
if (generatedPassword) {
  console.log(`Generated password (shown once, save it now): ${password}`);
}
console.log("Reminder: this account needs membership in a Sophosic workspace to save tenant settings.");
