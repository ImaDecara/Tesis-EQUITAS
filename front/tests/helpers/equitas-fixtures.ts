import { observed } from '@/lib/data-presence'
import type {
  DashboardData,
  DebtorDetailData,
  DebtorListItem,
  PeopleDashboardSummary,
  PersonListItem,
  RawDebtorDataBundle,
  RawPersonDataBundle,
} from '@/types/equitas-domain'

// Forma de las filas persistidas. Identidades y contactos deliberadamente sintéticos.
export function buildPresenceRawData(): RawDebtorDataBundle {
  return {
    debtors: [{ id: 901, external_id: 'SINTETICO-OBJ-901', type: 6 }],
    debtorTypes: [{ id: 6, value: 'AGUA' }],
    debts: [{ id: 801, debtor: 901, original_amount: 500, current_amount: 0,
      updated_amount: 0, status: 2, due_date: '2020-01-01', period: 'SINTETICO-DEUDA-801' }],
    debtStatuses: [
      { id: 2, key: 'OVERDUE', value: 'Vencida' },
      { id: 3, key: 'PAID', value: 'Pagada' },
      { id: 8, key: 'UNKNOWN', value: 'Desconocido' },
    ],
    people: [
      { id: 701, full_name: 'Persona sintética A', document_number: 'SINTETICO-A' },
      { id: 702, full_name: 'Persona sintética B', document_number: 'SINTETICO-B' },
    ],
    debtorPeople: [
      { id: 401, debtor: 901, person: 701, active: true, priority: 50, role: 'SINTETICO' },
      { id: 402, debtor: 901, person: 702, active: true, priority: 50, role: 'SINTETICO' },
    ],
    debtorContacts: [
      { id: 601, person: 701, value: 'sintetico-a@example.test', type: 1, active: true },
      { id: 602, person: 701, value: 'sintetico-b@example.test', type: 1, active: true },
    ],
    debtorProfiles: [],
    warnings: [],
  }
}

export function buildIncompleteStatusRawData(): RawDebtorDataBundle {
  const raw = buildPresenceRawData()
  raw.debtors.push({ id: 902, external_id: 'SINTETICO-OBJ-902', type: 6 })
  raw.debts = [
    { id: 821, debtor: 902, current_amount: 50, status: 2, due_date: '2020-01-01' },
    { id: 822, debtor: 902, current_amount: 70, status: 8, due_date: null },
  ]
  raw.people = raw.people.slice(0, 1)
  raw.debtorPeople = [raw.debtorPeople[0], { debtor: 902, person: 701, active: true }]
  return raw
}

export function buildPresencePeopleData(): RawPersonDataBundle {
  const raw = buildPresenceRawData()
  return { ...raw, debtorProfilesDetail: [{ person: 701, debtor_profile: 901, risk_value: 0 }] }
}

export function buildDebtor(overrides: Partial<DebtorListItem> = {}): DebtorListItem {
  return {
    id: '1',
    identifier: 'AG-1001',
    type: 'Agua',
    description: 'Conexion de agua municipal',
    status: 'Activo',
    totalDebt: 1000,
    pendingDebt: 1000,
    overdueDebt: 800,
    peopleCount: 1,
    peopleIds: ['501'],
    peopleNames: ['Ana Perez'],
    hasContact: false,
    contactCount: 0,
    risk: 'ALTO',
    riskScore: 95,
    debtCount: 2,
    overdueDebtsCount: 2,
    maxDaysOverdue: 120,
    priorityScore: 160,
    priorityLevel: 'ALTA',
    recommendation: 'Contactar de forma prioritaria.',
    recommendationType: 'Llamado prioritario',
    recommendationReason: 'Riesgo alto y deuda vencida.',
    isUrgentRecommendation: true,
    ...overrides,
  }
}

export function buildDebtors(): DebtorListItem[] {
  return [
    buildDebtor(),
    buildDebtor({
      id: '2',
      identifier: 'IN-2001',
      type: 'Inmueble',
      description: 'Tasa de inmueble',
      status: 'Vencida',
      totalDebt: 500,
      pendingDebt: 500,
      overdueDebt: 500,
      peopleIds: ['502'],
      peopleNames: ['Bruno Diaz'],
      hasContact: true,
      contactCount: 1,
      risk: 'MEDIO',
      riskScore: 60,
      priorityScore: 90,
      priorityLevel: 'MEDIA',
      recommendationType: 'Mensaje recordatorio',
      recommendation: 'Enviar recordatorio.',
      recommendationReason: 'Contacto disponible.',
      isUrgentRecommendation: false,
      maxDaysOverdue: 30,
    }),
    buildDebtor({
      id: '3',
      identifier: 'RO-3001',
      type: 'Rodado / vehiculo',
      description: 'Patente municipal',
      status: 'Activo',
      totalDebt: 200,
      pendingDebt: 200,
      overdueDebt: 0,
      peopleIds: ['503'],
      peopleNames: ['Carla Nuñez'],
      hasContact: true,
      contactCount: 2,
      risk: 'BAJO',
      riskScore: 20,
      priorityScore: 25,
      priorityLevel: 'BAJA',
      recommendationType: 'Seguimiento posterior',
      recommendation: 'Mantener seguimiento.',
      recommendationReason: 'Sin mora.',
      isUrgentRecommendation: false,
      maxDaysOverdue: 0,
    }),
  ]
}

export function buildPeople(): PersonListItem[] {
  return [
    {
      id: '501',
      name: 'Ana Perez',
      document: '20123456789',
      individualRisk: 'ALTO',
      riskValue: 95,
      debtorsCount: 1,
      hasContact: false,
      totalDebtAssociated: 1000,
      debtExposure: [{ debtorId: '1', amount: observed(1000) }],
      exposureLabel: 'Exposición asociada (no aditiva)',
      debtorIds: ['1'],
      debtorIdentifiers: ['AG-1001'],
    },
    {
      id: '502',
      name: 'Bruno Diaz',
      document: '20987654321',
      individualRisk: 'MEDIO',
      riskValue: 60,
      debtorsCount: 1,
      hasContact: true,
      totalDebtAssociated: 500,
      debtExposure: [{ debtorId: '2', amount: observed(500) }],
      exposureLabel: 'Exposición asociada (no aditiva)',
      debtorIds: ['2'],
      debtorIdentifiers: ['IN-2001'],
    },
    {
      id: '503',
      name: 'Carla Nuñez',
      document: '27222333444',
      individualRisk: 'BAJO',
      riskValue: 20,
      debtorsCount: 1,
      hasContact: true,
      totalDebtAssociated: 200,
      debtExposure: [{ debtorId: '3', amount: observed(200) }],
      exposureLabel: 'Exposición asociada (no aditiva)',
      debtorIds: ['3'],
      debtorIdentifiers: ['RO-3001'],
    },
  ]
}

export function buildPeopleDashboard(): PeopleDashboardSummary {
  return {
    totalPeople: 3,
    lowRiskCount: 1,
    mediumRiskCount: 1,
    highRiskCount: 1,
    withoutContactCount: 1,
    individualRiskDistribution: [
      { label: 'Bajo', value: 1 },
      { label: 'Medio', value: 1 },
      { label: 'Alto', value: 1 },
    ],
    topPeopleByRiskValue: buildPeople().map((person) => ({
      id: person.id,
      name: person.name,
      document: person.document,
      riskValue: person.riskValue,
      individualRisk: person.individualRisk,
      debtorsCount: person.debtorsCount,
      hasContact: person.hasContact,
    })),
  }
}

export function buildDashboard(): DashboardData {
  const debtors = buildDebtors()

  return {
    totalDebtors: 3,
    totalDebt: 1700,
    pendingDebt: 1700,
    overdueDebt: 1300,
    overdueCases: 2,
    withContactCases: 2,
    withoutContactCases: 1,
    priorityCases: 1,
    urgentRecommendationCases: 1,
    criticalCasesToday: 1,
    riskAboveNinetyCases: 1,
    criticalDebtTotal: 1000,
    byDebtStatus: [
      { label: 'Activo', value: 1200 },
      { label: 'Vencida', value: 500 },
    ],
    byDebtorType: [
      { label: 'Agua', value: 1 },
      { label: 'Inmueble', value: 1 },
      { label: 'Rodado / vehiculo', value: 1 },
    ],
    byRisk: [
      { label: 'ALTO', value: 1 },
      { label: 'MEDIO', value: 1 },
      { label: 'BAJO', value: 1 },
    ],
    byRecommendation: [
      { label: 'Llamado prioritario', value: 1 },
      { label: 'Mensaje recordatorio', value: 1 },
      { label: 'Plan de pago / revision humana', value: 0 },
      { label: 'Seguimiento posterior', value: 1 },
    ],
    topDebtChart: debtors.flatMap(debtor => debtor.totalDebt === null ? [] : [{ label: debtor.identifier, value: debtor.totalDebt }]),
    topDebtors: debtors.map((debtor) => ({
      id: debtor.id,
      identifier: debtor.identifier,
      type: debtor.type,
      totalDebt: debtor.totalDebt,
      risk: debtor.risk,
      riskScore: debtor.riskScore,
    })),
    topPriorityDebtors: debtors.map((debtor) => ({
      id: debtor.id,
      identifier: debtor.identifier,
      type: debtor.type,
      totalDebt: debtor.totalDebt,
      overdueDays: debtor.maxDaysOverdue,
      risk: debtor.risk,
      riskScore: debtor.riskScore,
      hasContact: debtor.hasContact,
      recommendationType: debtor.recommendationType,
      priorityScore: debtor.priorityScore,
      priorityLevel: debtor.priorityLevel,
    })),
    withoutContactDebtors: debtors
      .filter((debtor) => !debtor.hasContact)
      .map((debtor) => ({
        id: debtor.id,
        identifier: debtor.identifier,
        type: debtor.type,
        totalDebt: debtor.totalDebt,
        overdueDays: debtor.maxDaysOverdue,
        risk: debtor.risk,
        riskScore: debtor.riskScore,
      })),
    topDebtDebtors: debtors.map((debtor) => ({
      id: debtor.id,
      identifier: debtor.identifier,
      type: debtor.type,
      totalDebt: debtor.totalDebt,
      overdueDays: debtor.maxDaysOverdue,
      risk: debtor.risk,
      riskScore: debtor.riskScore,
      recommendationType: debtor.recommendationType,
    })),
  }
}

export function buildDebtorDetail(): DebtorDetailData {
  const debtor = buildDebtor()

  return {
    debtor,
    people: [
      {
        id: '501',
        name: 'Ana Perez',
        document: '20123456789',
        priority: '100',
        contact: 'Faltante',
        relation: 'Responsable',
      },
    ],
    contacts: [
      {
        id: 'contact-1',
        personId: '501',
        personName: 'Ana Perez',
        channel: 'Telefono',
        value: '3415550000',
        isActive: true,
      },
    ],
    debts: [
      {
        id: 'debt-1',
        originalAmount: 800,
        updatedAmount: 1000,
        dueDate: '2020-01-01',
        period: '2024-01',
        status: 'Vencida',
      },
    ],
    profile: {
      totalDebt: 1000,
      pendingDebt: 1000,
      overdueDebt: 800,
      debtCount: 2,
      antiquityDays: 120,
      associatedPeople: 1,
      availableContacts: 0,
      risk: 'ALTO',
      riskScore: 95,
      socioeconomicLevel: 'Critico',
    },
  }
}
