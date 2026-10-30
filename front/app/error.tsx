'use client'

export default function DataError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-8" role="alert">
      <h1 className="text-2xl font-semibold">Datos no disponibles</h1>
      <p>No se pudo verificar el acceso o completar la lectura. Volvé a ingresar o intentá nuevamente.</p>
      <button onClick={retry} className="rounded border px-4 py-2">Intentar nuevamente</button>
      <a href="/login" className="block underline">Volver al ingreso</a>
    </main>
  )
}
