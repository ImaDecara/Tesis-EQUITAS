import type { RawRow } from '@/types/equitas-domain'

export function normalizeSelectorKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function findMatchingRowKey(row: RawRow, candidates: string[]) {
  // Camino rapido: coincidencia exacta de clave.
  for (const candidate of candidates) {
    if (candidate in row) {
      return candidate
    }
  }

  const candidateSet = new Set(candidates.map((candidate) => normalizeSelectorKey(candidate)))

  // Alternativa: coincidencia normalizada para nombres snake/camel/mixtos.
  for (const key of Object.keys(row)) {
    if (candidateSet.has(normalizeSelectorKey(key))) {
      return key
    }
  }

  return null
}

// Busca el primer valor disponible segun una lista de nombres alternativos.
export function selectValueFromRow(row: RawRow, candidates: string[]) {
  const key = findMatchingRowKey(row, candidates)

  if (!key) {
    return undefined
  }

  return row[key]
}

export function stringifyUnknownValue(value: unknown) {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

export function selectTextFromRow(row: RawRow, candidates: string[]) {
  return stringifyUnknownValue(selectValueFromRow(row, candidates))
}

export function parseBooleanFromUnknown(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value > 0
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return ['true', 't', '1', 'yes', 'y', 'si', 'activo'].includes(normalized)
  }

  return false
}

export function rowHasCandidateKey(row: RawRow, candidates: string[]) {
  return Boolean(findMatchingRowKey(row, candidates))
}
