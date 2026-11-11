// Estado «cargando» de todas las pantallas: un aviso legible y la silueta de la página.
export default function GlobalLoading() {
  return (
    <main className="min-h-screen bg-[#f5f5f2] p-4 md:p-6" aria-busy="true">
      <p role="status" className="sr-only">Cargando…</p>
      <div className="mx-auto max-w-[1400px] space-y-4" aria-hidden>
        <div className="h-6 w-56 animate-pulse rounded-md bg-slate-200" />
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </section>
        <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </div>
    </main>
  )
}
