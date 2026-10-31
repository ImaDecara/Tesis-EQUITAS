'use client'

import { signOutCurrentSession } from '@/lib/services/auth-service'

// La recarga completa vuelve a pedir la sesion y reinicia AuthProvider. `retry()` solo
// volvia a renderizar el segmento con el estado anterior y dejaba la pantalla en blanco.
function reloadPage() {
  window.location.reload()
}

// Salida para quien tiene sesion valida y no puede leer cartera (por ejemplo `importador`):
// "Volver al ingreso" lo devolveria aca, porque la sesion sigue vigente. Sin sesion, al
// recargar, `proxy.ts` lleva a `/login?next=<ruta>`. Si falla la red la sesion sigue y se ve esta pantalla.
async function signOutAndReload() {
  await signOutCurrentSession().catch(() => undefined)
  reloadPage()
}

export default function DataError() {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-8" role="alert">
      <h1 className="text-2xl font-semibold">Datos no disponibles</h1>
      <p>No se pudo verificar el acceso o completar la lectura. Volvé a ingresar o intentá nuevamente.</p>
      <button onClick={reloadPage} className="rounded border px-4 py-2">Intentar nuevamente</button>
      <button onClick={signOutAndReload} className="ml-2 rounded border px-4 py-2">Cerrar sesión</button>
      <a href="/login" className="block underline">Volver al ingreso</a>
    </main>
  )
}
