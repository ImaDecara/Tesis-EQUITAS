import type { RawRow } from '@/types/equitas-domain'

import { selectValueFromRow } from '@/lib/parsers/generic-value-selector'

// Normaliza numeros que pueden venir como string, null o con formato mixto.
export function parseNumericValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.replace(',', '.').replace(/[^0-9.-]/g, '')
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

// Atajo: selecciona y parsea un numero desde una fila.
export function selectNumericValueFromRow(row: RawRow, candidates: string[]) {
  return parseNumericValue(selectValueFromRow(row, candidates))
}
