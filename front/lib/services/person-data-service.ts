import { loadAllTableRows } from '@/lib/data/paginated-table-reader'
import { EQUITAS_TABLE_NAMES } from '@/lib/data/table-names'
import { mapPeopleFromRawData } from '@/lib/mappers/person-risk-mapper'
import { createServerSupabaseClient } from '@/lib/supabase-server'
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

function buildLikelyRlsWarning(table: string, message: string): DataWarning {
  return {
    table,
    message,
    needsSelectPolicy: true,
  }
}

async function loadRawPeopleData(): Promise<RawPersonDataBundle> {
  const supabase = await createServerSupabaseClient()
  const results = await Promise.all(
    PEOPLE_TABLE_LOAD_ORDER.map((table) => loadAllTableRows(table, supabase))
  )
  const warnings = results
    .map((result) => result.warning)
    .filter((warning): warning is DataWarning => Boolean(warning))

  const peopleRows = results[0]?.rows ?? []
  const riskDetailRows = results[1]?.rows ?? []
  const alreadyWarnedRiskTable = warnings.some(
    (warning) => warning.table === EQUITAS_TABLE_NAMES.debtorProfileDetail
  )

  // Si hay personas pero risk_value viene vacio, normalmente hay policy faltante en debtor_profile_detail.
  if (peopleRows.length > 0 && riskDetailRows.length === 0 && !alreadyWarnedRiskTable) {
    warnings.push(
      buildLikelyRlsWarning(
        EQUITAS_TABLE_NAMES.debtorProfileDetail,
        'No devolvio filas desde frontend. Si en Supabase hay datos, falta policy SELECT para este rol o lectura con sesion autenticada.'
      )
    )
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
