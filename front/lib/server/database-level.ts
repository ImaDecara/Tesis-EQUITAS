import 'server-only'

import { cache } from 'react'

import { createServerSupabaseClient } from '@/lib/supabase-server'

// Noche 7 (encargo 10.2). Nivel de la base: se deduce de lo que la base tiene, con una sola
// comprobación por solicitud y sin banderas de configuración.
//
// BASE: la base no tiene el módulo de decisiones y auditoría (como la original hoy). La aplicación
// muestra la cartera y no escribe nada. CON_MODULO: todo lo demás, incluido «no se pudo saber».
// Ante la duda el nivel es CON_MODULO, y ahí la auditoría sigue fallando cerrada.
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
  return { level: 'CON_MODULO', uncertain: probes.length !== MODULE_TABLES.length || probes.some(probe => probe.error !== null) }
}

type Client = NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>

// GET sin filas: no lee datos y no depende de las políticas de lectura.
const probe = async (client: Client, table: string): Promise<TableProbe> => {
  const { status, error } = await client.from(table).select('id').limit(0)
  return { status, error: error ? { code: error.code } : null }
}

async function readDatabaseLevel(): Promise<DatabaseLevel> {
  try {
    const client = await createServerSupabaseClient()
    if (!client) return 'CON_MODULO'
    // Con el módulo presente alcanza una consulta: si la primera tabla existe, no es BASE.
    const first = await probe(client, MODULE_TABLES[0])
    if (!isMissing(first)) return 'CON_MODULO'
    const rest = await Promise.all(MODULE_TABLES.slice(1).map(table => probe(client, table)))
    const { level, uncertain } = levelFromProbes([first, ...rest])
    // Sin nombres de tabla ni mensajes de la base: solo el hecho.
    if (uncertain) console.error('Nivel de base incierto: NIVEL_INDETERMINADO')
    return level
  } catch {
    console.error('Nivel de base incierto: SIN_CONEXION')
    return 'CON_MODULO'
  }
}

// Al renderizar una página, React comparte el resultado dentro de esa solicitud. En una ruta de reporte o en una
// acción de servidor no hay memoización: el nivel se comprueba en cada llamada. Nada se guarda entre solicitudes.
export const loadDatabaseLevel = cache(readDatabaseLevel)

/**
 * Para no agregar una consulta a cada solicitud: las lecturas normales de las tablas del módulo ya dicen si
 * algo falta. Solo cuando una de ellas respondió «la tabla no está en el esquema» se hace la comprobación
 * completa de las cuatro. Cualquier otro resultado es CON_MODULO sin consultar nada más.
 */
export async function levelAfter(warning: { code?: string } | null | undefined): Promise<DatabaseLevel> {
  return warning?.code === TABLE_NOT_IN_SCHEMA.code ? loadDatabaseLevel() : 'CON_MODULO'
}

