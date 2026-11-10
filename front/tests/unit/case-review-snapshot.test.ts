import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

// Solo para el cliente sintético de las pruebas de lectura: no hay credenciales reales.
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))

import smallCases from '../../../contracts/portfolio-small-cases.v1.json'
import { computeCaseReviewSnapshot, computeInputsHash, selectCurrentCutoff, type BatchEvent } from '@/lib/server/case-review-snapshot'
import { debtorReadScope, tenantReadScope, type DebtorScopedTable } from '@/lib/server/tenant-read-scope'
import { RULES_VERSION, type DecisionInput } from '@/lib/domain/decision-rules-v1'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { createPaginatedSupabase } from '@/tests/fixtures/paginated-supabase'

const observed = <T,>(valor: T) => ({ estado: 'OBSERVADO', valor }) as const
const absent = { estado: 'NO_INTEGRADO', valor: null } as const
const obligation = (id: string, amount: number) => ({
  id, current_amount: observed(amount), due_date: observed('2026-01-01'), estado_origen: absent, periodo_fiscal: absent,
})
const input: DecisionInput = {
  id: '99', as_of: '2026-10-30', source_updated_at: absent, contactos_activos: observed(1),
  vulnerabilidad: { estado: 'NO_INFORMADO_EN_ORIGEN', valor: null },
  obligaciones: [obligation('10', 100), obligation('9', 200.5)],
  personas: [
    { tipo: observed('FISICA'), porcentaje_declarado: observed(60) },
    { tipo: observed('JURIDICA'), porcentaje_declarado: observed(40) },
  ],
}

describe('ALIGN-020: hash de insumos', () => {
  it('no depende del orden de obligaciones, de personas ni de las claves', () => {
    const shuffled: DecisionInput = {
      vulnerabilidad: input.vulnerabilidad, personas: [...input.personas].reverse(), obligaciones: [...input.obligaciones].reverse(),
      contactos_activos: input.contactos_activos, source_updated_at: input.source_updated_at, as_of: input.as_of, id: input.id,
    }
    expect(computeInputsHash(shuffled)).toBe(computeInputsHash(input))
  })

  it('cambia con cada insumo que evalúan las reglas', () => {
    const base = computeInputsHash(input)
    const changes: DecisionInput[] = [
      { ...input, id: '100' },
      { ...input, as_of: '2026-10-31' },
      { ...input, source_updated_at: observed('2026-10-29') },
      { ...input, contactos_activos: observed(0) },
      { ...input, vulnerabilidad: observed('SIN_INDICIO') },
      { ...input, obligaciones: [obligation('10', 100)] },
      { ...input, obligaciones: [obligation('10', 100.01), obligation('9', 200.5)] },
      { ...input, personas: [input.personas[0]] },
      { ...input, personas: [{ ...input.personas[0], porcentaje_declarado: observed(61) }, input.personas[1]] },
      // Reglas 1.1.0: el estado de catálogo es parte de lo evaluado.
      { ...input, obligaciones: [{ ...obligation('10', 100), estado_catalogo: observed('PAID') }, obligation('9', 200.5)] },
      { ...input, obligaciones: [{ ...obligation('10', 100), estado_catalogo: observed('OVERDUE') }, obligation('9', 200.5)] },
    ]
    const hashes = changes.map(computeInputsHash)
    expect(new Set([base, ...hashes]).size).toBe(changes.length + 1)
  })

  it('un nulo y un cero no dan el mismo hash: el faltante no es 0', () => {
    expect(computeInputsHash({ ...input, contactos_activos: absent })).not.toBe(computeInputsHash({ ...input, contactos_activos: observed(0) }))
  })

  it('es el SHA-256 hexadecimal de la forma canónica', () => {
    const bare: DecisionInput = { ...input, obligaciones: [], personas: [] }
    const canonical = '{"as_of":"2026-10-30","contactos_activos":{"estado":"OBSERVADO","valor":1},"id":"99","obligaciones":[],"personas":[],' +
      '"source_updated_at":{"estado":"NO_INTEGRADO","valor":null},"vulnerabilidad":{"estado":"NO_INFORMADO_EN_ORIGEN","valor":null}}'
    expect(computeInputsHash(bare)).toBe(createHash('sha256').update(canonical).digest('hex'))
  })
})

describe('ALIGN-020: corte vigente del lote', () => {
  const event = (id: number | string, status: string, supersedes: number | string | null = null): BatchEvent =>
    ({ id, as_of: `corte-${id}`, source_updated_at: null, status, supersedes })

  it('toma el ultimo publicado comparando ids como enteros, no como texto', () => {
    expect(selectCurrentCutoff([event(9, 'PUBLICADO'), event(10, 'PUBLICADO')])?.id).toBe(10)
    expect(selectCurrentCutoff([event('900000000000000001', 'PUBLICADO'), event('900000000000000002', 'PUBLICADO')])?.id).toBe('900000000000000002')
  })

  it('un publicado reemplazado deja de regir', () => {
    expect(selectCurrentCutoff([event(1, 'PUBLICADO'), event(2, 'REQUIERE_NUEVO_PREVIEW', 1)])).toBeNull()
  })

  it.each(['VALIDADO', 'CONFIRMADO'])('%s encima de un publicado bloquea: puede estar escribiendo', status => {
    expect(selectCurrentCutoff([event(1, 'PUBLICADO'), event(2, status)])).toBeNull()
  })

  it.each(['RECIBIDO', 'DESCARTADO', 'REQUIERE_NUEVO_PREVIEW'])('%s no tocó la cartera: sigue el publicado anterior', status => {
    expect(selectCurrentCutoff([event(1, 'PUBLICADO'), event(2, status)])?.id).toBe(1)
  })

  it('un estado desconocido no se interpreta como publicado', () => {
    expect(selectCurrentCutoff([event(1, 'OTRO')])).toBeNull()
  })

  it('sin eventos no hay corte', () => {
    expect(selectCurrentCutoff([])).toBeNull()
  })

  it.each(['RECIBIDO', 'VALIDADO', 'FALLIDO', 'DESCARTADO', 'REQUIERE_NUEVO_PREVIEW'])('032: %s atómico conserva el corte publicado', status => {
    const pending = { ...event(3, status, 2), counts: { publicacion_atomica: 1 } }
    expect(selectCurrentCutoff([event(1, 'PUBLICADO'), { ...event(2, 'RECIBIDO'), counts: { publicacion_atomica: 1 } }, pending])?.id).toBe(1)
  })
})

describe('ALIGN-020: alcance de lectura por objeto', () => {
  it.each<[DebtorScopedTable, string]>([
    ['debtor', 'id'], ['debt', 'debtor'], ['debtor_person', 'debtor'], ['person', '__links.debtor'], ['debtor_contact', '__person.__links.debtor'],
  ])('%s conserva el filtro de municipio de la DAL y agrega el objeto', (table, column) => {
    const base = tenantReadScope(table, '7')!
    const scoped = debtorReadScope(table, '7', '99')
    expect(scoped.select).toBe(base.select)
    expect(scoped.filters).toEqual([...base.filters, [column, '99']])
  })
})

describe('reglas 1.1.0: el servidor lee debt_status y calcula lo mismo que la pantalla', () => {
  const reference = smallCases.casos.find(item => item.id === 'CHICO-02')!
  const debtorId = String(reference.objeto.id)
  const holder = reference.titulares[0]
  const tables = () => ({
    debtor: [{ id: reference.objeto.id, tenant: 7, identifier: reference.objeto.identificador }],
    import_batch: [{ id: 1, tenant: 7, as_of: smallCases.fecha_cartera, source_updated_at: null, status: 'PUBLICADO', supersedes: null }],
    debt: reference.obligaciones.map(debt => ({ id: debt.id, debtor: reference.objeto.id, current_amount: String(debt.importe), due_date: debt.vencimiento, status: debt.estado_id })),
    debtor_person: [{ id: 1, debtor: reference.objeto.id, person: holder.id, priority: holder.porcentaje, active: true }],
    person: [{ id: holder.id, full_name: 'Titular sintético' }],
    debtor_contact: holder.contactos.map(contact => ({ id: contact.id, person: holder.id, value: contact.valor, active: true })),
    debt_status: smallCases.catalogo_debt_status,
  })

  it('DEMO6-6-60012: la pagada no cuenta y el hash es el de la pantalla', async () => {
    const rows = tables()
    const { client, requests } = createPaginatedSupabase(rows)
    const result = await computeCaseReviewSnapshot(client, '7', debtorId)
    expect(requests.some(request => request.table === 'debt_status')).toBe(true)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      rulesVersion: RULES_VERSION, asOf: smallCases.fecha_cartera,
      suggestedIntervention: reference.esperado.intervencion, suggestedIntensity: reference.esperado.intensidad,
      explanation: { regla: reference.esperado.regla, severidad: { valor: reference.esperado.puntaje, banda: reference.esperado.banda } },
    })
    const screen = mapDebtorObjectsFromRawData({
      batch: { as_of: smallCases.fecha_cartera, source_updated_at: null }, debtors: rows.debtor, debts: rows.debt,
      debtStatuses: rows.debt_status, debtorPeople: rows.debtor_person, people: rows.person, debtorContacts: rows.debtor_contact,
      debtorTypes: [], debtorProfiles: [], warnings: [],
    }).debtors[0]
    expect(result.value.inputsHash).toBe(computeInputsHash(screen.decisionInput!))
  })

  it('sin el catálogo de estados no hay sugerencia registrable (falla cerrada)', async () => {
    const { client } = createPaginatedSupabase(tables(), { fail: request => request.table === 'debt_status' ? { message: 'permiso denegado' } : null })
    expect(await computeCaseReviewSnapshot(client, '7', debtorId)).toEqual({ ok: false, code: 'SUGGESTION_UNAVAILABLE' })
  })

  it('un catálogo leído sin la clave PAID no convierte la pagada en no pagada en silencio: cambia la decisión y el hash', async () => {
    const complete = await computeCaseReviewSnapshot(createPaginatedSupabase(tables()).client, '7', debtorId)
    const rows = { ...tables(), debt_status: [] }
    const partial = await computeCaseReviewSnapshot(createPaginatedSupabase(rows).client, '7', debtorId)
    expect(complete.ok && partial.ok).toBe(true)
    if (!complete.ok || !partial.ok) return
    expect(partial.value.inputsHash).not.toBe(complete.value.inputsHash)
    expect((partial.value.explanation.severidad as { valor: number }).valor).toBe(50)
  })
})
