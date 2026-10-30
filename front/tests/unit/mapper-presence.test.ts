import { describe, expect, it } from 'vitest'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { mapPeopleFromRawData, summarizePeople } from '@/lib/mappers/person-risk-mapper'
import { mapDashboardMetricsFromDebtorObjects } from '@/lib/mappers/dashboard-metrics-mapper'
import { buildIncompleteStatusRawData, buildPresenceRawData, buildPresencePeopleData } from '@/tests/helpers/equitas-fixtures'
import { buildDebtAgingSummary } from '@/lib/equitas-view-selectors'

describe('ALIGN-011: presencia con filas de forma real', () => {
  it('conserva cero actual y cero persistido, sin sustituirlos por capital', () => {
    const raw = buildPresenceRawData()
    let result = mapDebtorObjectsFromRawData(raw)
    expect(result.debtsByDebtor.get('901')?.[0].updatedAmount).toBe(0)
    expect(result.debtors[0].totalDebt).toBe(0)
    raw.debts[0].current_amount = 125
    raw.debtorProfiles = [{ debtor: 901, total_debt_amount: 0, overdue_debt_amount: 0 }]
    result = mapDebtorObjectsFromRawData(raw)
    expect(result.debtors[0]).toMatchObject({ totalDebt: 0, overdueDebt: 0 })
  })

  it('resuelve la FK status por catálogo y no infiere un estado por la fecha', () => {
    const raw = buildPresenceRawData()
    expect(mapDebtorObjectsFromRawData(raw).debtsByDebtor.get('901')?.[0].status).toBe('Vencida')
    raw.debts[0].current_amount = 125
    raw.debts[0].status = 3
    const paid = mapDebtorObjectsFromRawData(raw).debtors[0]
    expect(paid).toMatchObject({ overdueDebt: 0, overdueDebtsCount: 0 })
    expect(paid.metrics?.maxDaysOverdue.presence).toBe('NO_APLICA')
    delete raw.debts[0].status
    expect(mapDebtorObjectsFromRawData(raw).debtsByDebtor.get('901')?.[0].status).toBe('UNKNOWN')
  })

  it.each([
    ['OVERDUE', 'Pendiente', 125, 'OBSERVADO'],
    ['PAID', 'Vencida', 0, 'OBSERVADO'],
    ['UNKNOWN', 'Desconocido', null, 'NO_INFORMADO_EN_ORIGEN'],
  ])('decide la mora por key=%s aunque la etiqueta sea %s', (key, value, overdueDebt, statusPresence) => {
    const raw = buildPresenceRawData()
    raw.debts[0].current_amount = 125
    raw.debtStatuses = [{ id: 2, key, value }]
    const mapped = mapDebtorObjectsFromRawData(raw)
    expect(mapped.debtsByDebtor.get('901')?.[0]).toMatchObject({ status: value, statusPresence })
    expect(mapped.debtors[0].overdueDebt).toBe(overdueDebt)
  })

  it.each(['Desconocido', 'UNKNOWN'])('conserva mora parcial y faltantes con estado %s sin perfil', label => {
    const raw = buildIncompleteStatusRawData()
    raw.debtStatuses[2].value = label
    const mapped = mapDebtorObjectsFromRawData(raw)
    const incomplete = mapped.debtors.find(debtor => debtor.id === '902')!
    expect(incomplete.metrics?.overdueDebt).toEqual({ value: 50, presence: 'OBSERVADO', missing: { NO_INFORMADO_EN_ORIGEN: 1 } })
    expect(incomplete.metrics?.maxDaysOverdue).toEqual({ value: null, presence: 'NO_INFORMADO_EN_ORIGEN', missing: { NO_INFORMADO_EN_ORIGEN: 1 } })
    const dashboard = mapDashboardMetricsFromDebtorObjects(mapped)
    expect(dashboard.metrics?.overdueCases).toEqual({ value: 1, presence: 'OBSERVADO', missing: { NO_INFORMADO_EN_ORIGEN: 1 } })
    expect(buildDebtAgingSummary(mapped.debtors).metrics.overdueDebt).toEqual(incomplete.metrics?.overdueDebt)
  })

  it('el estado de catálogo ausente deja mora histórica no disponible, pero no impide la decisión al corte', () => {
    const raw = buildPresenceRawData()
    raw.debts[0].status = 8
    raw.debts[0].current_amount = 70
    raw.debtorProfiles = [{ debtor: 901, socioeconomic_risk_level: 80 }]
    const mapped = mapDebtorObjectsFromRawData(raw)
    const dashboard = mapDashboardMetricsFromDebtorObjects(mapped)
    expect(dashboard.metrics?.overdueCases).toEqual({ value: null, presence: 'NO_INFORMADO_EN_ORIGEN', missing: { NO_INFORMADO_EN_ORIGEN: 1 } })
    expect(dashboard.metrics?.priorityCases).toEqual({ value: 0, presence: 'OBSERVADO', missing: {} })
    expect(dashboard.metrics?.urgentRecommendationCases).toEqual({ value: 1, presence: 'OBSERVADO', missing: {} })
    expect(mapped.debtors[0].decision?.severidad.estado).toBe('COMPLETA')
    expect(buildDebtAgingSummary(mapped.debtors).metrics.overdueDebt).toEqual({ value: null, presence: 'NO_INFORMADO_EN_ORIGEN', missing: { NO_INFORMADO_EN_ORIGEN: 1 } })
  })

  it('cuenta objetos incompletos una vez por estado en los KPI, sin perder sus obligaciones faltantes', () => {
    const raw = buildIncompleteStatusRawData()
    raw.debts.push({ id: 823, debtor: 902, current_amount: 20, status: 8 })
    raw.debtorProfiles = raw.debtors.map(debtor => ({ debtor: debtor.id, socioeconomic_risk_level: 80 }))
    const mapped = mapDebtorObjectsFromRawData(raw)
    const incomplete = mapped.debtors.find(debtor => debtor.id === '902')!
    expect(incomplete).toMatchObject({ maxDaysOverdue: null, priorityScore: 45, recommendationType: 'Revisión jurídica' })
    expect(incomplete.metrics?.overdueDebt.missing).toEqual({ NO_INFORMADO_EN_ORIGEN: 2 })
    const dashboard = mapDashboardMetricsFromDebtorObjects(mapped)
    expect(dashboard.metrics?.overdueCases).toMatchObject({ value: 1, missing: { NO_INFORMADO_EN_ORIGEN: 1 } })
    expect(dashboard.metrics?.priorityCases).toMatchObject({ value: 0, missing: { NO_INFORMADO_EN_ORIGEN: 1 } })
    expect(dashboard.metrics?.urgentRecommendationCases).toMatchObject({ value: 1, missing: { NO_INFORMADO_EN_ORIGEN: 1 } })
  })

  it('distingue un importe inválido y una lectura fallida del cero observado', () => {
    const raw = buildPresenceRawData()
    raw.debts[0].current_amount = 'importe inválido'
    expect(mapDebtorObjectsFromRawData(raw).debtsByDebtor.get('901')?.[0].updatedAmount).toBeNull()
    raw.warnings = [{ table: 'debt', message: 'Error sintético', needsSelectPolicy: false }]
    const dashboard = mapDashboardMetricsFromDebtorObjects(mapDebtorObjectsFromRawData(raw))
    expect(dashboard.totalDebt).toBeNull()
    expect(dashboard.totalDebtors).toBe(1)
  })

  it('cuenta contactos activos, sin mezclar personas ni el contador del perfil', () => {
    const raw = buildPresenceRawData()
    raw.debtorProfiles = [{ debtor: 901, available_contact_count: 99 }]
    expect(mapDebtorObjectsFromRawData(raw).debtors[0].contactCount).toBe(2)
  })

  it('distingue persona sin detalle de persona con riesgo cero', () => {
    const result = mapPeopleFromRawData(buildPresencePeopleData())
    expect(result.people.find(p => p.id === '701')).toMatchObject({ riskValue: 0, individualRisk: 'BAJO' })
    expect(result.people.find(p => p.id === '702')).toMatchObject({ riskValue: null, individualRisk: null })
    expect(result.dashboard.lowRiskCount).toBe(1)
    expect(result.dashboard.individualRiskDistribution).toContainEqual({ label: 'No disponible', value: 1 })
  })

  it('deduplica el objeto compartido sin repartir la exposición por porcentaje', () => {
    const raw = buildPresencePeopleData()
    raw.debts[0].current_amount = 125
    const { people } = mapPeopleFromRawData(raw)
    expect(people.map(person => person.totalDebtAssociated)).toEqual([125, 125])
    expect(people.every(person => person.exposureLabel === 'Exposición asociada (no aditiva)')).toBe(true)
    expect(summarizePeople(people).totalDebtAssociated.value).toBe(125)
    expect(summarizePeople(people.slice(0, 1)).totalDebtAssociated.value).toBe(125)
    expect(summarizePeople([]).totalDebtAssociated.value).toBe(0)
    expect(summarizePeople([]).averageRiskValue).toMatchObject({ value: null, presence: 'NO_APLICA' })
    expect(summarizePeople(people).averageRiskValue).toMatchObject({ value: 0, missing: { NO_INTEGRADO: 1 } })
  })

  it('cuenta importes faltantes aparte y devuelve null si no hay observados', () => {
    const raw = buildPresenceRawData()
    raw.debts[0].current_amount = 'abc'
    let result = mapDebtorObjectsFromRawData(raw)
    expect(result.debtors[0].totalDebt).toBeNull()
    expect(result.debtors[0].metrics?.totalDebt).toMatchObject({ presence: 'INVALIDO', missing: { INVALIDO: 1 } })
    raw.debts.push({ id: 802, debtor: 901, current_amount: 100, status: 2 })
    result = mapDebtorObjectsFromRawData(raw)
    expect(result.debtors[0].totalDebt).toBe(100)
    expect(result.debtors[0].metrics?.totalDebt.missing).toEqual({ INVALIDO: 1 })
    const dashboard = mapDashboardMetricsFromDebtorObjects(result)
    expect(dashboard.metrics?.totalDebt).toMatchObject({ value: 100, missing: { INVALIDO: 1 } })
  })

  it('el adaptador no sustituye current_amount ausente por updated_amount ni capital', () => {
    const raw = buildPresenceRawData()
    delete raw.debts[0].current_amount
    expect(mapDebtorObjectsFromRawData(raw).debtors[0].metrics?.totalDebt).toMatchObject({ value: null, presence: 'NO_INTEGRADO' })
    delete raw.debts[0].updated_amount
    expect(mapDebtorObjectsFromRawData(raw).debtors[0].totalDebt).toBeNull()
    raw.debtorProfiles = [{ debtor: 901, total_debt_amount: 'ilegible' }]
    raw.debts[0].current_amount = 100
    expect(mapDebtorObjectsFromRawData(raw).debtors[0].totalDebt).toBeNull()
  })

  it('no usa un ID sin etiqueta ni un código desconocido como estado visible', () => {
    const raw = buildPresenceRawData()
    raw.debtStatuses = [{ id: 2 }, { id: 3, value: 3 }, { value: 'sin id' }]
    expect(mapDebtorObjectsFromRawData(raw).debtsByDebtor.get('901')?.[0]).toMatchObject({ status: 'UNKNOWN', statusPresence: 'INVALIDO' })
    raw.debtStatuses = [{ id: 2, value: 'UNKNOWN' }]
    expect(mapDebtorObjectsFromRawData(raw).debtors[0].overdueDebt).toBeNull()
  })

  it('excluye relaciones inactivas y deduplica relaciones y contactos repetidos', () => {
    const raw = buildPresenceRawData()
    raw.debtorPeople.push({ ...raw.debtorPeople[0] }, { debtor: 901, person: 703, active: false })
    raw.debtorContacts.push({ ...raw.debtorContacts[0], id: 603 },
      { id: 604, person: 701, value: 'inactivo@example.test', active: false },
      { id: 605, person: 703, value: 'inactivo-vinculo@example.test', active: true })
    const result = mapDebtorObjectsFromRawData(raw)
    expect(result.debtors[0]).toMatchObject({ peopleCount: 2, contactCount: 2 })
    expect(result.contactsByDebtor.get('901')).toHaveLength(3)
  })

  it.each(['debtor', 'debt', 'debtor_profile', 'debtor_contact', 'debtor_person', 'debt_status'])('propaga el error de %s sin fabricar un cero', table => {
    const raw = buildPresenceRawData()
    raw.debtorProfiles = [{ debtor: 901, total_debt_amount: 0, overdue_debt_amount: 0, socioeconomic_risk_level: 0 }]
    raw.warnings = [{ table, message: 'Error de lectura sintético', needsSelectPolicy: false }]
    const result = mapDashboardMetricsFromDebtorObjects(mapDebtorObjectsFromRawData(raw))
    const key = table === 'debtor' ? 'totalDebtors' : table === 'debt_status' ? 'overdueCases'
      : table === 'debtor_contact' || table === 'debtor_person' ? 'withContactCases' : 'totalDebt'
    expect(result[key]).toBeNull()
    expect(result.metrics?.[key].presence).toBe('NO_INTEGRADO')
  })

  it.each(['person', 'debt', 'debtor', 'debtor_person', 'debtor_contact', 'debtor_profile_detail'])('propaga %s en personas y sus KPI dependientes', table => {
    const raw = buildPresencePeopleData()
    raw.warnings = [{ table, message: 'Error de lectura sintético', needsSelectPolicy: false }]
    const result = mapPeopleFromRawData(raw)
    if (table === 'debtor_profile_detail') {
      expect(result.dashboard.lowRiskCount).toBeNull()
      expect(result.dashboard.topPeopleByRiskValue).toEqual([])
      expect(summarizePeople(result.people, raw.warnings).averageRiskValue.value).toBeNull()
    } else if (table === 'debtor_contact') {
      expect(result.dashboard.withoutContactCount).toBeNull()
      expect(result.people[0].hasContact).toBeNull()
    } else {
      expect(summarizePeople(result.people, raw.warnings).totalDebtAssociated.value).toBeNull()
    }
  })

  it('conserva la fecha persistida y distingue fecha inválida de antigüedad cero', () => {
    const raw = buildPresenceRawData()
    raw.debtorProfiles = [{ debtor: 901, socioeconomic_risk_level: 0, profile_generated_at: '2026-09-30T10:00:00Z' }]
    let result = mapDebtorObjectsFromRawData(raw).debtors[0]
    expect(result.computedAt).toBe('2026-09-30T10:00:00Z')
    expect(result.temporalProvenance).toContain('2026-09-30T10:00:00Z')
    expect(result.temporalProvenance).toContain('corte no integrado')
    raw.debts[0].due_date = '2024-02-31'
    result = mapDebtorObjectsFromRawData(raw).debtors[0]
    expect(result.maxDaysOverdue).toBeNull()
    expect(result.metrics?.maxDaysOverdue.presence).toBe('INVALIDO')
    expect(result.priorityScore).toBeNull()
  })

  it('evalúa severidad del objeto sin perfil y conserva el faltante del índice de personas', () => {
    const raw = buildPresenceRawData()
    const mapped = mapDebtorObjectsFromRawData(raw)
    expect(mapped.debtors[0]).toMatchObject({ risk: 'BAJO', riskScore: 0, priorityScore: 0 })
    expect(mapped.debtors[0].decision?.severidad).toMatchObject({ estado: 'COMPLETA', monto_actualizado_ars: 0 })
    expect(mapDashboardMetricsFromDebtorObjects(mapped).byRisk).toEqual([
      { label: 'ALTO', value: 0 }, { label: 'MEDIO', value: 0 }, { label: 'BAJO', value: 1 },
    ])
    const peopleRaw = buildPresencePeopleData()
    peopleRaw.debtorProfilesDetail = []
    expect(mapPeopleFromRawData(peopleRaw).dashboard.individualRiskDistribution).toEqual([{ label: 'No disponible', value: 2 }])
    raw.debtorProfiles = [{ debtor: 901, socioeconomic_risk_level: 0 }]
    expect(mapDebtorObjectsFromRawData(raw).debtors[0]).toMatchObject({ risk: 'BAJO', riskScore: 0 })
  })
})
