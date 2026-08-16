import type { EmailCapability } from "@evhost/email-ingest-contract";

const ENV_BY_CAPABILITY: Record<EmailCapability, string> = {
  create: "ONLYEVS_EMAIL_AUTO_CREATE_ENABLED",
  pretrip: "ONLYEVS_EMAIL_AUTO_PRETRIP_ENABLED",
  active_safe: "ONLYEVS_EMAIL_AUTO_ACTIVE_SAFE_ENABLED",
  active_destructive: "ONLYEVS_EMAIL_AUTO_ACTIVE_DESTRUCTIVE_ENABLED",
};

export function emailCapabilityEnabled(capability: EmailCapability, env: Record<string, string | undefined> = process.env): boolean {
  return env.ONLYEVS_EMAIL_WORKER_ENABLED === "true" && env[ENV_BY_CAPABILITY[capability]] === "true";
}

export function canAutoApply(input: {
  mode: "review" | "auto";
  capability: EmailCapability;
  blockerCodes: readonly string[];
  env?: Record<string, string | undefined>;
}): boolean {
  return input.mode === "auto" && input.blockerCodes.length === 0 && emailCapabilityEnabled(input.capability, input.env);
}
