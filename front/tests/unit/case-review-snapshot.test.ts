import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { computeInputsHash, selectCurrentCutoff, type BatchEvent } from '@/lib/server/case-review-snapshot'
import { debtorReadScope, tenantReadScope, type DebtorScopedTable } from '@/lib/server/tenant-read-scope'
import type { DecisionInput } from '@/lib/domain/decision-rules-v1'

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
