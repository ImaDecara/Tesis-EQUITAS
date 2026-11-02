// ALIGN-028. Generador de CSV sin datos ni permisos: UTF-8 con BOM, separador `;`, CRLF,
// coma decimal (Excel en es-AR). ALIGN-057 reutiliza `serializeCsv` para el resumen de importacion.
export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'
const BOM = '\uFEFF'
const SEPARATOR = ';'
const LINE_END = '\r\n'

// Por encima de esto `toFixed` usa notacion exponencial o ya perdio los centavos.
const MAX_ABSOLUTE_NUMBER = 1e15

// Un numero solo se escribe con este tipo. Un texto que parece un numero sigue siendo texto.
export type CsvValue = string | number | boolean

// C0, DEL, C1 y separadores de linea Unicode: una celda es siempre una sola linea.
const LINE_BREAKS = /[\p{Cc}\u2028\u2029]/gu
// Blancos y caracteres de formato invisibles no protegen: las planillas pueden recortarlos.
// Tambien los anchos completos y el signo menos, que una planilla puede normalizar.
const FORMULA_START = /^[\s\p{Cf}]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20\u2212]/u

export function neutralizeCsvText(value: string) {
  const singleLine = value.replace(LINE_BREAKS, ' ')
  return FORMULA_START.test(singleLine) ? `'${singleLine}` : singleLine
}

// Un `number` finito solo produce `-?digitos(,dd)?`: no hay formula posible y queda numerico,
// tambien en negativo, para que la planilla lo sume. Apostrofarlo lo volveria texto.
export function formatCsvNumber(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) >= MAX_ABSOLUTE_NUMBER) throw new RangeError('Numero no representable en el CSV')
  if (Number.isInteger(value)) return String(value === 0 ? 0 : value)
  const fixed = value.toFixed(2)
  return (fixed === '-0.00' ? '0.00' : fixed).replace('.', ',')
}

// Contrato §4: una ausencia declara su estado. Una celda vacia o nula es un error del reporte.
function cellText(value: CsvValue) {
  if (typeof value === 'number') return formatCsvNumber(value)
  if (typeof value === 'boolean') return value ? 'SI' : 'NO'
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Celda sin valor: debe declarar su estado')
  return neutralizeCsvText(value)
}

function quoted(text: string) {
  return /["; ]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function serializeCsv<Column extends string>(columns: readonly Column[], rows: readonly Readonly<Record<Column, CsvValue>>[]) {
  const lines = [
    columns.map(quoted).join(SEPARATOR),
    ...rows.map(row => columns.map(column => quoted(cellText(row[column]))).join(SEPARATOR)),
  ]
  return `${BOM}${lines.join(LINE_END)}${LINE_END}`
}
