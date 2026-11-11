'use client'

import { signOutCurrentSession } from '@/lib/services/auth-service'

// La recarga completa vuelve a pedir la sesión y reinicia AuthProvider. `retry()` solo
// volvía a renderizar el segmento con el estado anterior y dejaba la pantalla en blanco.
function reloadPage() {
  window.location.reload()
}

// Salida para quien tiene sesión válida y aun así no puede ver la pantalla. No se ofrece «Volver al
// ingreso»: con la sesión abierta, el ingreso devolvía a esta misma pantalla (bucle). Sin sesión, al
// recargar, `proxy.ts` lleva a `/login?next=<ruta>`. Si falla la red la sesión sigue y se ve esta pantalla.
async function signOutAndReload() {
  await signOutCurrentSession().catch(() => undefined)
  reloadPage()
}

// No muestra el mensaje del error: puede traer detalles internos o datos.
export default function DataError() {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-4 md:p-8" role="alert">
      <h1 className="text-2xl font-semibold text-[#163a63]">No se pudo mostrar esta pantalla</h1>
      <p className="text-sm text-slate-700">
        No se pudo verificar tu acceso o leer los datos. Probá de nuevo; si sigue igual, cerrá la sesión y volvé a
        ingresar, o avisá a quien administra el sistema.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={reloadPage} className="rounded-md bg-[#163a63] px-4 py-2 text-sm font-medium text-white">Intentar de nuevo</button>
        <button onClick={signOutAndReload} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium">Cerrar sesión</button>
      </div>
    </main>
  )
}
