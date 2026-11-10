import 'server-only'

import { internalBaseUrl } from '@/lib/server/imports-forward'
import { supabaseUrl } from '@/lib/supabase-config'

// Noche 7. La carga de CSV solo puede escribir en la base LOCAL de pruebas: el cargador rechaza
// cualquier otro destino (back/ETL/config.py). Esta comprobación no reemplaza esa guarda: solo
// evita ofrecer un botón que el servicio va a rechazar, y lo explica.
export type ImportAvailability =
  | { available: true }
  | { available: false; reason: 'NOT_LOCAL_DATABASE' | 'SERVICE_NOT_CONFIGURED'; explanation: string }

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function isLocalDatabaseUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

export function importAvailability(databaseUrl: string = supabaseUrl): ImportAvailability {
  if (!isLocalDatabaseUrl(databaseUrl)) {
    return {
      available: false, reason: 'NOT_LOCAL_DATABASE',
      explanation: 'Esta instalación no está conectada a la base local de pruebas. En esta versión la carga de CSV solo escribe en una base local: acá queda deshabilitada y no se puede cargar ningún archivo.',
    }
  }
  if (!internalBaseUrl()) {
    return {
      available: false, reason: 'SERVICE_NOT_CONFIGURED',
      explanation: 'El servicio de importación local no está configurado en esta instalación. Arrancá el entorno local completo (un solo comando) y volvé a esta pantalla.',
    }
  }
  return { available: true }
}
