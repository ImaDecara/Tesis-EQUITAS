// Convierte un texto de fecha en una fecha valida o null.
export function parseDateValue(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// Resuelve un estado simple de deuda a partir del vencimiento.
export function resolveDebtStatusFromDueDate(dueDate: string | null) {
  const parsed = parseDateValue(dueDate)

  if (!parsed) {
    return 'Sin estado'
  }

  return parsed < new Date() ? 'Vencida' : 'Vigente'
}

// Calcula antiguedad en dias desde una fecha.
export function calculateDaysSinceDate(value: string | null) {
  const parsed = parseDateValue(value)

  if (!parsed) {
    return 0
  }

  const diffMs = Date.now() - parsed.getTime()
  return Math.max(Math.floor(diffMs / (1000 * 60 * 60 * 24)), 0)
}
