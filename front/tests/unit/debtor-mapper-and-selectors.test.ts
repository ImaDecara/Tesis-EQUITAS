import { afterEach, describe, expect, it, vi } from 'vitest'
import golden from '../../../contracts/decision-rules.v1.1.golden.json'
import type { Decision, InterventionCode } from '@/lib/domain/decision-rules-v1'

import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import {
  buildDebtAgingSummary,
  buildRecommendationSummary,
  getHighRiskCases,
  getInterventionCases,
  getNoContactCases,
  sortByOperationalPriority,
} from '@/lib/equitas-view-selectors'
import type { DebtorListItem, RawDebtorDataBundle } from '@/types/equitas-domain'

function buildRawData(): RawDebtorDataBundle {
  return {
    batch: { as_of: '2026-09-30' },
    debtors: [{ id: 1, external_id: 1001, type: 6, identifier: 'AG-1001', status: true }],
    debtorTypes: [{ id: 6, value: 'Agua' }],
    debts: [
      {
        id: 10,
        debtor: 1,
        original_amount: '900000',
        current_amount: '1000000',
        due_date: '2000-01-01',
        debt_status: 2,
        period: '2024-01',
      },
    ],
    debtStatuses: [{ id: 2, value: 'Vencida' }],
    debtorPeople: [{ debtor: 1, person: 50, active: true, role: 'Responsable' }],
    people: [{ id: 50, full_name: 'Ana Perez', document_number: '20123456789' }],
    debtorContacts: [{ id: 70, person: 50, type: 1, value: '3415550000', active: true }],
    debtorProfiles: [
      {
        debtor: 1,
        total_debt_amount: '1000000',
        overdue_debt_amount: '1000000',
        available_contact_count: 1,
        socioeconomic_risk_level: 95,
      },
    ],
    warnings: [],
  }
}

function buildDebtor(overrides: Partial<DebtorListItem>): DebtorListItem {
  return {
    id: '1',
    identifier: 'OBJ-1',
    type: 'Agua',
    description: 'Objeto de prueba',
    status: 'Vencida',
    totalDebt: 100,
    pendingDebt: 100,
    overdueDebt: 100,
    peopleCount: 1,
    peopleIds: ['50'],
    peopleNames: ['Ana Perez'],
    hasContact: true,
    contactCount: 1,
    risk: 'ALTO',
    riskScore: 90,
    debtCount: 1,
    overdueDebtsCount: 1,
    maxDaysOverdue: 120,
    priorityScore: 100,
    priorityLevel: 'MEDIA',
    recommendation: 'Llamado prioritario',
    recommendationType: 'Llamado prioritario',
    recommendationReason: 'Prueba',
    isUrgentRecommendation: true,
    ...overrides,
  }
}

describe('mapeador de objetos de deuda', () => {
  it('materializa relaciones, mora, riesgo y prioridad desde filas crudas', () => {
    const mapped = mapDebtorObjectsFromRawData(buildRawData())

    expect(mapped.debtors).toHaveLength(1)
    expect(mapped.debtors[0]).toMatchObject({
      identifier: 'AG-1001',
      type: 'Agua',
      totalDebt: 1000000,
      overdueDebt: 1000000,
      hasContact: true,
      contactCount: 1,
      risk: 'ALTO',
      riskScore: 85,
      priorityLevel: 'ALTA',
      priorityScore: 85,
      recommendationType: 'Revisión jurídica',
      rulesVersion: '1.1.0',
      decisionAsOf: { estado: 'OBSERVADO', valor: '2026-09-30' },
      decisionAsOfSource: 'MANIFIESTO_LOTE',
    })
    expect(mapped.peopleByDebtor.get('1')?.[0]?.name).toBe('Ana Perez')
    expect(mapped.contactsByDebtor.get('1')?.[0]?.isActive).toBe(true)
  })
})

describe('selectores operativos', () => {
  it('agrupa por intervención antes de ordenar; conserva los casos sin contacto', () => {
    const debtors = golden.casos.map(item => buildDebtor({
      id: item.id, decision: item.esperado as Decision,
      hasContact: item.entrada.contactos_activos.valor !== null && item.entrada.contactos_activos.valor > 0,
    }))

    const sorted = sortByOperationalPriority(debtors)
    const noContact = getNoContactCases(debtors)

    const catalogOrder = ['MEJORAR_DATOS', 'REVISION_JURIDICA', 'CONTACTO_PERSONAL_Y_PLAN', 'RECORDATORIO_INFORMATIVO', 'SEGUIMIENTO']
    expect(sorted.map(debtor => debtor.id)).toEqual(catalogOrder.flatMap(code =>
      golden.ordenamientos.find(queue => queue.cola === code)!.orden_esperado))
    expect(noContact.every(debtor => debtor.hasContact === false)).toBe(true)
    expect(noContact.map(debtor => debtor.id)).toEqual(getInterventionCases(debtors, 'MEJORAR_DATOS')
      .filter(debtor => debtor.hasContact === false).map(debtor => debtor.id))
  })

  it('resume deuda y distribuye atrasos en sus bandas', () => {
    const raw = buildRawData()
    raw.debtorProfiles = []
    raw.debtors = [1, 2, 3].map(id => ({ id, type: 6 }))
    raw.debts = [
      { id: 1, debtor: 1, current_amount: 50, due_date: '2026-10-01' },
      { id: 2, debtor: 2, current_amount: 25, due_date: '2026-08-31' },
      { id: 3, debtor: 2, current_amount: 75, due_date: '2026-10-01' },
      { id: 4, debtor: 3, current_amount: 150, due_date: '2026-06-02' },
      { id: 5, debtor: 3, current_amount: 50, due_date: '2026-10-01' },
    ]
    const debtors = mapDebtorObjectsFromRawData(raw).debtors

    const summary = buildDebtAgingSummary(debtors)

    expect(summary.totalDebt).toBe(350)
    expect(summary.overdueDebt).toBe(175)
    expect(summary.averageOverdueDays).toBe(75)
    expect(summary.agingDistribution).toEqual([
      { label: 'Sin atraso', value: 0 },
      { label: '1-30 dias', value: 1 },
      { label: '31-90 dias', value: 0 },
      { label: '+90 dias', value: 1 },
      { label: 'No aplica', value: 1 },
    ])
  })
})

const calculation = { computedAt: '2026-09-30T12:00:00.000Z' }
const mapOne = (raw = buildRawData()) => mapDebtorObjectsFromRawData(raw, calculation).debtors[0]
afterEach(() => vi.useRealTimers())

describe('ALIGN-010: adaptación y procedencia de los insumos', () => {
  it('no toma puntos ni decisiones del perfil heredado', () => {
    const raw = buildRawData()
    const original = mapOne(raw)
    raw.debtorProfiles = []
    expect(mapOne(raw).decision).toStrictEqual(original.decision)
    raw.debtorProfiles = [{ debtor: 1, socioeconomic_risk_level: 0, total_debt_amount: 0 }]
    expect(mapOne(raw).decision).toStrictEqual(original.decision)
    expect(mapOne(raw).priorityScore).toBe(original.priorityScore)
  })

  it('la falta de contacto solo cambia la intervención y su explicación, no severidad ni prioridad', () => {
    const raw = buildRawData()
    raw.debts[0].due_date = '2026-01-01'
    const withContact = mapOne(raw)
    raw.debtorContacts = []
    const without = mapOne(raw)
    expect(without.decision?.severidad).toStrictEqual(withContact.decision?.severidad)
    expect(without.priorityScore).toBe(withContact.priorityScore)
    expect(without.riskScore).toBe(withContact.riskScore)
    expect(without.decision?.intervencion).toMatchObject({ codigo: 'MEJORAR_DATOS', intensidad: 0, canal_requerido: false })
    expect(withContact.decision?.intervencion.codigo).toBe('CONTACTO_PERSONAL_Y_PLAN')
    expect(without.decision?.mensaje_borrador).toBeNull()
    expect(without.recommendationReason).not.toContain('Lectura de contactos no disponible')
    expect(without.decision?.vulnerabilidad.valor).toBe('NO_INFORMADA')
    expect(without.decision?.revision).toStrictEqual(withContact.decision?.revision)
    // Conserva toda la decisión salvo las cinco diferencias permitidas por contacto.
    expect({ ...without.decision!, banderas: without.decision!.banderas.filter(flag => flag !== 'SIN_CONTACTO_ACTIVO') }).toStrictEqual({
      ...withContact.decision!,
      intervencion: without.decision!.intervencion,
      prioridad: { ...withContact.decision!.prioridad, cola: without.decision!.prioridad.cola },
      explicacion: { ...withContact.decision!.explicacion, frase_contrastiva: without.decision!.explicacion.frase_contrastiva },
      mensaje_borrador: without.decision!.mensaje_borrador,
      banderas: withContact.decision!.banderas.filter(flag => flag !== 'SIN_CONTACTO_ACTIVO'),
    })
  })

  it.each([
    { amount: 1000000, rule: 'R4' },
    { amount: 50000, rule: 'R5' },
    { amount: 100, rule: 'R6' },
  ])('el motivo de $rule explicita cantidad vencida y corte', ({ amount, rule }) => {
    const raw = buildRawData()
    raw.debts[0].current_amount = amount
    raw.debts[0].due_date = '2026-01-01'
    expect(mapOne(raw).decision?.intervencion.regla).toBe(rule)
    expect(mapOne(raw).recommendationReason).toContain('1 obligación vencida a la fecha de corte 2026-09-30')
    raw.debts.push({ ...raw.debts[0], id: 11 })
    expect(mapOne(raw).recommendationReason).toContain('2 obligaciones vencidas a la fecha de corte 2026-09-30')
    raw.debts.forEach(debt => { debt.due_date = '2026-09-30' })
    expect(mapOne(raw).recommendationReason).not.toContain('obligaciones vencidas a la fecha de corte')
  })

  it.each([
    { manifest: true, partial: false }, { manifest: true, partial: true },
    { manifest: false, partial: false }, { manifest: false, partial: true },
  ])('el motivo distingue corte/cálculo y mínimo: manifiesto=$manifest, parcial=$partial', ({ manifest, partial }) => {
    const raw = buildRawData()
    raw.debts[0].due_date = '2026-09-01'
    if (!manifest) delete raw.batch
    if (partial) raw.debts.push({ id: 11, debtor: 1, current_amount: null, due_date: '2026-09-01' })
    const debtor = mapDebtorObjectsFromRawData(raw, { computedAt: '2026-10-15T12:00:00.000Z' }).debtors[0]
    expect(debtor.decision?.severidad.estado).toBe(partial ? 'PARCIAL' : 'COMPLETA')
    const date = manifest ? 'fecha de corte 2026-09-30' : 'fecha de cálculo usada 2026-10-15'
    expect(debtor.recommendationReason).toContain(`${partial ? 'Al menos ' : ''}1 obligación vencida a la ${date}.`)
    if (!partial) expect(debtor.recommendationReason).not.toMatch(/al menos \d+ obligación/i)
    expect(debtor.recommendationReason).not.toContain('obligación vencida a la fecha de corte 2026-10-15')
  })

  it('un contacto vacío, inactivo o de una relación inactiva no habilita comunicación', () => {
    for (const edit of [
      (raw: RawDebtorDataBundle) => { raw.debtorContacts[0].value = '' },
      (raw: RawDebtorDataBundle) => { raw.debtorContacts[0].active = false },
      (raw: RawDebtorDataBundle) => { raw.debtorPeople[0].active = false },
    ]) {
      const raw = buildRawData()
      edit(raw)
      expect(mapOne(raw).decision?.intervencion).toMatchObject({ codigo: 'MEJORAR_DATOS', intensidad: 0 })
    }
  })

  it('evalúa mora por calendario estricto al corte, sin reinterpretar el estado del catálogo', () => {
    const raw = buildRawData()
    raw.debts[0].due_date = raw.batch!.as_of
    const sameDay = mapOne(raw)
    expect(sameDay.decision?.severidad).toMatchObject({ valor: 0, cantidad_vencidas: 0, dias_atraso_maximo: null })
    raw.batch!.as_of = '2026-10-01'
    const nextDay = mapOne(raw)
    expect(nextDay.decision?.severidad).toMatchObject({ valor: 60, cantidad_vencidas: 1, dias_atraso_maximo: 1 })
    raw.debtStatuses[0].value = 'Pagada'
    expect(mapOne(raw).decision).toStrictEqual(nextDay.decision)
  })

  it('el corte del manifiesto no cambia al avanzar el reloj; el sustituto declara fecha de cálculo', () => {
    const raw = buildRawData()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2040-01-01T00:00:00Z'))
    expect(mapDebtorObjectsFromRawData(raw).debtors[0].decision).toStrictEqual(mapOne(raw).decision)
    delete raw.batch
    const fallback = mapOne(raw)
    expect(fallback.decisionAsOf).toEqual({ estado: 'OBSERVADO', valor: '2026-09-30' })
    expect(fallback.decisionAsOfSource).toBe('FECHA_CALCULO')
    expect(fallback.temporalProvenance).toContain('corte de origen no informado')
    expect(fallback.recommendationReason).toContain('Fecha de cálculo usada: 2026-09-30')
    expect(fallback.rulesVersion).toBe('1.1.0')
  })

  it.each(['2026-02-30', '', null])('no sustituye en silencio el corte declarado inválido/ausente %j', asOf => {
    const raw = buildRawData()
    raw.batch!.as_of = asOf
    const debtor = mapOne(raw)
    expect(debtor.decision).toBeNull()
    expect(debtor.priorityScore).toBeNull()
    expect(debtor.recommendationType).toBe('No disponible')
    expect(debtor.decisionAsOf?.estado).not.toBe('OBSERVADO')
    expect(debtor.decisionIssues?.some(issue => issue.field === 'as_of')).toBe(true)
  })

  it('rechaza una fecha de cálculo inválida', () => {
    expect(() => mapDebtorObjectsFromRawData(buildRawData(), { computedAt: 'ayer' })).toThrow(RangeError)
  })

  it.each([1.005, '1.005', 1.015, Number.MAX_SAFE_INTEGER, NaN, Infinity, 'ilegible'])('declara importe %j INVALIDO con motivo antes de llamar al núcleo', value => {
    const raw = buildRawData()
    raw.debts[0].current_amount = value
    const mapped = mapDebtorObjectsFromRawData(raw, calculation)
    const debt = mapped.debtsByDebtor.get('1')![0]
    const debtor = mapped.debtors[0]
    expect(debt.ruleInput?.current_amount).toEqual({ estado: 'INVALIDO', valor: null })
    expect(debt.metrics?.updatedAmount.reason).toBeTruthy()
    expect(debtor.decisionIssues).toContainEqual(expect.objectContaining({ field: 'current_amount', presence: 'INVALIDO' }))
    expect(debtor.decision?.severidad.estado).toBe('NO_DISPONIBLE')
    expect(debtor.priorityScore).toBeNull()
    expect(debtor.riskScore).toBeNull()
  })

  it('suma 0.29 y 49999.71 exactamente desde filas crudas', () => {
    const raw = buildRawData()
    raw.debts[0].current_amount = 0.29
    raw.debts.push({ ...raw.debts[0], id: 11, current_amount: 49999.71 })
    const result = mapOne(raw)
    expect(result.decision?.severidad.monto_actualizado_ars).toBe(50000)
    expect(result.decision?.explicacion.factores[0].puntos).toBe(20)
  })

  it.each([null, undefined, ''])('preserva importe ausente %j aunque exista un alias/capital/perfil', value => {
    const raw = buildRawData()
    Object.assign(raw.debts[0], { current_amount: value, updated_amount: 500, original_amount: 900 })
    const debtor = mapOne(raw)
    expect(debtor.decisionInput?.obligaciones[0].current_amount).toEqual({ estado: 'NO_INFORMADO_EN_ORIGEN', valor: null })
    expect(debtor.priorityScore).toBeNull()
  })

  it('una clave current_amount eliminada es NO_INTEGRADO aunque exista un alias', () => {
    const raw = buildRawData()
    delete raw.debts[0].current_amount
    raw.debts[0].updated_amount = 500
    const debtor = mapOne(raw)
    expect(debtor.decisionInput?.obligaciones[0].current_amount).toEqual({ estado: 'NO_INTEGRADO', valor: null })
    expect(debtor.decisionIssues).toContainEqual({ entityId: '10', field: 'current_amount', presence: 'NO_INTEGRADO', reason: 'IMPORTE_AUSENTE' })
    expect(debtor.priorityScore).toBeNull()
  })

  it('el cero observado y la lista vacía leída son ceros legítimos, el fallo de lectura no lo es', () => {
    const raw = buildRawData()
    raw.debts[0].current_amount = 0
    expect(mapOne(raw).decision?.severidad).toMatchObject({ estado: 'COMPLETA', valor: 0, monto_actualizado_ars: 0 })
    raw.debts = []
    expect(mapOne(raw).priorityScore).toBe(0)
    raw.warnings = [{ table: 'debt', message: 'Error sintético', needsSelectPolicy: false }]
    const failed = mapOne(raw)
    expect(failed.decision).toBeNull()
    expect(failed.decisionInput).toBeNull()
    expect(failed.priorityScore).toBeNull()
    expect(failed.decisionIssues).toContainEqual({ field: 'obligaciones', presence: 'NO_INTEGRADO', reason: 'LECTURA_FALLIDA' })
    const summary = buildRecommendationSummary([failed], raw.warnings)
    expect(summary.find(group => group.interventionCode === null)).toMatchObject({ count: 1, cases: [failed] })
    for (const group of summary.filter(group => group.interventionCode !== null)) {
      expect(group).toMatchObject({ count: null, cases: [], highlightedCases: [], debtAssociated: null, averageRisk: null })
      expect(group.metrics.totalDebt.presence).toBe('NO_INTEGRADO')
      expect(group.metrics.riskScore.presence).toBe('NO_INTEGRADO')
    }
  })

  it('una lectura de contactos fallida mantiene los puntos y fuerza mejorar datos', () => {
    const raw = buildRawData()
    const before = mapOne(raw)
    raw.warnings = [{ table: 'debtor_contact', message: 'Error sintético', needsSelectPolicy: false }]
    const after = mapOne(raw)
    expect(after.hasContact).toBeNull()
    expect(after.decision?.severidad).toStrictEqual(before.decision?.severidad)
    expect(after.decision?.intervencion.codigo).toBe('MEJORAR_DATOS')
    expect(after.decisionIssues).toContainEqual({ field: 'contactos_activos', presence: 'NO_INTEGRADO', reason: 'LECTURA_FALLIDA' })
    expect(after.recommendationReason).toContain('Lectura de contactos no disponible: no se pudo verificar si hay contacto cargado.')
  })

  it('una lectura de relaciones fallida no se evalúa como una lista sin personas', () => {
    const raw = buildRawData()
    raw.debtorPeople[0].priority = 60
    expect(mapOne(raw).decision?.banderas).toEqual(expect.arrayContaining(['PORCENTAJES_NO_SUMAN_100', 'TIPO_PERSONA_DESCONOCIDO']))
    raw.debtorPeople = []
    raw.warnings = [{ table: 'debtor_person', message: 'Error sintético', needsSelectPolicy: false }]
    const failed = mapOne(raw)
    expect(failed.decisionIssues).toContainEqual({ field: 'personas', presence: 'NO_INTEGRADO', reason: 'LECTURA_FALLIDA' })
    expect(failed.peopleCount).toBeNull()
    expect(failed.decisionInput).toBeNull()
    expect(failed.decision).toBeNull()
    expect(failed.priorityScore).toBeNull()
    expect(failed.recommendationReason).toContain('Lectura de contactos no disponible: no se pudo verificar si hay contacto cargado.')
    raw.warnings = []
    const empty = mapOne(raw)
    expect(empty.peopleCount).toBe(0)
    expect(empty.decisionInput?.personas).toEqual([])
    expect(empty.decision).not.toBeNull()
    expect(empty.decisionIssues?.some(issue => issue.field === 'personas')).toBe(false)
  })

  it.each(['debtor', 'debt', 'debtor_person'])('la lectura fallida de %s prevalece sobre un importe inválido en la presencia de la decisión', table => {
    const raw = buildRawData()
    raw.debts[0].current_amount = 'ilegible'
    raw.warnings = [{ table, message: 'Error sintético', needsSelectPolicy: false }]
    const debtor = mapOne(raw)
    expect(debtor.decision).toBeNull()
    expect(debtor.decisionIssues).toContainEqual(expect.objectContaining({ field: 'current_amount', presence: 'INVALIDO' }))
    expect(debtor.metrics?.priorityScore).toMatchObject({ value: null, presence: 'NO_INTEGRADO' })
    expect(debtor.metrics?.riskScore).toMatchObject({ value: null, presence: 'NO_INTEGRADO' })
  })

  it('conserva el mínimo parcial, los motivos y la revisión humana', () => {
    const raw = buildRawData()
    raw.debts.push({ id: 11, debtor: 1, current_amount: null, due_date: 'fecha imposible' })
    const debtor = mapOne(raw)
    expect(debtor.decision?.severidad).toMatchObject({ estado: 'PARCIAL', valor: 85, obligaciones_no_evaluables: 1 })
    expect(debtor.metrics?.priorityScore.missing).toEqual({ NO_INFORMADO_EN_ORIGEN: 1, INVALIDO: 1 })
    expect(debtor.decision?.revision.requiere_revision_humana).toBe(true)
    expect(debtor.recommendationReason).toContain('Requiere revisión caso por caso')
  })

  it('no usa period, status, issue_date o last_collection_date como campos de origen integrados', () => {
    const raw = buildRawData()
    Object.assign(raw.debts[0], { status: 2, period: '123', issue_date: '2099-01-01', last_collection_date: '2099-01-01' })
    const debtor = mapOne(raw)
    expect(debtor.decisionInput?.source_updated_at).toEqual({ estado: 'NO_INTEGRADO', valor: null })
    expect(debtor.decisionInput?.obligaciones[0]).toMatchObject({
      estado_origen: { estado: 'NO_INTEGRADO', valor: null }, periodo_fiscal: { estado: 'NO_INTEGRADO', valor: null },
    })
    expect(debtor.decision?.banderas).toEqual(expect.arrayContaining(['ESTADO_ORIGEN_NO_INFORMADO', 'PERIODO_NO_INFORMADO']))
    expect(debtor.decision?.banderas).not.toContain('FECHAS_INCONSISTENTES')
    expect(debtor.decisionInput?.vulnerabilidad).toEqual({ estado: 'NO_INFORMADO_EN_ORIGEN', valor: null })
  })

  it('integra solo campos explícitos y no normaliza los porcentajes declarados', () => {
    const raw = buildRawData()
    Object.assign(raw.debts[0], { estado_origen: 0, periodo_fiscal: '2026-09' })
    raw.batch!.source_updated_at = '2026-10-01'
    raw.people[0].type = 'JURIDICA'
    raw.debtorPeople[0].priority = 60
    const debtor = mapOne(raw)
    expect(debtor.decision?.banderas).toEqual(expect.arrayContaining(['FECHAS_INCONSISTENTES', 'PORCENTAJES_NO_SUMAN_100']))
    expect(debtor.decision?.banderas).not.toContain('ESTADO_ORIGEN_NO_INFORMADO')
    expect(debtor.decision?.banderas).not.toContain('PERIODO_NO_INFORMADO')
    expect(debtor.decisionInput?.personas[0]).toEqual({ tipo: { estado: 'OBSERVADO', valor: 'JURIDICA' }, porcentaje_declarado: { estado: 'OBSERVADO', valor: 60 } })
    expect(debtor.priorityScore).toBe(85)
  })
})

describe('ALIGN-010: colas y unidades', () => {
  const debtors = golden.casos.map(sample => buildDebtor({
    id: sample.id, decision: sample.esperado as Decision, priorityScore: sample.esperado.prioridad.valor,
  }))

  it.each(golden.ordenamientos)('cola $cola: conteo = listado, orden exacto y no muta la entrada', queue => {
    const before = structuredClone(debtors)
    const cases = getInterventionCases([...debtors].reverse(), queue.cola as InterventionCode)
    expect(cases.map(item => item.id)).toEqual(queue.orden_esperado)
    const summary = buildRecommendationSummary(debtors).find(item => item.interventionCode === queue.cola)!
    expect(summary.count).toBe(cases.length)
    expect(summary.cases.map(item => item.id)).toEqual(queue.orden_esperado)
    expect(summary.highlightedCases).toEqual(cases.slice(0, 3))
    expect(summary.recommendation).not.toContain('%')
    expect(debtors).toStrictEqual(before)
  })

  it('sin universo leído no publica conteos cero; sin casos conocidos la cola leída sí tiene cero', () => {
    expect(buildRecommendationSummary([]).every(group => group.count === 0 && group.cases.length === 0)).toBe(true)
    const failed = buildRecommendationSummary(debtors, [{ table: 'debtor', message: 'Error sintético', needsSelectPolicy: false }])
    expect(failed.every(group => group.count === null && group.cases.length === 0)).toBe(true)
  })

  it('usa la banda ALTA v1, inclusive 70, y nunca el umbral heredado >90', () => {
    const high = getHighRiskCases(debtors)
    expect(high.map(item => item.id).sort()).toEqual(debtors.filter(item => item.decision!.severidad.valor !== null && item.decision!.severidad.valor! >= 70).map(item => item.id).sort())
    expect(high.some(item => item.decision!.severidad.valor === 70)).toBe(true)
  })

  it('los importes y promedios de la cola provienen de la decisión, no del perfil persistido', () => {
    const raw = buildRawData()
    raw.debtorProfiles[0].total_debt_amount = 0
    const debtor = mapOne(raw)
    const group = buildRecommendationSummary([debtor]).find(item => item.interventionCode === debtor.decision!.prioridad.cola)!
    expect(group.debtAssociated).toBe(1000000)
    expect(group.averageRisk).toBe(85)
    expect(group.count).toBe(1)
    expect(group.cases).toEqual([debtor])
  })
})
