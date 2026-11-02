import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Utilidad de Tailwind: combina clases condicionales sin duplicados.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Formato de moneda consistente en tarjetas, tablas y detalle.
export function formatCurrency(value: number | null, currency = 'ARS') {
  if (value === null || !Number.isFinite(value)) return 'No disponible'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/

// El dia se toma tal como viene escrito: sin `Date` local ni `toLocaleDateString`,
// muestra lo mismo en cualquier zona, en el servidor y en el navegador (sin desajuste
// de hidratacion). Lo imposible o ilegible se muestra tal como llego, nunca corrido.
export function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'Sin fecha'
  }

  const match = ISO_CALENDAR_DATE.exec(value.trim())

  if (!match) {
    return value
  }

  const [year, month, day] = match.slice(1).map(Number)
  const calendar = new Date(Date.UTC(year, month - 1, day))

  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return value
  }

  return `${day}/${month}/${match[1]}`
}
