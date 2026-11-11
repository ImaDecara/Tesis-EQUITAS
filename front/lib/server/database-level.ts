import 'server-only'

import { cache } from 'react'

import { EQUITAS_TABLE_NAMES } from '@/lib/data/table-names'
import { tenantReadScope } from '@/lib/server/tenant-read-scope'

import { createServerSupabaseClient } from '@/lib/supabase-server'

// Noche 7 (encargo 10.2). Nivel de la base: se deduce de lo que la base tiene, con una sola
// comprobación por solicitud y sin banderas de configuración.
//
// BASE: la base no tiene el módulo de decisiones y auditoría (como la original hoy). La aplicación
// muestra la cartera y no escribe nada. CON_MODULO exige las cuatro tablas presentes.
// Ante la duda se lanza un error: no se permite leerlo como compatibilidad comprobada.
export type DatabaseLevel = 'BASE' | 'CON_MODULO'

/** Las cuatro tablas que agrega el módulo. BASE exige que falten las cuatro. */
export const MODULE_TABLES = ['import_batch', 'case_review', 'case_review_approval', 'access_audit'] as const

// Único lugar donde vive este código: es la respuesta de PostgREST «la tabla no está en el esquema».
// Una versión de PostgREST que responda otra cosa deja el nivel en CON_MODULO (falla cerrado).
export const TABLE_NOT_IN_SCHEMA = { status: 404, code: 'PGRST205' } as const

export type TableProbe = { status?: number; error: { code?: string } | null }

const isMissing = (probe: TableProbe) => probe.status === TABLE_NOT_IN_SCHEMA.status && probe.error?.code === TABLE_NOT_IN_SCHEMA.code

/**
 * BASE solo si las cuatro tablas respondieron «no está en el esquema». Una mezcla (unas sí y otras
 * no) o cualquier otro error es CON_MODULO y se informa como incierto para dejarlo en el registro.
 */
export function levelFromProbes(probes: readonly TableProbe[]): { level: DatabaseLevel; uncertain: boolean } {
  if (probes.length === MODULE_TABLES.length && probes.every(isMissing)) return { level: 'BASE', uncertain: false }
  return { level: 'CON_MODULO', uncertain: probes.length !== MODULE_TABLES.length || probes.some(probe => probe.error !== null || probe.status === undefined || probe.status < 200 || probe.status >= 300) }
}

type Client = NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>

// GET sin filas: no lee datos y no depende de las políticas de lectura.
const probe = async (client: Client, table: string): Promise<TableProbe> => {
  const { status, error } = await client.from(table).select('id').limit(0)
  return { status, error: error ? { code: error.code } : null }
}

export class DatabaseLevelError extends Error {
  constructor() {
    super('No se pudo comprobar la compatibilidad de la base. Recargá la página en unos minutos.')
    this.name = 'DatabaseLevelError'
  }
}

async function readDatabaseLevel(): Promise<DatabaseLevel> {
  try {
    const client = await createServerSupabaseClient()
    if (!client) throw new DatabaseLevelError()
    const probes = await Promise.all(MODULE_TABLES.map(table => probe(client, table)))
    const { level, uncertain } = levelFromProbes(probes)
    if (uncertain) throw new DatabaseLevelError()
    // También se comprueban columnas y relaciones usadas por la cartera, sin traer filas.
    // Que falte el módulo no demuestra que el esquema base esté completo.
    if (level === 'CON_MODULO') return level
    const base = await Promise.all(Object.values(EQUITAS_TABLE_NAMES).map(table =>
      client.from(table).select(tenantReadScope(table, '0')!.select).limit(0)))
    if (base.some(result => result.error || result.status < 200 || result.status >= 300)) throw new DatabaseLevelError()
    return level
  } catch {
    // Nunca registrar mensajes de PostgREST: pueden contener datos de filas.
    console.error('Nivel de base incierto: NIVEL_INDETERMINADO')
    throw new DatabaseLevelError()
  }
}

// Al renderizar una página, React comparte el resultado dentro de esa solicitud. En una ruta de reporte o en una
// acción de servidor no hay memoización: el nivel se comprueba en cada llamada. Nada se guarda entre solicitudes.
export const loadDatabaseLevel = cache(readDatabaseLevel)

/** Comprueba también esquemas parciales aunque la primera lectura haya salido bien. */
export async function levelAfter(..._warnings: readonly ({ code?: string } | null | undefined)[]): Promise<DatabaseLevel> {
  return loadDatabaseLevel()
}
