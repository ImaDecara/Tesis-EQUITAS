import { describe, expect, it } from 'vitest'

import { formatCsvNumber, neutralizeCsvText, serializeCsv } from '@/lib/reports/csv'
import { parseCsvBytes } from '@/tests/helpers/independent-csv-parser'

const bytes = (text: string) => new TextEncoder().encode(text)
const parsed = (columns: readonly string[], rows: Record<string, string | number | boolean>[]) =>
  parseCsvBytes(bytes(serializeCsv(columns, rows)))

describe('ALIGN-028: inyeccion de formulas', () => {
  it.each([
    ['=1+1'], ['+1+1'], ['-1+1'], ['@SUM(A1)'], ['=HYPERLINK("http://x.example","y")'],
    ['-5'], ['+54 11 5555'], ['-cmd|calc'],
    // Anchos completos y signo menos: una planilla puede normalizarlos.
    ['\uFF1D1+1'], ['\uFF0B1'], ['\uFF0D1'], ['\uFF201'], ['\u22121+1'],
  ])('antepone apostrofo a %j', cell => {
    expect(neutralizeCsvText(cell)).toBe(`'${cell}`)
  })

  it.each([
    [' =1+1', "' =1+1"],
    ['   @x', "'   @x"],
    ['\t=1+1', "' =1+1"],
    ['\r=1+1', "' =1+1"],
    ['\n=1+1', "' =1+1"],
    ['\u00A0=1+1', "'\u00A0=1+1"],
    ['\u200B=1+1', "'\u200B=1+1"],
    ['\uFEFF-1', "'\uFEFF-1"],
    ['\u202E=1+1', "'\u202E=1+1"],
  ])('mira detras de los blancos y controles iniciales de %j', (cell, expected) => {
    expect(neutralizeCsvText(cell)).toBe(expected)
  })

  it.each(['TP-A018-1', 'AGUA', 'a=b', 'a-b', 'Texto con @ al medio', "'ya protegido", '12'])('no toca el texto inocuo %j', cell => {
    expect(neutralizeCsvText(cell)).toBe(cell)
  })

  it('un salto de linea interno no parte la fila ni deja una formula al inicio de una linea', () => {
    const value = neutralizeCsvText('objeto\r\n=1+1\u2028@x\u0085-1')
    expect(value).toBe('objeto  =1+1 @x -1')
    expect(value).not.toMatch(/[\r\n\u2028\u2029\u0085]/)
  })
})

describe('ALIGN-028: numeros', () => {
  it.each([
    [0, '0'], [-0, '0'], [12, '12'], [-12, '-12'], [1234.5, '1234,50'], [-1234.5, '-1234,50'],
    [1250.25, '1250,25'], [0.1 + 0.2, '0,30'], [-0.001, '0,00'], [99999999999999, '99999999999999'],
  ])('%d se escribe %s, sin miles ni apostrofo', (value, text) => {
    expect(formatCsvNumber(value)).toBe(text)
  })

  it.each([[NaN], [Infinity], [-Infinity], [1e21], [-1e21]])('%d falla: nunca sale como texto parecido a un dato', value => {
    expect(() => formatCsvNumber(value)).toThrow(RangeError)
  })

  it('un negativo tipado queda numerico y uno que llega como texto se neutraliza', () => {
    const { rows } = parsed(['importe', 'identificador'], [{ importe: -50, identificador: '-50' }])
    expect(rows[0]).toEqual({ importe: '-50', identificador: "'-50" })
  })
})

describe('ALIGN-028: estructura del archivo', () => {
  it('UTF-8 con BOM, separador ;, CRLF y encabezado', () => {
    const csv = serializeCsv(['a', 'b'], [{ a: 'uno', b: 2 }])
    expect([...bytes(csv).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(csv).toBe('\uFEFFa;b\r\nuno;2\r\n')
    const file = parseCsvBytes(bytes(csv))
    expect(file).toMatchObject({ hasBom: true, usesCrLf: true, header: ['a', 'b'] })
  })

  it('entrecomilla separador y comillas sin perder el contenido, con acentos y ñ', () => {
    const value = 'Peña "la; ñandú"; línea'
    expect(parsed(['a'], [{ a: value }]).rows[0].a).toBe(value)
  })

  it('escribe booleanos como SI y NO', () => {
    expect(parsed(['a', 'b'], [{ a: true, b: false }]).rows[0]).toEqual({ a: 'SI', b: 'NO' })
  })

  it.each([
    ['vacia', ''], ['en blanco', '   '], ['nula', null], ['indefinida', undefined], ['NaN', NaN],
  ])('una celda %s falla: una ausencia declara su estado, no queda vacia ni en 0', (_name, value) => {
    expect(() => serializeCsv(['a'], [{ a: value as never }])).toThrow()
  })

  it('una columna que falta en la fila falla', () => {
    expect(() => serializeCsv(['a', 'b'], [{ a: 'x' } as never])).toThrow(TypeError)
  })

  it('sin filas conserva el encabezado', () => {
    expect(serializeCsv(['a'], [])).toBe('\uFEFFa\r\n')
  })
})
