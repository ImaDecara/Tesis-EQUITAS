import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import contract from '../../../contracts/source-contract.v1.json'
import profile from '../../../contracts/source-mapping.sintetico-csv.v1.json'
import {
  assignFiles,
  describeLoadFailure,
  describeLoadResponse,
  FILE_KINDS,
  FINDING_MESSAGES,
  findingMessage,
  formatBytes,
  headerColumns,
  IMPORT_FORMAT,
  isCalendarDay,
  optionalColumns,
  recognizeFile,
  requiredColumns,
  type SelectedFile,
} from '@/lib/domain/import-upload'

// Noche 7. Lo que la pantalla «Cargar CSV» dice del formato y de cada resultado sale del contrato de
// origen y del perfil CSV, los mismos archivos que usa el cargador.

const EXAMPLE = new URL('../../public/ejemplos/carga-csv/1-cartera-2026-09-30/', import.meta.url)
const firstLineOf = (name: string) => readFileSync(new URL(name, EXAMPLE), 'utf8').split('\n', 1)[0]
const CABECERA = firstLineOf('cabecera.csv')
const DETALLE = firstLineOf('detalle.csv')
const file = (name: string, firstLine: string, size = 1000): SelectedFile => ({ name, size, firstLine })
const HASH = 'ab'.repeat(32)
const NOT_MODIFIED = 'Esta carga no modificó la cartera ni su fecha.'

describe('columnas del contrato', () => {
  it.each(FILE_KINDS)('%s: obligatorias y opcionales son exactamente las del contrato, sin solaparse', kind => {
    const columns = contract.archivos[kind].columnas as Record<string, { requerida: boolean }>
    const required = Object.keys(columns).filter(name => columns[name].requerida)
    const optional = Object.keys(columns).filter(name => !columns[name].requerida)
    expect(requiredColumns(kind)).toEqual(required)
    expect(optionalColumns(kind)).toEqual(optional)
    expect(required.length).toBeGreaterThan(0)
    expect(requiredColumns(kind).filter(name => optionalColumns(kind).includes(name))).toEqual([])
  })

  it('cada archivo se distingue por una columna obligatoria que el otro no tiene', () => {
    expect(requiredColumns('detalle')).toContain('DEUD_id')
    expect(requiredColumns('cabecera')).not.toContain('DEUD_id')
    expect(requiredColumns('cabecera')).toContain('Destinatario_Id')
    expect(requiredColumns('detalle')).not.toContain('Destinatario_Id')
  })
})

describe('formato a la vista', () => {
  it('separador, codificación, decimales, fecha y moneda salen del perfil', () => {
    expect(IMPORT_FORMAT).toMatchObject({
      separator: profile.formato.separador, separatorName: 'coma (,)', encoding: 'UTF-8',
      decimal: ',', thousands: '.', amountExample: '1.234,50', dateFormat: 'dd/mm/aaaa', dateExample: '30/09/2026', currency: 'ARS',
    })
  })

  it('límites del contrato y del servicio, en unidades que entiende una persona', () => {
    expect(IMPORT_FORMAT.limits).toEqual({ fileBytes: 25_000_000, fileMegabytes: 25, rows: 300_000, columns: 60, records: 200_000, seconds: 180 })
    expect(IMPORT_FORMAT.quarantinePercent).toBe(Number(contract.consistencias.cuarentena_max_objetos_pct))
  })

  it('los códigos de catálogo son los del perfil, con su rótulo', () => {
    for (const catalog of IMPORT_FORMAT.catalogs) {
      const expected = Object.entries(profile.catalogos[catalog.column] as Record<string, string>).map(([code, label]) => ({ code, label }))
      expect(catalog.codes, catalog.column).toEqual(expected)
      expect(catalog.codes.length, catalog.column).toBeGreaterThan(0)
    }
    expect(IMPORT_FORMAT.catalogs.map(catalog => catalog.column)).toEqual(['Bien_Tipo_Id', 'Tipo_Ingreso_Id', 'NOTD_ESTA_id'])
  })

  it.each([[999, '1 KB'], [1, '1 KB'], [12_400, '12 KB'], [1_000_000, '1,0 MB'], [24_960_000, '25,0 MB']])('formatBytes(%i) = %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })
})

describe('encabezado y reconocimiento', () => {
  it('quita BOM, comillas, espacios y el retorno de carro de Windows', () => {
    expect(headerColumns('﻿"ClaveAgrupacion", DEUD_id ,"Cuenta"\r')).toEqual(['ClaveAgrupacion', 'DEUD_id', 'Cuenta'])
    expect(headerColumns('a,,b,')).toEqual(['a', 'b'])
    expect(headerColumns('')).toEqual([])
  })

  it('reconoce las primeras líneas reales de los archivos de ejemplo', () => {
    expect(recognizeFile(CABECERA)).toBe('cabecera')
    expect(recognizeFile(DETALLE)).toBe('detalle')
  })

  it('reconoce por columnas y no por orden ni por comillas', () => {
    const quoted = headerColumns(DETALLE).reverse().map(name => `"${name}"`).join(',')
    expect(recognizeFile(`﻿${quoted}\r`)).toBe('detalle')
  })

  it.each([
    ['otro separador', CABECERA.replaceAll(',', ';')],
    ['falta una obligatoria', headerColumns(DETALLE).filter(name => name !== 'DEUD_id').join(',')],
    ['un archivo cualquiera', 'nombre,apellido,edad'],
    ['vacío', ''],
    // Con las obligatorias de los dos archivos no se puede saber cuál es.
    ['ambiguo', [...new Set([...requiredColumns('cabecera'), ...requiredColumns('detalle')])].join(',')],
  ])('%s: no se reconoce', (_name, line) => {
    expect(recognizeFile(line)).toBeNull()
  })
})

describe('asignación de los archivos elegidos', () => {
  it('dos archivos reconocidos, en cualquier orden y con cualquier nombre', () => {
    const result = assignFiles([file('b.csv', DETALLE), file('a.csv', CABECERA)])
    expect(result).toEqual({ ok: true, files: { cabecera: file('a.csv', CABECERA), detalle: file('b.csv', DETALLE) } })
  })

  it.each([
    [0, 'Todavía no elegiste ninguno.'],
    [1, 'Elegiste uno solo.'],
    [3, 'Elegiste 3.'],
  ])('%i archivos: pide los dos juntos', (count, detail) => {
    const selected = [file('a.csv', CABECERA), file('b.csv', DETALLE), file('c.csv', DETALLE)].slice(0, count)
    expect(assignFiles(selected)).toEqual({ ok: false, problems: [`El lote son dos archivos CSV (cabecera y detalle) elegidos juntos. ${detail}`] })
  })

  it('dos cabeceras: dice cuál falta', () => {
    expect(assignFiles([file('a.csv', CABECERA), file('b.csv', CABECERA)])).toEqual({ ok: false, problems: ['Los dos archivos parecen ser de cabecera: falta el de detalle.'] })
    expect(assignFiles([file('a.csv', DETALLE), file('b.csv', DETALLE)])).toEqual({ ok: false, problems: ['Los dos archivos parecen ser de detalle: falta el de cabecera.'] })
  })

  it('vacío, demasiado grande y no reconocido se informan juntos, con el nombre de cada archivo', () => {
    const result = assignFiles([file('vacio.csv', CABECERA, 0), file('enorme.csv', 'x,y', IMPORT_FORMAT.limits.fileBytes + 1)])
    expect(result).toEqual({ ok: false, problems: [
      '«vacio.csv» está vacío.',
      '«enorme.csv» supera el máximo de 25 MB por archivo.',
      'No se reconoce «enorme.csv»: su primera línea no tiene las columnas obligatorias de la cabecera ni las del detalle (separador esperado: coma (,)).',
    ] })
  })

  it('el tamaño exacto del límite se acepta', () => {
    expect(assignFiles([file('a.csv', CABECERA, IMPORT_FORMAT.limits.fileBytes), file('b.csv', DETALLE)]).ok).toBe(true)
  })
})

describe('fecha de corte', () => {
  it.each(['2026-09-30', '2024-02-29', '2000-01-01'])('%s es un día del calendario', value => {
    expect(isCalendarDay(value)).toBe(true)
  })

  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '30/09/2026', '2026-9-30', '', '2026-09-30T00:00:00Z', ' 2026-09-30'])('%j no lo es', value => {
    expect(isCalendarDay(value)).toBe(false)
  })
})

describe('qué se esperaba, por código', () => {
  it('todo código del contrato de origen tiene un texto propio, distinto de la descripción técnica', () => {
    for (const [code, spec] of Object.entries(contract.codigos as Record<string, { descripcion: string }>)) {
      expect(FINDING_MESSAGES[code], code).toBeTruthy()
      expect(findingMessage(code, 'texto del servicio'), code).toBe(FINDING_MESSAGES[code])
      expect(FINDING_MESSAGES[code], code).not.toBe(spec.descripcion)
    }
  })

  it('los motivos que rechazan el lote completo también tienen texto', () => {
    for (const code of ['CUARENTENA_EXCEDE_OBJETOS', 'CUARENTENA_EXCEDE_IMPORTE', 'CUARENTENA_IMPORTE_NO_EVALUABLE', 'LOTE_VACIO']) {
      expect(contract.codigos_resumen, code).toHaveProperty(code)
      expect(findingMessage(code, ''), code).not.toBe('')
    }
    expect(findingMessage('CUARENTENA_EXCEDE_OBJETOS', '')).toBe(`Más del ${contract.consistencias.cuarentena_max_objetos_pct} % de los objetos tiene errores.`)
  })

  it('los textos de importes, fechas y catálogos dicen el formato y la lista admitida', () => {
    expect(findingMessage('IMPORTE_NO_NUMERICO', '')).toContain('1.234,50')
    expect(findingMessage('FECHA_FORMATO_INVALIDO', '')).toContain('dd/mm/aaaa (ejemplo: 30/09/2026)')
    expect(findingMessage('TIPO_BIEN_FUERA_DE_CATALOGO', '')).toContain(Object.keys(profile.catalogos.Bien_Tipo_Id).join(', '))
    expect(findingMessage('ARCHIVO_NO_LEIBLE', '')).toContain('UTF-8')
  })

  it('un código desconocido usa la descripción que envía el servicio', () => {
    expect(findingMessage('CODIGO_NUEVO_DEL_SERVICIO', 'Descripción del servicio.')).toBe('Descripción del servicio.')
  })
})

describe('resultado de la carga', () => {
  it.each([
    ['PUBLICADO', 'loaded', 'Carga completada', true],
    ['YA_CARGADO', 'already', 'Este lote ya estaba cargado', false],
    ['RECHAZADO', 'rejected', 'El lote no se cargó', false],
    ['REQUIERE_CONFIRMACION', 'retry', 'Este lote tiene un intento anterior sin completar', false],
    ['NO_CONFIRMADO', 'unconfirmed', 'No se pudo confirmar el resultado', false],
    ['NO_COMPLETADO', 'service', 'La carga no se completó', false],
  ] as const)('%s → %s; solo PUBLICADO afirma que la cartera cambió', (resultado, kind, title, changed) => {
    const body = { resultado, mensaje: 'Mensaje del servicio.', fecha_corte: '2026-09-30' }
    // El código HTTP no cambia el desenlace cuando el cuerpo lo nombra.
    for (const status of [200, 409, 422, 500]) {
      expect(describeLoadResponse(status, body)).toEqual({ kind, title, message: 'Mensaje del servicio.', portfolioChanged: changed, revision: null, body })
    }
  })

  it('sin mensaje del servicio el texto queda vacío, no inventado', () => {
    expect(describeLoadResponse(200, { resultado: 'PUBLICADO' }).message).toBe('')
  })

  it('401: la sesión venció y la carga no cambió nada', () => {
    expect(describeLoadResponse(401, { detail: 'AUTH_REQUIRED' })).toMatchObject({
      kind: 'session', title: 'La sesión venció', message: `Volvé a ingresar y repetí la carga. ${NOT_MODIFIED}`, portfolioChanged: false,
    })
  })

  it('403 por rol y 403 por origen se explican distinto', () => {
    expect(describeLoadResponse(403, { detail: 'ROLE_FORBIDDEN' })).toMatchObject({
      kind: 'forbidden', title: 'Tu cuenta no puede cargar CSV',
      message: `Cargar CSV cambia la cartera de todo el municipio y requiere una cuenta ADMIN. ${NOT_MODIFIED}`,
    })
    expect(describeLoadResponse(403, { detail: 'ORIGIN_NOT_ALLOWED' })).toMatchObject({
      kind: 'forbidden', message: `La solicitud no vino de esta aplicación. ${NOT_MODIFIED}`,
    })
    expect(describeLoadResponse(403, null)).toMatchObject({ kind: 'forbidden', message: expect.stringContaining('requiere una cuenta ADMIN') })
  })

  it('413 sin cuerpo: el tamaño se informa como un problema de lo elegido', () => {
    expect(describeLoadResponse(413, null)).toMatchObject({ kind: 'input', title: 'Revisá lo que elegiste', message: `Los archivos superan el máximo de 25 MB por archivo. ${NOT_MODIFIED}` })
  })

  it.each([
    ['AS_OF_INVALIDO', 'Indicá la fecha de corte de los datos'],
    ['ARCHIVOS_REQUERIDOS', 'cabecera y detalle'],
    ['FORMATO_NO_SOPORTADO', 'Excel'],
    ['ARCHIVO_VACIO', 'vacío'],
    ['ARCHIVO_DUPLICADO', 'dos veces'],
    ['ARCHIVO_NO_ESPERADO', 'no es cabecera ni detalle'],
    ['REVISION_INVALIDA', 'referencia del reintento'],
    ['LIMITE_ARCHIVO_EXCEDIDO', '25 MB'],
    ['UPLOAD_TIEMPO_EXCEDIDO', 'tardó demasiado'],
    ['UPLOAD_INTERRUMPIDO', 'se interrumpió'],
    ['MULTIPART_REQUERIDO', 'formato esperado'],
  ])('entrada %s: problema de lo elegido, que no cambió nada', (code, fragment) => {
    for (const status of [400, 413, 422]) {
      const result = describeLoadResponse(status, { detail: code })
      expect(result.kind, `${code} ${status}`).toBe('input')
      expect(result.message).toContain(fragment)
      expect(result.message.endsWith(NOT_MODIFIED)).toBe(true)
      expect(result.portfolioChanged).toBe(false)
    }
  })

  it.each([
    'IMPORT_SERVICE_UNAVAILABLE', 'IMPORT_WRITER_NOT_CONFIGURED', 'API_NOT_CONFIGURED', 'AUTH_UNAVAILABLE',
    'CONTEXT_UNAVAILABLE', 'ALMACEN_TEMPORAL_INSEGURO', 'TENANT_SELECTION_REQUIRED', 'NOT_FOUND',
  ])('%s ocurre antes de escribir: falla del servicio, nunca «rechazado»', code => {
    const result = describeLoadResponse(503, { detail: code })
    expect(result).toMatchObject({ kind: 'service', title: 'La carga no se completó', portfolioChanged: false })
    expect(result.message).toContain(NOT_MODIFIED)
    expect(result.message).toContain('Comprobá que el entorno local esté en marcha')
  })

  it.each([
    ['504 sin resultado conocido', 504, { detail: 'IMPORT_RESULT_UNKNOWN' }],
    ['502 del reenvío', 502, { detail: 'IMPORT_SERVICE_ERROR' }],
    ['500 sin cuerpo', 500, null],
    ['200 sin resultado', 200, {}],
    ['cuerpo que no es objeto', 200, 'texto'],
    ['resultado desconocido', 200, { resultado: 'OTRO' }],
  ])('%s: resultado desconocido; no afirma que nada cambió ni culpa al archivo', (_name, status, payload) => {
    const result = describeLoadResponse(status, payload)
    expect(result).toMatchObject({ kind: 'unconfirmed', title: 'No se pudo confirmar el resultado', portfolioChanged: false })
    expect(result.message).toContain('Repetí la misma carga')
    expect(result.message).not.toContain(NOT_MODIFIED)
    expect(result.kind).not.toBe('rejected')
  })

  it('una red caída da el mismo resultado desconocido', () => {
    expect(describeLoadFailure()).toEqual({ ...describeLoadResponse(500, null), body: {} })
  })

  it.each([
    [HASH, HASH],
    ['AB'.repeat(32), null],
    ['ab'.repeat(31), null],
    [`${HASH}0`, null],
    [123, null],
    [null, null],
  ])('revisión %j → %j: solo con forma de hash', (revision, expected) => {
    expect(describeLoadResponse(200, { resultado: 'REQUIERE_CONFIRMACION', revision }).revision).toBe(expected)
  })
})
