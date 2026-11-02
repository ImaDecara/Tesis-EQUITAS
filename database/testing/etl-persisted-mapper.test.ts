// ALIGN-026. Filas leídas de la base local por etl_semantic_local.py → mapeador real del frontend.
// No forma parte de la suite aislada: lo lanza ese script con su configuración de vitest y un archivo temporal.
import { readFileSync } from 'node:fs'
import { mapDebtorObjectsFromRawData } from '@/lib/mappers/debtor-object-mapper'

const rowsPath = process.env.EQUITAS_ETL_PERSISTED_ROWS
if (!rowsPath) throw new Error('Falta EQUITAS_ETL_PERSISTED_ROWS: esta prueba la lanza etl_semantic_local.py')
const { raw, expected } = JSON.parse(readFileSync(rowsPath, 'utf8'))
const { debtors } = mapDebtorObjectsFromRawData(raw)

describe('filas persistidas por la carga V1', () => {
  it.each(expected)('$caso', ({ debtor, overdue, delay }) => {
    const item = debtors.find(candidate => candidate.id === String(debtor))
    expect(item?.metrics?.overdueDebt.presence).toBe(overdue.presence)
    expect(item?.metrics?.overdueDebt.missing).toEqual(overdue.missing)
    if (overdue.value === null) expect(item?.metrics?.overdueDebt.value).toBeNull()
    else expect(item?.metrics?.overdueDebt.value).toBeCloseTo(overdue.value, 2)
    expect(item?.metrics?.maxDaysOverdue.presence).toBe(delay)
  })
})
