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

// Un instante, no una fecha de calendario: se muestra en la hora del municipio, igual en
// cualquier servidor. Lo que no se pueda interpretar se muestra tal como llegó.
const CORDOBA_DATE_TIME = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Cordoba', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function formatDateTime(value: string) {
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? value : CORDOBA_DATE_TIME.format(instant)
}
