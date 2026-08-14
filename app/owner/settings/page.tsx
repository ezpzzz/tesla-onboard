import { TenantSettingsForm } from "@/components/owner/TenantSettingsForm";

export default function OwnerSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Rental settings</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Brand, contact, vehicle, and policy details shown in this workspace&apos;s guest walkthrough.
        </p>
      </div>
      <TenantSettingsForm />
    </div>
  );
}
