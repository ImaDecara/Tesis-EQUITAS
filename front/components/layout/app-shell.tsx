import type { ReactNode } from 'react'

import { AppFrame } from '@/components/layout/app-frame'
import { loadViewerContext } from '@/lib/server/viewer-context'

// Marco de todas las pantallas con sesión. El contexto (municipio, fecha de la cartera, persona y rol)
// se resuelve en el servidor, en la misma solicitud que la página, y viaja al menú como datos.
export async function AppShell({ children }: { children: ReactNode }) {
  const viewer = await loadViewerContext()
  return <AppFrame viewer={viewer}>{children}</AppFrame>
}
