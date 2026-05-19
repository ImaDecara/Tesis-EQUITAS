import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Utilidad de Tailwind: combina clases condicionales sin duplicados.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Formato de moneda consistente en tarjetas, tablas y detalle.
export function formatCurrency(value: number, currency = 'ARS') {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0)
}

// Formato de fecha seguro para valores nulos o invalidos.
export function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'Sin fecha'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleDateString('es-AR')
}
