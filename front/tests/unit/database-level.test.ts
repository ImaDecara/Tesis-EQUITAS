import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { serverClient } = vi.hoisted(() => ({ serverClient: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: serverClient }))

import { levelFromProbes, loadDatabaseLevel, MODULE_TABLES, TABLE_NOT_IN_SCHEMA, type TableProbe } from '@/lib/server/database-level'

const missing: TableProbe = { status: 404, error: { code: 'PGRST205' } }
const present: TableProbe = { status: 200, error: null }

// Cliente mínimo: cada tabla responde lo que diga el mapa; registra qué se consultó y cómo.
function client(answers: Record<string, TableProbe | Error>) {
  const calls: Array<{ table: string; select: string; limit: number }> = []
  serverClient.mockResolvedValue({
    from: (table: string) => ({
      select: (select: string) => ({
        limit: async (limit: number) => {
          calls.push({ table, select, limit })
          const answer = answers[table] ?? present
          if (answer instanceof Error) throw answer
          return { data: answer.error ? null : [], status: answer.status, error: answer.error }
        },
      }),
    }),
  })
  return calls
}
const all = (probe: TableProbe) => Object.fromEntries(MODULE_TABLES.map(table => [table, probe]))

describe('nivel de la base (encargo 10.2)', () => {
  afterEach(() => { vi.restoreAllMocks(); serverClient.mockReset() })

  it('BASE solo cuando faltan las cuatro tablas del módulo, con la respuesta exacta de «no está en el esquema»', () => {
    expect(levelFromProbes([missing, missing, missing, missing])).toEqual({ level: 'BASE', uncertain: false })
    expect(levelFromProbes([present, present, present, present])).toEqual({ level: 'CON_MODULO', uncertain: false })
    // Una mezcla, otro código, otro estado HTTP o una lista incompleta nunca son BASE.
    for (const probes of [
      [missing, missing, missing, present],
      [missing, missing, missing, { status: 404, error: { code: '42P01' } }],
      [missing, missing, missing, { status: 400, error: { code: 'PGRST205' } }],
      [missing, missing, missing, { status: 503, error: { code: 'PGRST002' } }],
      [missing, missing, missing, { error: null }],
      [missing, missing, missing],
      [],
    ] satisfies TableProbe[][]) {
      expect(levelFromProbes(probes)).toEqual({ level: 'CON_MODULO', uncertain: true })
    }
  })

  it('con el módulo presente alcanza una consulta sin filas y no deja nada en el registro', async () => {
    const calls = client({})
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(loadDatabaseLevel()).resolves.toBe('CON_MODULO')
    expect(calls).toEqual([{ table: 'import_batch', select: 'id', limit: 0 }])
    expect(log).not.toHaveBeenCalled()
  })

  it('sin el módulo consulta las cuatro tablas y responde BASE', async () => {
    const calls = client(all(missing))
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(loadDatabaseLevel()).resolves.toBe('BASE')
    expect(calls.map(call => call.table).sort()).toEqual([...MODULE_TABLES].sort())
    expect(calls.every(call => call.select === 'id' && call.limit === 0)).toBe(true)
    expect(log).not.toHaveBeenCalled()
  })

  it.each([
    ['falta una sola tabla', { ...all(present), import_batch: missing }],
    ['faltan tres y una existe', { ...all(missing), access_audit: present }],
    ['una responde otro error', { ...all(missing), case_review: { status: 503, error: { code: 'PGRST002' } } }],
  ])('ante la duda es CON_MODULO y queda un código en el registro, sin nombres de tabla: %s', async (_, answers) => {
    client(answers)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(loadDatabaseLevel()).resolves.toBe('CON_MODULO')
    expect(log).toHaveBeenCalledWith('Nivel de base incierto: NIVEL_INDETERMINADO')
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/import_batch|case_review|access_audit/)
  })

  it('una falla de conexión o un servicio sin configurar no se leen como «falta el módulo»', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    client({ ...all(missing), case_review_approval: new Error('ECONNRESET') })
    await expect(loadDatabaseLevel()).resolves.toBe('CON_MODULO')
    expect(log).toHaveBeenCalledWith('Nivel de base incierto: SIN_CONEXION')
    client({ import_batch: { status: 0, error: { code: '' } } })
    await expect(loadDatabaseLevel()).resolves.toBe('CON_MODULO')
    serverClient.mockResolvedValue(null)
    await expect(loadDatabaseLevel()).resolves.toBe('CON_MODULO')
  })

  it('el código de «tabla fuera del esquema» vive en un solo archivo de la aplicación', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const holders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.tsx?$/.test(name) && readFileSync(path, 'utf8').includes(TABLE_NOT_IN_SCHEMA.code)) holders.push(path.slice(root.length))
      }
    }
    for (const dir of ['app', 'components', 'lib']) walk(join(root, dir))
    expect(holders).toEqual(['lib/server/database-level.ts'])
  })
})
