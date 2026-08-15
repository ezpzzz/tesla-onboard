export function OwnerPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading page" className="min-h-[680px] space-y-6">
      <div className="space-y-3">
        <div className="h-3 w-28 rounded bg-line/70" />
        <div className="h-9 w-52 rounded-md bg-line/70" />
        <div className="h-5 w-full max-w-xl rounded bg-line/50" />
      </div>
      <div className="h-[280px] rounded-lg border border-line bg-white" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-48 rounded-lg border border-line bg-white" />
        <div className="h-48 rounded-lg border border-line bg-white" />
      </div>
    </div>
  );
}
