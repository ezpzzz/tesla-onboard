import type { EmailOtpType } from "@supabase/supabase-js";

export type OwnerEmailOtpType = Extract<EmailOtpType, "signup" | "magiclink" | "email">;

export function ownerEmailOtpType(value: unknown): OwnerEmailOtpType | null {
  if (value === "signup" || value === "magiclink" || value === "email") {
    return value;
  }
  return null;
}
