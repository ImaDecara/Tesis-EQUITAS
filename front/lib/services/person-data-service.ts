import { EQUITAS_TABLE_NAMES } from '@/lib/data/table-names'
import { mapPeopleFromRawData } from '@/lib/mappers/person-risk-mapper'
import { createTenantReader } from '@/lib/server/dal'
import type {
  DataWarning,
  PeopleDashboardSummary,
  PersonListItem,
  RawPersonDataBundle,
} from '@/types/equitas-domain'

const PEOPLE_TABLE_LOAD_ORDER = [
  EQUITAS_TABLE_NAMES.person,
  EQUITAS_TABLE_NAMES.debtorProfileDetail,
  EQUITAS_TABLE_NAMES.debtorPerson,
  EQUITAS_TABLE_NAMES.debtorContact,
  EQUITAS_TABLE_NAMES.debt,
  EQUITAS_TABLE_NAMES.debtor,
] as const

// El índice anterior por persona (debtor_profile_detail.risk_value) no existe en una cartera cargada desde CSV:
// que no haya filas no es un error de lectura ni un permiso faltante. Lleva un código propio para que las
// pantallas lo traten como «dato que no existe para nadie» y no como una falla.
export const EMPTY_LEGACY_INDEX = 'EMPTY_LEGACY_INDEX'

function emptyLegacyIndexWarning(table: string): DataWarning {
  return { table, code: EMPTY_LEGACY_INDEX, message: 'El índice anterior por persona no tiene filas.', needsSelectPolicy: false }
}

async function loadRawPeopleData(): Promise<RawPersonDataBundle> {
  const reader = await createTenantReader()
  const results = await Promise.all(
    PEOPLE_TABLE_LOAD_ORDER.map((table) => reader.readTable(table))
  )
  const warnings = results
    .map((result) => result.warning)
    .filter((warning): warning is DataWarning => Boolean(warning))

  const peopleRows = results[0]?.rows ?? []
  const riskDetailRows = results[1]?.rows ?? []
  const alreadyWarnedRiskTable = warnings.some(
    (warning) => warning.table === EQUITAS_TABLE_NAMES.debtorProfileDetail
  )

  if (peopleRows.length > 0 && riskDetailRows.length === 0 && !alreadyWarnedRiskTable) {
    warnings.push(emptyLegacyIndexWarning(EQUITAS_TABLE_NAMES.debtorProfileDetail))
  }

  return {
    people: peopleRows,
    debtorProfilesDetail: riskDetailRows,
    debtorPeople: results[2]?.rows ?? [],
    debtorContacts: results[3]?.rows ?? [],
    debts: results[4]?.rows ?? [],
    debtors: results[5]?.rows ?? [],
    warnings,
  }
}

// Caso de uso completo de Personas / Deudores para listado, filtros y navegacion asociada.
export async function getPeopleDataFromService(): Promise<{
  people: PersonListItem[]
  peopleDashboard: PeopleDashboardSummary
  warnings: DataWarning[]
}> {
  const rawData = await loadRawPeopleData()
  const mapped = mapPeopleFromRawData(rawData)

  return {
    people: mapped.people,
    peopleDashboard: mapped.dashboard,
    warnings: rawData.warnings,
  }
}

// Caso de uso liviano para tablero general: solo resumen de riesgo individual de personas.
export async function getPeopleDashboardDataFromService(): Promise<{
  peopleDashboard: PeopleDashboardSummary
  warnings: DataWarning[]
}> {
  const rawData = await loadRawPeopleData()
  const mapped = mapPeopleFromRawData(rawData)

  return {
    peopleDashboard: mapped.dashboard,
    warnings: rawData.warnings,
  }
}
