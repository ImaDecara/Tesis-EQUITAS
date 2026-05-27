import { EQUITAS_TABLE_NAMES } from '@/lib/data/table-names'
import { mapPeopleFromRawData } from '@/lib/mappers/person-risk-mapper'
import { hasSupabaseCredentials, supabase } from '@/lib/supabase'
import type {
  DataWarning,
  PeopleDashboardSummary,
  PersonListItem,
  RawPersonDataBundle,
  RawRow,
} from '@/types/equitas-domain'

const TABLE_LIMIT = 3000

const PEOPLE_TABLE_LOAD_ORDER = [
  EQUITAS_TABLE_NAMES.person,
  EQUITAS_TABLE_NAMES.debtorProfileDetail,
  EQUITAS_TABLE_NAMES.debtorPerson,
  EQUITAS_TABLE_NAMES.debtorContact,
  EQUITAS_TABLE_NAMES.debt,
  EQUITAS_TABLE_NAMES.debtor,
] as const

function buildDataWarningFromSupabaseError(
  table: string,
  error: { message: string; code?: string | null }
): DataWarning {
  const message = error.message || 'Error desconocido al leer datos'
  const loweredMessage = message.toLowerCase()
  const code = error.code ?? undefined
  const needsSelectPolicy =
    code === '42501' ||
    loweredMessage.includes('permission denied') ||
    loweredMessage.includes('row-level security') ||
    loweredMessage.includes('rls')

  return {
    table,
    message,
    code,
    needsSelectPolicy,
  }
}

function buildLikelyRlsWarning(table: string, message: string): DataWarning {
  return {
    table,
    message,
    needsSelectPolicy: true,
  }
}

async function loadRawTableRows(table: string) {
  if (!supabase || !hasSupabaseCredentials) {
    return {
      rows: [] as RawRow[],
      warning: {
        table,
        message:
          'Credenciales de Supabase no configuradas (NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).',
        needsSelectPolicy: false,
      } satisfies DataWarning,
    }
  }

  const response = await supabase.from(table).select('*').limit(TABLE_LIMIT)

  if (response.error) {
    return {
      rows: [] as RawRow[],
      warning: buildDataWarningFromSupabaseError(table, response.error),
    }
  }

  return {
    rows: (response.data ?? []) as RawRow[],
    warning: null,
  }
}

async function loadRawPeopleData(): Promise<RawPersonDataBundle> {
  const results = await Promise.all(PEOPLE_TABLE_LOAD_ORDER.map((table) => loadRawTableRows(table)))
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
