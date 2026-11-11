import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FRONT = fileURLToPath(new URL('../..', import.meta.url))

// Tokens que abren una lectura de datos. `Array.from(` no consulta nada y queda fuera.
const FORBIDDEN = {
  createServerSupabaseClient: /\bcreateServerSupabaseClient\b/,
  loadAllTableRows: /\bloadAllTableRows\b/,
  '.from(': /(?<!\bArray)\.\s*from\s*\(/,
} as const
type Token = keyof typeof FORBIDDEN
const TOKENS = Object.keys(FORBIDDEN) as Token[]

// La autoridad es la DAL. Las dos ultimas entradas son solo las definiciones que ella usa.
function allowedTokens(path: string): readonly Token[] {
  if (path.startsWith('lib/server/') || path === 'lib/auth/tenant-access.ts') return TOKENS
  if (path === 'lib/supabase-server.ts') return ['createServerSupabaseClient']
  if (path === 'lib/data/paginated-table-reader.ts') return ['loadAllTableRows', '.from(']
  return []
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry) ? [path] : []
  })
}

function violations(path: string, source: string) {
  return TOKENS.filter(token => FORBIDDEN[token].test(source) && !allowedTokens(path).includes(token))
    .map(token => `${path}: ${token}`)
}

describe('ALIGN-019 M5: ninguna lectura de datos por fuera de la DAL', () => {
  const files = [...['app', 'components', 'lib'].flatMap(root => sourceFiles(join(FRONT, root))), join(FRONT, 'proxy.ts')]
    .map(path => relative(FRONT, path))

  it('recorre todas las rutas y servicios, no una lista vacia', () => {
    expect(files).toEqual(expect.arrayContaining([
      'app/page.tsx', 'app/debtors/[debtorId]/page.tsx', 'app/people/page.tsx', 'app/api/build-info/route.ts',
      'lib/services/debtor-data-service.ts', 'lib/services/person-data-service.ts', 'lib/data/raw-debtor-loader.ts',
      'components/layout/app-shell.tsx', 'lib/server/dal.ts', 'lib/auth/tenant-access.ts', 'proxy.ts',
    ]))
  })

  it('app, components, lib y proxy respetan la frontera', () => {
    expect(files.flatMap(path => violations(path, readFileSync(join(FRONT, path), 'utf8')))).toEqual([])
  })

  it('la DAL y el resolvedor de acceso siguen siendo quienes leen', () => {
    const dal = readFileSync(join(FRONT, 'lib/server/dal.ts'), 'utf8')
    const access = readFileSync(join(FRONT, 'lib/auth/tenant-access.ts'), 'utf8')
    expect(FORBIDDEN.createServerSupabaseClient.test(dal)).toBe(true)
    expect(FORBIDDEN.loadAllTableRows.test(dal)).toBe(true)
    expect(FORBIDDEN['.from('].test(access)).toBe(true)
  })

  it.each([
    ['app/nueva/page.tsx', "const sb = await createServerSupabaseClient()", 'createServerSupabaseClient'],
    ['app/nueva/page.tsx', "import { loadAllTableRows } from '@/lib/data/paginated-table-reader'", 'loadAllTableRows'],
    ['app/nueva/page.tsx', "await supabase.from('debtor').select('*')", '.from('],
    ['lib/services/nuevo.ts', "supabase\n  .from('debt')\n  .select('*')", '.from('],
    ['lib/services/nuevo.ts', "supabase?.from('person')", '.from('],
    ['components/nuevo.tsx', "client.from ('debtor_contact')", '.from('],
    ['lib/auth/otro.ts', "supabase.from('debtor')", '.from('],
    ['lib/supabase-server.ts', "supabase.from('debtor')", '.from('],
    ['lib/data/paginated-table-reader.ts', 'createServerSupabaseClient()', 'createServerSupabaseClient'],
  ])('detecta una lectura nueva en %s: %s', (path, source, token) => {
    expect(violations(path, source)).toEqual([`${path}: ${token}`])
  })

  it.each([
    ['lib/services/nuevo.ts', 'Array.from(mapa.values())'],
    ['app/nueva/page.tsx', 'const lista = Array.from({ length: 4 })'],
    ['lib/server/nuevo.ts', "supabase.from('debtor'); createServerSupabaseClient(); loadAllTableRows()"],
  ])('no marca lo permitido en %s', (path, source) => {
    expect(violations(path, source)).toEqual([])
  })
})
