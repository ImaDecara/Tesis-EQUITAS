import { loadRawDebtorData } from '@/lib/data/raw-debtor-loader'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'
import { calculateDaysSinceDate } from '@/lib/parsers/date-value-parser'
import type { DebtorDetailData } from '@/types/equitas-domain'

// Construye el detalle a partir del resultado ya mapeado.
function mapDebtorDetailFromMappedObjects(
  debtorId: string,
  mapped: ReturnType<typeof mapDebtorObjectsFromRawData>
): DebtorDetailData | null {
  const debtor = mapped.debtors.find((item) => item.id === debtorId)

  if (!debtor) {
    return null
  }

  const debts = mapped.debtsByDebtor.get(debtorId) ?? []
  const people = mapped.peopleByDebtor.get(debtorId) ?? []
  const contacts = mapped.contactsByDebtor.get(debtorId) ?? []
  // La fecha de vencimiento mas antigua se usa como proxy simple de antiguedad.
  const oldestDebt =
    debts
      .map((debt) => debt.dueDate)
      .filter((dueDate): dueDate is string => Boolean(dueDate))
      .sort()[0] ?? null

  return {
    debtor,
    people,
    contacts,
    debts,
    profile: {
      totalDebt: debtor.totalDebt,
      overdueDebt: debtor.overdueDebt,
      debtCount: debtor.debtCount,
      antiquityDays: calculateDaysSinceDate(oldestDebt),
      associatedPeople: debtor.peopleCount,
      availableContacts: debtor.contactCount,
      risk: debtor.risk,
      riskScore: debtor.riskScore,
      socioeconomicLevel: 'No informado',
    },
  }
}

// Caso de uso del listado de objetos de deuda.
export async function getDebtorsDataFromService() {
  const rawData = await loadRawDebtorData()
  const mapped = mapDebtorObjectsFromRawData(rawData)

  return {
    debtors: mapped.debtors,
    warnings: mapped.warnings,
  }
}

// Caso de uso del detalle de un objeto de deuda.
export async function getDebtorDetailDataFromService(debtorId: string) {
  const rawData = await loadRawDebtorData()
  const mapped = mapDebtorObjectsFromRawData(rawData)
  const detail = mapDebtorDetailFromMappedObjects(debtorId, mapped)

  return {
    detail,
    warnings: mapped.warnings,
  }
}
