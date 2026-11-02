// ALIGN-028. Parser RFC 4180 propio de las pruebas: no importa nada del generador.
// Trabaja sobre bytes para ver el BOM, que `Response.text()` descarta en silencio.
const BOM_BYTES = [0xef, 0xbb, 0xbf]

export type ParsedCsv = {
  hasBom: boolean
  separator: string
  usesCrLf: boolean
  header: string[]
  rows: Record<string, string>[]
}

function splitRecords(text: string, separator: string) {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char !== '"') field += char
      else if (text[index + 1] === '"') { field += '"'; index++ }
      else quoted = false
    } else if (char === '"' && field === '') quoted = true
    else if (char === separator) { record.push(field); field = '' }
    else if (char === '\r' && text[index + 1] === '\n') {
      record.push(field); records.push(record); record = []; field = ''; index++
    } else if (char === '\n' || char === '\r') throw new Error('Salto de linea fuera de comillas')
    else field += char
  }
  if (quoted) throw new Error('Comilla sin cerrar')
  if (field !== '' || record.length) throw new Error('El archivo no termina en CRLF')
  return records
}

export function parseCsvBytes(bytes: Uint8Array, separator = ';'): ParsedCsv {
  const hasBom = BOM_BYTES.every((byte, index) => bytes[index] === byte)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.slice(BOM_BYTES.length) : bytes)
  const [header, ...records] = splitRecords(text, separator)
  if (!header) throw new Error('Archivo sin encabezado')
  return {
    hasBom,
    separator,
    usesCrLf: !/(?<!\r)\n/.test(text),
    header,
    rows: records.map((record, position) => {
      if (record.length !== header.length) throw new Error(`Fila ${position + 2}: ${record.length} celdas, se esperaban ${header.length}`)
      return Object.fromEntries(header.map((name, index) => [name, record[index]]))
    }),
  }
}

// Numero con coma decimal y sin miles. Devuelve null si la celda declara un estado.
export function csvNumber(cell: string) {
  return /^-?\d+(?:,\d{2})?$/.test(cell) ? Number(cell.replace(',', '.')) : null
}

// Centavos enteros: comparar sumas sin acumular error de punto flotante.
export function csvCents(cell: string) {
  const match = /^(-?)(\d+)(?:,(\d{2}))?$/.exec(cell)
  if (!match) return null
  const cents = Number(match[2]) * 100 + Number(match[3] ?? 0)
  return match[1] ? -cents : cents
}

export function sumCents(rows: Record<string, string>[], column: string) {
  return rows.reduce((total, row) => total + (csvCents(row[column]) ?? 0), 0)
}
