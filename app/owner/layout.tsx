import type { ReactNode } from "react";
import { OwnerShell } from "@/components/owner/OwnerShell";

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return <OwnerShell>{children}</OwnerShell>;
}
