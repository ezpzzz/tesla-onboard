import type { EmailOtpType } from "@supabase/supabase-js";

export type OwnerEmailOtpType = Extract<
  EmailOtpType,
  "signup" | "magiclink" | "email" | "recovery"
>;

export function ownerEmailOtpType(value: unknown): OwnerEmailOtpType | null {
  if (
    value === "signup" ||
    value === "magiclink" ||
    value === "email" ||
    value === "recovery"
  ) {
    return value;
  }
  return null;
}
