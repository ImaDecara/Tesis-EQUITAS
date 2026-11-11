import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDebtorsData, session } = vi.hoisted(() => ({ getDebtorsData: vi.fn(), session: { viewer: vi.fn(), decisions: vi.fn() } }))
vi.mock('@/lib/equitas-data', () => ({ getDebtorsData }))
vi.mock('@/lib/server/viewer-context', async original => ({ ...(await original<typeof import('@/lib/server/viewer-context')>()), loadViewerContext: session.viewer }))
vi.mock('@/lib/server/recorded-decisions', async original => ({ ...(await original<typeof import('@/lib/server/recorded-decisions')>()), loadRecordedDecisions: session.decisions }))
vi.mock('next/navigation', () => ({ usePathname: () => '/priority-cases', useRouter: () => ({ replace: () => undefined }) }))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))

import PriorityCasesPage from '@/app/priority-cases/page'
import { queueParam, selectQueueGroup, buildRecommendationSummary } from '@/lib/equitas-view-selectors'
import { INTERVENTION_CODES } from '@/lib/services/debtor-recommendation-generator'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import type { DataWarning, RawDebtorDataBundle, RawRow } from '@/types/equitas-domain'
import { decisionsFixture, recordedDecision, viewerFixture } from '@/tests/helpers/viewer-fixtures'

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" }
const markupOf = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node))
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|#x27);/g, entity => ENTITIES[entity]).replace(/\s+/g, ' ').trim()

// Lote con corte declarado y datos evaluables: VALIDADO, no bloqueado. Un objeto por regla.
//   SIN-CONTACTO -> Mejorar datos
//   PRESCRIPCION -> Revisión jurídica (más de 1825 días)
//   ALTA-1 y ALTA-2 -> Contacto y plan (ALTA-2 con más puntos)
//   MEDIA -> Recordatorio
//   BAJA -> Seguimiento
const AS_OF = '2026-10-30'
function raw(): RawDebtorDataBundle {
  const debtor = (id: number, identifier: string): RawRow => ({ id, tenant: 7, external_id: id, type: 1, identifier, status: true })
  const debt = (id: number, amount: number, due: string): RawRow => ({ id, debtor: id, external_id: id, current_amount: amount, status: 1, due_date: due })
  const objects: [number, string, number, string][] = [
    [1, 'SIN-CONTACTO', 900000, '2026-01-01'],
    [2, 'PRESCRIPCION', 900000, '2019-01-01'],
    [3, 'ALTA-1', 2000000, '2026-01-01'],
    [4, 'ALTA-2', 2000000, '2025-06-01'],
    [5, 'MEDIA', 300000, '2026-09-01'],
    [6, 'BAJA', 100, '2026-10-29'],
  ]
  return {
    batch: { as_of: AS_OF, source_updated_at: AS_OF },
    debtors: objects.map(([id, identifier]) => debtor(id, identifier)),
    debtorTypes: [{ id: 1, key: 'TP', value: 'Inmueble' }],
    debts: objects.map(([id, , amount, due]) => debt(id, amount, due)),
    debtStatuses: [{ id: 1, key: 'OVERDUE', value: 'Vencida' }],
    debtorPeople: objects.map(([id]) => ({ id, debtor: id, person: id, priority: 100, active: true })),
    people: objects.map(([id, identifier]) => ({ id, external_id: id, full_name: `Persona ${identifier}` })),
    debtorContacts: objects.filter(([id]) => id !== 1).map(([id]) => ({ id, person: id, type: 1, value: `c${id}@example.test`, active: true })),
    debtorProfiles: [],
    warnings: [],
  }
}

async function open(search: Record<string, string> = {}, bundle = raw()) {
  const mapped = mapDebtorObjectsFromRawData(bundle)
  getDebtorsData.mockResolvedValue({ debtors: mapped.debtors, warnings: bundle.warnings })
  const markup = markupOf(await PriorityCasesPage({ searchParams: Promise.resolve(search) }))
  return { markup, text: textOf(markup), mapped }
}
const queueLinks = (markup: string) => [...markup.matchAll(/<a\b([^>]*\bdata-queue="([^"]*)"[^>]*)>(.*?)<\/a>/g)]
  .map(([, attributes, queue, inner]) => ({ href: (/\bhref="([^"]*)"/.exec(attributes)?.[1] ?? '').replace(/&amp;/g, '&'), queue, text: textOf(inner) }))

beforeEach(() => {
  vi.clearAllMocks()
  session.viewer.mockResolvedValue(viewerFixture())
  session.decisions.mockResolvedValue(decisionsFixture())
})

describe('grupos de trabajo', () => {
  it('los cinco grupos del contrato, en su orden, con su contador en singular o plural', async () => {
    const { markup } = await open()
    expect(queueLinks(markup).map(link => link.queue)).toEqual(INTERVENTION_CODES)
    expect(queueLinks(markup).map(link => link.text)).toEqual([
      'Mejorar datos 1 caso', 'Revisión jurídica 1 caso', 'Contacto y plan 2 casos', 'Recordatorio 1 caso', 'Seguimiento 1 caso',
    ])
    expect(markup).toContain('aria-label="Grupos de trabajo"')
  })

  // N7: «Grupos de trabajo» reemplaza a «Casos prioritarios» y «cola»; un solo rótulo de puntaje.
  it('el título, el total y un solo concepto de puntaje', async () => {
    const { text, markup } = await open()
    expect(text).toContain('Grupos de trabajo')
    expect(text).toContain('Filtros')
    expect(text).toContain('6 casos')
    expect(text).toContain('Puntaje de prioridad')
    expect(text).toContain('no es una probabilidad de pago')
    expect(text).not.toMatch(/Severidad|Prioridad \(puntos|Cola:|Casos prioritarios/)
    // El puntaje de cada fila es «valor · banda»: SIN-CONTACTO tiene 90 + 30 de atraso y 5 de cantidad.
    expect(markup).toMatch(/data-score="true"[^>]*>\d+ · (Alta|Media|Baja)</)
  })

  it('muestra el criterio de cada grupo, en el orden en que se aplica', async () => {
    const { markup } = await open()
    const criteria = [...(/data-group-criteria[\s\S]*?<\/ol>/.exec(markup)?.[0] ?? '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map(match => textOf(match[1]))
    expect(criteria).toEqual([
      'Si el caso no tiene un contacto activo cargado: Mejorar datos .',
      'Si el puntaje no se puede calcular porque faltan importes o vencimientos: Mejorar datos .',
      'Si alguna obligación vencida tiene 1.825 días o más de atraso: Revisión jurídica .',
      'Si puntaje en banda alta (desde 70): Contacto y plan .',
      'Si puntaje en banda media (de 40 a 69): Recordatorio .',
      'Si puntaje en banda baja (menos de 40): Seguimiento .',
    ])
    expect(textOf(markup)).toContain('gana la primera que se cumple')
    expect(textOf(markup)).toContain('No es clustering ni aprendizaje automático')
  })

  it('no presenta un ranking global: entre colas no se compara', async () => {
    const { text } = await open()
    expect(text).not.toContain('Ranking operativo')
    expect(text).toContain('los puntajes de grupos distintos no se comparan')
  })

  it('la suma de los grupos coincide con el contador total', async () => {
    const { markup, text } = await open()
    // N7: plural correcto («1 caso»).
    const total = queueLinks(markup).reduce((sum, link) => sum + Number(/(\d+) casos?\b/.exec(link.text)?.[1]), 0)
    expect(total).toBe(Number(/(\d+) casos/.exec(text)?.[1]))
  })

  it('sin grupo elegido abre el primero con casos', async () => {
    const { text, markup } = await open()
    expect(text).toContain('Grupo: Mejorar datos')
    expect(text).toContain('SIN-CONTACTO')
    expect(text).not.toContain('ALTA-1')
    expect(markup).toMatch(/aria-current="page"[^>]*data-queue="MEJORAR_DATOS"|data-queue="MEJORAR_DATOS"[^>]*aria-current="page"/)
  })

  it('un valor desconocido se trata igual', async () => {
    expect((await open({ queue: 'INVENTADA' })).text).toContain('Grupo: Mejorar datos')
    expect((await open({ queue: '__proto__' })).text).toContain('Grupo: Mejorar datos')
  })

  it('cada grupo muestra solo los suyos, ordenados por su puntaje', async () => {
    const { text } = await open({ queue: 'CONTACTO_PERSONAL_Y_PLAN' })
    expect(text).toContain('Grupo: Contacto y plan')
    expect(text.indexOf('ALTA-2')).toBeGreaterThan(-1)
    expect(text.indexOf('ALTA-2')).toBeLessThan(text.indexOf('ALTA-1'))
    expect(text).not.toContain('SIN-CONTACTO')
    expect(text).not.toContain('PRESCRIPCION')
  })

  it('un grupo vacío elegido lo dice y no salta a otro', async () => {
    const bundle = raw()
    bundle.debts = bundle.debts.filter(row => row.id !== 6)
    bundle.debtors = bundle.debtors.filter(row => row.id !== 6)
    const { text } = await open({ queue: 'SEGUIMIENTO' }, bundle)
    expect(text).toContain('Grupo: Seguimiento')
    expect(text).toContain('Este grupo no tiene casos.')
    // Con filtros, el vacío es válido y ofrece limpiarlos.
    const filtered = await open({ queue: 'SEGUIMIENTO', q: 'nadie' }, bundle)
    expect(filtered.text).toContain('No hay casos que cumplan los filtros elegidos. Limpiar filtros')
    expect(filtered.markup).toMatch(/href="\/priority-cases\?queue=SEGUIMIENTO"[^>]*>Limpiar filtros/)
  })

  // N7 (H15): el identificador es el enlace al caso (antes había un botón aparte al final de la fila).
  it('el identificador abre el caso en la pestaña Revisión', async () => {
    const { markup } = await open({ queue: 'RECORDATORIO_INFORMATIVO' })
    expect(markup).toMatch(/href="\/debtors\/5\?queue=RECORDATORIO_INFORMATIVO&amp;tab=revision"[^>]*>MEDIA<\/a>/)
    expect(markup).not.toContain('Abrir revisión')
  })
})

describe('los filtros se conservan', () => {
  const SEARCH = { q: 'alta', risk: 'ALTO', contact: 'with', type: 'Inmueble', minAmount: '1000' }

  it('el formulario mantiene la cola y los valores', async () => {
    const { markup } = await open({ ...SEARCH, queue: 'CONTACTO_PERSONAL_Y_PLAN' })
    expect(markup).toMatch(/<input[^>]*type="hidden"[^>]*name="queue"[^>]*value="CONTACTO_PERSONAL_Y_PLAN"|<input[^>]*name="queue"[^>]*type="hidden"[^>]*value="CONTACTO_PERSONAL_Y_PLAN"/)
    expect(markup).toContain('value="alta"')
  })

  it('sin cola elegida el formulario no la fija: buscar encuentra casos de cualquier cola', async () => {
    const { markup } = await open()
    expect(markup).not.toContain('name="queue"')
    expect(markup).toMatch(/href="\/priority-cases"[^>]*>Limpiar/)
    const found = await open({ q: 'media' })
    expect(found.text).toContain('Grupo: Recordatorio')
    expect(found.markup).toContain('href="/debtors/5?q=media&amp;queue=RECORDATORIO_INFORMATIVO&amp;tab=revision"')
  })

  it('una cola inventada tampoco se conserva', async () => {
    expect((await open({ queue: 'INVENTADA' })).markup).not.toContain('name="queue"')
  })

  it('cambiar de cola conserva los filtros y vuelve a la primera página', async () => {
    const { markup } = await open({ ...SEARCH, page: '2', pageSize: '20', queue: 'CONTACTO_PERSONAL_Y_PLAN' })
    const link = queueLinks(markup).find(item => item.queue === 'RECORDATORIO_INFORMATIVO')!
    const params = new URL(link.href, 'http://x').searchParams
    expect(Object.fromEntries(params)).toEqual({ ...SEARCH, pageSize: '20', queue: 'RECORDATORIO_INFORMATIVO' })
  })

  it('la paginación conserva cola y filtros', async () => {
    const bundle = raw()
    for (let id = 100; id < 112; id += 1) {
      bundle.debtors.push({ id, tenant: 7, external_id: id, type: 1, identifier: `ALTA-${id}`, status: true })
      bundle.debts.push({ id, debtor: id, external_id: id, current_amount: 2000000, status: 1, due_date: '2026-01-01' })
      bundle.debtorPeople.push({ id, debtor: id, person: id, priority: 100, active: true })
      bundle.people.push({ id, external_id: id, full_name: `Persona ${id}` })
      bundle.debtorContacts.push({ id, person: id, type: 1, value: `c${id}@example.test`, active: true })
    }
    const { markup } = await open({ q: 'alta', queue: 'CONTACTO_PERSONAL_Y_PLAN', pageSize: '10' }, bundle)
    expect(markup.replace(/&amp;/g, '&')).toContain('href="/priority-cases?q=alta&queue=CONTACTO_PERSONAL_Y_PLAN&page=2"')
  })

  it('el contador de cada cola respeta los filtros', async () => {
    const { markup, text } = await open({ q: 'alta' })
    expect(queueLinks(markup).map(link => link.text)).toEqual([
      'Mejorar datos 0 casos', 'Revisión jurídica 0 casos', 'Contacto y plan 2 casos', 'Recordatorio 0 casos', 'Seguimiento 0 casos',
    ])
    expect(text).toContain('Grupo: Contacto y plan')
    expect(text).toContain('2 casos')
    expect(text).toContain('Mostrando 2 de 6 casos según los filtros.')
  })

  it('Limpiar quita los filtros y conserva la cola', async () => {
    const { markup } = await open({ ...SEARCH, queue: 'RECORDATORIO_INFORMATIVO' })
    expect(markup).toMatch(/href="\/priority-cases\?queue=RECORDATORIO_INFORMATIVO"[^>]*>Limpiar/)
  })

  it('un filtro de monto inválido se sigue informando', async () => {
    expect((await open({ minAmount: 'abc' })).text).toContain('Monto mínimo inválido')
  })

  it('cada filtro tiene un nombre accesible', async () => {
    const { markup } = await open()
    for (const [name, label] of [['risk', 'Puntaje de prioridad'], ['contact', 'Contacto'], ['type', 'Tipo'], ['q', 'Buscar por identificador o persona'], ['minAmount', 'Total registrado mínimo']]) {
      const tag = new RegExp(`<(?:select|input)[^>]*name="${name}"[^>]*>`).exec(markup)?.[0] ?? ''
      const id = /\bid="([^"]+)"/.exec(tag)?.[1]
      expect(id, name).toBeTruthy()
      expect(markup).toMatch(new RegExp(`<label[^>]*for="${id}"[^>]*>\\s*${label}`))
    }
  })
})

describe('datos faltantes', () => {
  const warning = (table: string): DataWarning => ({ table, message: 'Fallo sintético', needsSelectPolicy: false })

  it('una lectura fallida: contadores "No disponible", nunca 0, y los objetos siguen visibles', async () => {
    const bundle = raw()
    bundle.warnings = [warning('debt')]
    const { markup, text } = await open({}, bundle)
    for (const link of queueLinks(markup).filter(item => item.queue !== 'SIN_COLA')) {
      expect(link.text).toMatch(/No disponible$/)
      expect(link.text).not.toMatch(/No disponible casos/)
    }
    expect(queueLinks(markup).find(link => link.queue === 'SIN_COLA')?.text).toBe('No disponible 6 casos')
    expect(text).toContain('Grupo: No disponible')
    expect(text).toContain('No se pudieron leer algunos datos')
    expect(text).toContain('ALTA-1')
  })

  it('sin la tabla de objetos: tampoco inventa colas vacías', async () => {
    const bundle = raw()
    bundle.warnings = [warning('debtor')]
    bundle.debtors = []
    const { markup, text } = await open({}, bundle)
    expect(queueLinks(markup).find(link => link.queue === 'SEGUIMIENTO')?.text).toBe('Seguimiento No disponible')
    expect(text).not.toMatch(/\b0 casos/)
  })

  it('el grupo «No disponible» se oculta vacío, y un caso sin decisión no vacía los demás grupos', async () => {
    expect(queueLinks((await open()).markup).some(link => link.queue === 'SIN_COLA')).toBe(false)
    const bundle = raw()
    const mapped = mapDebtorObjectsFromRawData(bundle)
    mapped.debtors[0] = { ...mapped.debtors[0], decision: null }
    getDebtorsData.mockResolvedValue({ debtors: mapped.debtors, warnings: [] })
    const markup = markupOf(await PriorityCasesPage({ searchParams: Promise.resolve({ q: 'sin-contacto' }) }))
    const links = queueLinks(markup)
    expect(links.find(link => link.queue === 'SIN_COLA')?.text).toBe('No disponible 1 caso')
    expect(links.find(link => link.queue === 'SEGUIMIENTO')?.text).toBe('Seguimiento 0 casos')
  })
})

describe('selección de cola', () => {
  const groups = buildRecommendationSummary(mapDebtorObjectsFromRawData(raw()).debtors)

  it('queueParam distingue el grupo sin cola', () => {
    expect(queueParam(groups[0])).toBe(INTERVENTION_CODES[0])
    expect(queueParam(groups.at(-1)!)).toBe('SIN_COLA')
  })

  it('sin ningún caso cae en la primera', () => {
    const empty = groups.map(group => ({ ...group, cases: [] }))
    expect(selectQueueGroup(empty, undefined)).toBe(empty[0])
  })
})

describe('N7: decisión registrada en el grupo', () => {
  it('vigente, sobre datos anteriores, sin decisión e ilegible', async () => {
    session.decisions.mockResolvedValue(decisionsFixture([
      recordedDecision('3', { status: 'PENDIENTE_APROBACION', decidedIntervention: 'CONTACTO_PERSONAL_Y_PLAN', decidedIntensity: 3 }),
      recordedDecision('4', { stale: true, asOf: '2026-08-31' }),
    ]))
    const { markup, text } = await open({ queue: 'CONTACTO_PERSONAL_Y_PLAN' })
    const row = (identifier: string) => textOf(new RegExp(`<tr[^>]*>(?:(?!</tr>).)*>${identifier}</a>(?:(?!</tr>).)*</tr>`).exec(markup)?.[0] ?? '')
    expect(text).toContain('Decisión registrada')
    expect(row('ALTA-1')).toContain('Propuesta pendiente de aprobación')
    expect(row('ALTA-2')).toContain('Decisión registrada')
    expect(row('ALTA-2')).toContain('Registrada sobre datos anteriores')
    expect(row('ALTA-1')).not.toContain('Registrada sobre datos anteriores')
    expect(markup.match(/data-decision="recorded"/g)).toHaveLength(2)

    const none = await open({ queue: 'SEGUIMIENTO' })
    expect(none.markup).toContain('data-decision="none"')
    expect(none.text).not.toContain('No se pudieron leer las decisiones')

    session.decisions.mockResolvedValue({ ok: false, reason: 'UNAVAILABLE' })
    const unreadable = await open({ queue: 'SEGUIMIENTO' })
    expect(unreadable.markup).toContain('data-decision="unavailable"')
    expect(unreadable.markup).not.toContain('data-decision="none"')
    expect(unreadable.text).toContain('No se pudieron leer las decisiones registradas')
  })
})

describe('N7: municipio sin cartera cargada', () => {
  it.each([['ADMIN', true], ['USER', false]] as const)('%s ve una sola tarjeta, sin grupos ni ceros', async (role, canImport) => {
    session.viewer.mockResolvedValue(viewerFixture(role, { kind: 'EMPTY' }))
    const { markup, text } = await open()
    expect(text).toContain('Tu municipio todavía no tiene una cartera cargada')
    expect(markup.match(/data-portfolio-state=/g)).toHaveLength(1)
    expect(queueLinks(markup)).toEqual([])
    expect(text).not.toMatch(/\b0 casos|\$\s*0|Descargar CSV/)
    expect(markup.includes('href="/import"')).toBe(canImport)
    expect(text.includes('Pedile a una persona administradora que la cargue')).toBe(!canImport)
    expect(getDebtorsData).not.toHaveBeenCalled()
  })
})
