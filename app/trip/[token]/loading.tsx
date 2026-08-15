export default function GuestTripLoading() {
  return (
    <div aria-busy="true" aria-label="Loading trip" className="mx-auto min-h-[680px] max-w-[1180px] space-y-6 px-4 py-8 sm:px-6 md:px-8">
      <div className="space-y-3">
        <div className="h-3 w-24 rounded bg-line/70" />
        <div className="h-9 w-56 rounded-md bg-line/70" />
        <div className="h-5 w-full max-w-lg rounded bg-line/50" />
      </div>
      <div className="h-[360px] rounded-lg border border-line bg-white" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-28 rounded-lg border border-line bg-white" />
        <div className="h-28 rounded-lg border border-line bg-white" />
      </div>
    </div>
  );
}
