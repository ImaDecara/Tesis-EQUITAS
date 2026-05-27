export default function GlobalLoading() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#eef2f7_0,_#f7f5ef_40%,_#f4f4f1_100%)] p-4 md:p-6">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <div className="h-6 w-56 animate-pulse rounded-md bg-slate-200" />
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white"
            />
          ))}
        </section>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white" />
          <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white" />
        </section>
      </div>
    </main>
  )
}
