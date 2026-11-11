import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ImportResult } from '@/components/import/import-result'
import { describeLoadResponse, FILE_KINDS, IMPORT_FORMAT, requiredColumns, type FindingGroup, type LoadBody } from '@/lib/domain/import-upload'
import { markupOf, renderedText, viewerFixture } from '@/tests/helpers/viewer-fixtures'
import type { ViewerContext } from '@/lib/server/viewer-context'

// Noche 7. Pantalla «Cargar CSV»: el resultado de una carga (sin estado propio) y la página de servidor.
const config = vi.hoisted(() => ({ supabaseUrl: 'http://127.0.0.1:54321' }))
const session = vi.hoisted(() => ({ viewer: vi.fn() }))
vi.mock('@/lib/supabase-config', () => ({ get supabaseUrl() { return config.supabaseUrl }, hasSupabaseCredentials: true }))
vi.mock('@/lib/server/viewer-context', () => ({ loadViewerContext: session.viewer }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import ImportPage from '@/app/import/page'

const HASH = 'c'.repeat(64)
const group = (findings: FindingGroup['detalle'], porCodigo: FindingGroup['por_codigo']): FindingGroup => ({ total: findings.length, por_codigo: porCodigo, detalle: findings })
const ERRORS = group([
  { archivo: 'detalle', linea: 7, columna: 'NOTD_totalActualizado', codigo: 'IMPORTE_NO_NUMERICO', descripcion: 'Importe no numérico.', efecto: 'CUARENTENA' },
  { archivo: 'cabecera', linea: 0, columna: '*', codigo: 'CODIGO_DESCONOCIDO', descripcion: 'Descripción que envía el servicio.', efecto: 'CUARENTENA' },
], [
  { codigo: 'IMPORTE_NO_NUMERICO', descripcion: 'Importe no numérico.', cantidad: 1 },
  { codigo: 'CODIGO_DESCONOCIDO', descripcion: 'Descripción que envía el servicio.', cantidad: 1 },
])
const WARNINGS = group([
  { archivo: 'detalle', linea: 3, columna: 'NOTD_ESTA_id', codigo: 'ESTADO_ORIGEN_NO_INFORMADO', descripcion: 'UNKNOWN', efecto: 'ALERTA' },
], [{ codigo: 'ESTADO_ORIGEN_NO_INFORMADO', descripcion: 'UNKNOWN', cantidad: 1 }])
const SUMMARY = { objetos: 12, objetos_aceptados: 11, objetos_en_cuarentena: 1, personas: 14, obligaciones: 1234 }

const render = (status: number, body: LoadBody, onRetry?: () => void, retrying = false) => {
  const markup = markupOf(createElement(ImportResult, { outcome: describeLoadResponse(status, body), onRetry, retrying }))
  return { markup, text: renderedText(createElement(ImportResult, { outcome: describeLoadResponse(status, body), onRetry, retrying })) }
}
const tableRows = (markup: string, kind: string) => {
  const section = markup.match(new RegExp(`<section[^>]*data-findings="${kind}"[\\s\\S]*?</section>`))?.[0] ?? ''
  return [...section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].slice(1).map(row => [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1]))
}

describe('resultado de la carga', () => {
  it('publicada: resumen con fecha, objetos, obligaciones, personas y cuarentena, y enlace al tablero', () => {
    const { markup, text } = render(200, { resultado: 'PUBLICADO', mensaje: 'Se publicó la cartera.', fecha_corte: '2026-09-30', resumen: SUMMARY, advertencias: WARNINGS })
    expect(markup).toContain('data-load-result="loaded"')
    expect(markup).toContain('role="status"')
    expect(text).toContain('Carga completada Se publicó la cartera.')
    expect(text).toContain('Fecha de corte 30/9/2026')
    expect(text).toContain('Objetos incorporados 11 de 12')
    expect(text).toContain('Obligaciones en el archivo 1.234')
    expect(text).toContain('Personas en el archivo 14')
    expect(text).toContain('1 objeto quedó fuera porque alguna de sus filas tiene un error')
    expect(markup).toMatch(/<a [^>]*href="\/"[^>]*>Ver el tablero<\/a>/)
    expect(markup).not.toContain('data-findings="errores"')
    expect(markup).not.toContain('data-retry')
  })

  it('sin cuarentena lo dice; cifras ausentes son «No disponible», no cero', () => {
    const { text } = render(200, { resultado: 'PUBLICADO', resumen: { objetos: null, objetos_aceptados: null, objetos_en_cuarentena: 0, personas: null, obligaciones: 0 } })
    expect(text).toContain('Fecha de corte No disponible')
    expect(text).toContain('Objetos incorporados No disponible de No disponible')
    expect(text).toContain('Obligaciones en el archivo 0')
    expect(text).toContain('Ningún objeto quedó en cuarentena.')
    const plural = render(200, { resultado: 'PUBLICADO', resumen: { ...SUMMARY, objetos_en_cuarentena: 3 } }).text
    expect(plural).toContain('3 objetos quedaron fuera')
  })

  it('ya cargado: lo dice, sin errores, con enlace al tablero', () => {
    const { markup, text } = render(200, { resultado: 'YA_CARGADO', mensaje: 'Ese lote ya estaba.' })
    expect(markup).toContain('data-load-result="already"')
    expect(text).toContain('Este lote ya estaba cargado Ese lote ya estaba.')
    expect(markup).toContain('Ver el tablero')
  })

  // Prueba final (F2): un rechazo decía «Objetos incorporados: 15 de 21» junto a «El lote no se cargó».
  it('rechazado: el resumen no dice «incorporados»; dice cuántos objetos vienen sin errores y que no entró ninguno', () => {
    const { markup, text } = render(200, { resultado: 'RECHAZADO', mensaje: 'No se cargó nada.', fecha_corte: '2026-10-31',
      resumen: { objetos: 21, objetos_aceptados: 15, objetos_en_cuarentena: 6, personas: 21, obligaciones: 40 }, errores: ERRORS })
    expect(markup).toContain('data-summary-objects="sin-errores"')
    expect(text).toContain('Objetos sin errores en el archivo 15 de 21 No se incorporó ninguno.')
    expect(text).not.toContain('Objetos incorporados')
    expect(text).toContain('Con errores 6 objetos tienen un error en alguna de sus filas; el detalle está abajo.')
    expect(text).not.toMatch(/quedaron fuera|cuarentena/i)
  })

  // Un rechazo por carga parcial llega con todos los objetos sin errores: tampoco entró ninguno.
  it('rechazado sin objetos con errores: sigue sin decir «incorporados» y no habla de cuarentena', () => {
    const { text } = render(200, { resultado: 'RECHAZADO', mensaje: 'Faltan objetos que ya estaban cargados.',
      resumen: { objetos: 20, objetos_aceptados: 20, objetos_en_cuarentena: 0, personas: 20, obligaciones: 38 } })
    expect(text).toContain('Objetos sin errores en el archivo 20 de 20 No se incorporó ninguno.')
    expect(text).toContain('Con errores Ningún objeto tiene errores propios.')
    expect(text).not.toMatch(/Objetos incorporados|cuarentena/i)
  })

  it.each([
    ['REQUIERE_CONFIRMACION', 409], ['NO_CONFIRMADO', 503], ['NO_COMPLETADO', 503],
  ])('%s: tampoco afirma que se incorporaron objetos', (resultado, status) => {
    const { markup } = render(status, { resultado, mensaje: 'x', resumen: SUMMARY, revision: 'a'.repeat(64) } as LoadBody)
    expect(markup).not.toContain('Objetos incorporados')
  })

  // Prueba final (F1): la cuarentena daba archivo, fila y columna, pero no cómo saber qué caso es.
  it('con objetos en cuarentena o con errores dice cómo ubicar el caso de cada fila en el archivo', () => {
    for (const body of [{ resultado: 'PUBLICADO', resumen: SUMMARY }, { resultado: 'RECHAZADO', resumen: SUMMARY }] as LoadBody[]) {
      const { markup, text } = render(200, body)
      expect(markup).toContain('data-row-hint')
      expect(text).toContain(`su columna «${IMPORT_FORMAT.groupingColumn}», que une las filas de un mismo objeto en los dos archivos`)
      expect(text).toContain(`El identificador del caso es la columna «${IMPORT_FORMAT.identifierColumn}» de la fila de la cabecera`)
    }
    expect(IMPORT_FORMAT.groupingColumn).toBe('ClaveAgrupacion')
    expect(requiredColumns('cabecera')).toContain('ClaveAgrupacion')
    expect(requiredColumns('detalle')).toContain('ClaveAgrupacion')
    expect(requiredColumns('cabecera')).toContain(IMPORT_FORMAT.identifierColumn)
    expect(render(200, { resultado: 'PUBLICADO', resumen: { ...SUMMARY, objetos_en_cuarentena: 0 } }).markup).not.toContain('data-row-hint')
  })

  it('cargado o ya cargado: ahí sí son objetos incorporados', () => {
    for (const resultado of ['PUBLICADO', 'YA_CARGADO']) {
      const { markup, text } = render(200, { resultado, resumen: SUMMARY } as LoadBody)
      expect(markup).toContain('data-summary-objects="incorporados"')
      expect(text).toContain('Objetos incorporados 11 de 12')
      expect(text).not.toContain('No se incorporó ninguno')
    }
  })

  it('rechazado: errores con archivo, fila, columna y qué se esperaba; advertencias aparte; sin enlace al tablero', () => {
    const { markup, text } = render(200, { resultado: 'RECHAZADO', mensaje: 'No se cargó nada.', errores: ERRORS, advertencias: WARNINGS,
      motivos: [{ codigo: 'CUARENTENA_EXCEDE_OBJETOS', descripcion: 'técnico' }, { codigo: 'MOTIVO_NUEVO', descripcion: 'Motivo que envía el servicio.' }] })
    expect(markup).toContain('data-load-result="rejected"')
    expect(markup).toContain('role="alert"')
    expect(text).toContain('Errores para corregir: 2')
    expect(text).toContain('Advertencias (no impiden la carga): 1')
    expect(tableRows(markup, 'errores')).toEqual([
      ['Detalle', '7', 'NOTD_totalActualizado', expect.stringContaining('El importe no tiene el formato del lote.')],
      ['Cabecera', 'Todo el archivo', 'Toda la fila', 'Descripción que envía el servicio.'],
    ])
    expect(tableRows(markup, 'advertencias')).toEqual([['Detalle', '3', 'NOTD_ESTA_id', expect.stringContaining('La obligación no trae estado.')]])
    expect(text).toContain('1 × El importe no tiene el formato del lote.')
    expect(text).toMatch(/Más del \d+ % de los objetos tiene errores\./)
    expect(text).toContain('Motivo que envía el servicio.')
    expect(markup).not.toContain('Ver el tablero')
  })

  it('error de estructura: con archivo, fila y columna cuando el servicio los informa', () => {
    const full = render(200, { resultado: 'RECHAZADO', estructura: { codigo: 'COLUMNA_OBLIGATORIA_AUSENTE', descripcion: 'x', archivo: 'detalle', linea: 1, columna: 'DEUD_id' } }).text
    expect(full).toContain('Falta esta columna obligatoria en el encabezado del archivo. Archivo: Detalle. Fila: 1. Columna: DEUD_id.')
    const bare = render(200, { resultado: 'RECHAZADO', estructura: { codigo: 'ARCHIVO_NO_LEIBLE', descripcion: 'x', archivo: null, linea: null, columna: null } }).text
    expect(bare).toContain('El archivo no se pudo leer como texto UTF-8.')
    expect(bare).not.toMatch(/Archivo:|Fila:|Columna:/)
  })

  it('truncado: dice cuántos hallazgos se muestran de cuántos', () => {
    expect(render(200, { resultado: 'RECHAZADO', errores: ERRORS, truncado: true, hallazgos_mostrados: 2, hallazgos_total: 500 }).text)
      .toContain('Se muestran los primeros 2 de 500 hallazgos; los totales de arriba cuentan todos.')
    expect(render(200, { resultado: 'RECHAZADO', errores: ERRORS }).text).not.toContain('Se muestran los primeros')
  })

  it('un grupo sin hallazgos no dibuja tabla', () => {
    expect(render(200, { resultado: 'RECHAZADO', errores: group([], []) }).markup).not.toContain('data-findings')
  })

  it('«Reintentar» solo con una revisión válida y una acción; muestra que está en curso', () => {
    const retry = vi.fn()
    const offered = render(200, { resultado: 'REQUIERE_CONFIRMACION', mensaje: 'Hay un intento anterior.', revision: HASH }, retry)
    expect(offered.markup).toContain('data-load-result="retry"')
    expect(offered.markup).toMatch(/<button[^>]*data-retry[^>]*>Reintentar esta misma carga<\/button>/)
    expect(render(200, { resultado: 'REQUIERE_CONFIRMACION', revision: HASH }, retry, true).markup).toMatch(/<button[^>]*disabled[^>]*>Reintentando…<\/button>/)
    expect(render(200, { resultado: 'REQUIERE_CONFIRMACION', revision: HASH }).markup).not.toContain('data-retry')
    expect(render(200, { resultado: 'REQUIERE_CONFIRMACION', revision: 'no-es-hash' }, retry).markup).not.toContain('data-retry')
    expect(offered.markup).not.toContain('Ver el tablero')
  })

  it.each([
    [503, { detail: 'IMPORT_SERVICE_UNAVAILABLE' }, 'service'],
    [504, { detail: 'IMPORT_RESULT_UNKNOWN' }, 'unconfirmed'],
    [403, { detail: 'ROLE_FORBIDDEN' }, 'forbidden'],
    [422, { detail: 'AS_OF_INVALIDO' }, 'input'],
  ] as const)('%i %j: sin enlace al tablero ni tabla de errores', (status, body, kind) => {
    const { markup } = render(status, body)
    expect(markup).toContain(`data-load-result="${kind}"`)
    expect(markup).not.toContain('Ver el tablero')
    expect(markup).not.toContain('data-findings')
  })

  it('sesión vencida: ofrece volver a ingresar y regresar a la carga', () => {
    expect(render(401, { detail: 'AUTH_REQUIRED' }).markup).toMatch(/href="\/login\?next=%2Fimport"[^>]*>Volver a ingresar/)
  })
})

describe('página «Cargar CSV»', () => {
  beforeEach(() => {
    vi.stubEnv('EQUITAS_IMPORT_API_URL', 'http://127.0.0.1:8010')
    config.supabaseUrl = 'http://127.0.0.1:54321'
    session.viewer.mockResolvedValue(viewerFixture('ADMIN'))
  })
  afterEach(() => { vi.unstubAllEnvs() })

  const page = async () => {
    const node = await ImportPage()
    return { markup: markupOf(node), text: renderedText(node) }
  }

  it('ADMIN con el servicio disponible: formulario, formato, límites, códigos de catálogo y ejemplos', async () => {
    const { markup, text } = await page()
    expect(markup).toContain('data-import-form')
    expect(markup).toMatch(/<input id="import-files" type="file" multiple="" accept=".csv,text\/csv"[^>]*name="files"/)
    expect(markup).toMatch(/<input id="import-as-of" type="date" required=""[^>]*name="as_of"/)
    expect(text).toContain('Cartera vigente de Municipio sintético: al 30/9/2026.')
    for (const kind of FILE_KINDS) expect(text).toContain(`Columnas obligatorias: ${requiredColumns(kind).join(', ')}.`)
    expect(text).toContain('coma (,); codificación UTF-8')
    expect(text).toContain('Ejemplo: 1.234,50')
    expect(text).toContain('dd/mm/aaaa. Ejemplo: 30/09/2026')
    expect(text).toContain('No viene en los archivos: hay que indicarla al cargar.')
    expect(text).toContain(`Hasta ${IMPORT_FORMAT.limits.fileMegabytes} MB y 300.000 filas por archivo`)
    for (const catalog of IMPORT_FORMAT.catalogs) {
      expect(markup).toContain(`data-catalog="${catalog.column}"`)
      expect(text).toContain(catalog.codes.map(item => `${item.code} = ${item.label}`).join(' · '))
    }
    expect(text).toContain('El lote representa la cartera completa')
    for (const folder of ['1-cartera-2026-09-30', '2-cartera-2026-10-31-con-errores', '3-cartera-2026-10-31']) {
      for (const kind of FILE_KINDS) expect(markup).toContain(`href="/ejemplos/carga-csv/${folder}/${kind}.csv"`)
    }
    expect(markup).not.toContain('data-import-notice')
    // La terminal no aparece en ninguna instrucción para quien usa la aplicación.
    expect(text).not.toMatch(/terminal|python|equitas_local|\.py\b/i)
  })

  it('USER: explica por qué no puede cargar, sin formulario, y conserva el formato a la vista', async () => {
    session.viewer.mockResolvedValue(viewerFixture('USER'))
    const { markup, text } = await page()
    expect(text).toContain('Tu cuenta no puede cargar CSV')
    expect(text).toContain('solo lo hace una cuenta con rol ADMIN. Tu cuenta es Usuario')
    expect(markup).not.toContain('data-import-form')
    expect(markup).not.toContain('data-load-button-disabled')
    expect(text).toContain('Qué archivos espera la carga')
  })

  it.each([
    ['instalación no conectada a la base local', () => { config.supabaseUrl = 'https://proyecto.supabase.example.test' }, 'no está conectada a la base local de pruebas'],
    ['URL de la base ilegible', () => { config.supabaseUrl = 'no-es-url' }, 'no está conectada a la base local de pruebas'],
    ['servicio de importación sin configurar', () => { vi.stubEnv('EQUITAS_IMPORT_API_URL', '') }, 'El servicio de importación local no está configurado'],
    ['servicio de importación no local', () => { vi.stubEnv('EQUITAS_IMPORT_API_URL', 'http://servicio.example.test:8010') }, 'El servicio de importación local no está configurado'],
  ])('ADMIN con %s: botón deshabilitado y explicación', async (_name, arrange, explanation) => {
    arrange()
    const { markup, text } = await page()
    expect(text).toContain('La carga de CSV está deshabilitada en esta instalación')
    expect(text).toContain(explanation)
    expect(markup).toMatch(/<button[^>]*disabled[^>]*data-load-button-disabled[^>]*>Cargar CSV<\/button>/)
    expect(markup).not.toContain('data-import-form')
  })

  it('sesión no verificable: pide volver a ingresar, sin formulario', async () => {
    session.viewer.mockResolvedValue(null)
    const { markup, text } = await page()
    expect(text).toContain('No se pudo verificar tu sesión')
    expect(markup).toContain('href="/login?next=%2Fimport"')
    expect(markup).not.toContain('data-import-form')
  })

  it.each([
    [{ kind: 'EMPTY' }, 'Municipio sintético todavía no tiene cartera cargada. Esta va a ser la primera.'],
    [{ kind: 'UNAVAILABLE' }, 'No se pudo determinar la fecha de la cartera vigente.'],
  ] as [ViewerContext['portfolio'], string][])('ADMIN sin cartera vigente (%j): lo dice y ofrece el formulario', async (portfolio, sentence) => {
    session.viewer.mockResolvedValue(viewerFixture('ADMIN', portfolio))
    const { markup, text } = await page()
    expect(text).toContain(sentence)
    expect(text).not.toContain('Cartera vigente de')
    expect(markup).toContain('data-import-form')
  })

  it('sin nombre de municipio usa un texto genérico', async () => {
    session.viewer.mockResolvedValue({ ...viewerFixture('ADMIN', { kind: 'EMPTY' }), tenantName: null })
    expect((await page()).text).toContain('Tu municipio todavía no tiene cartera cargada.')
  })
})
