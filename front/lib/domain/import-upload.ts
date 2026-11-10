import contract from '../../../contracts/source-contract.v1.json'
import profile from '../../../contracts/source-mapping.sintetico-csv.v1.json'

// Noche 7. Todo lo que la pantalla «Cargar CSV» dice del formato sale de los mismos archivos que usa
// el cargador (contrato de origen y perfil CSV): si el formato cambia, la pantalla cambia con él.
// Sin I/O ni dependencias de Next: lo usan la página (servidor) y el formulario (navegador).

export type FileKind = 'cabecera' | 'detalle'
export const FILE_KINDS: readonly FileKind[] = ['cabecera', 'detalle']

export const FILE_ROLES: Readonly<Record<FileKind, { title: string; contains: string }>> = {
  cabecera: { title: 'Cabecera', contains: 'una fila por objeto y titular: el objeto, la persona y sus contactos' },
  detalle: { title: 'Detalle', contains: 'una fila por obligación de cada objeto' },
}

type ColumnSpec = { requerida: boolean; tipo: string }
const columnsOf = (kind: FileKind) => contract.archivos[kind].columnas as Record<string, ColumnSpec>

export function requiredColumns(kind: FileKind): string[] {
  return Object.entries(columnsOf(kind)).filter(([, spec]) => spec.requerida).map(([name]) => name)
}

export function optionalColumns(kind: FileKind): string[] {
  return Object.entries(columnsOf(kind)).filter(([, spec]) => !spec.requerida).map(([name]) => name)
}

const SEPARATOR_NAMES: Readonly<Record<string, string>> = { ',': 'coma (,)', ';': 'punto y coma (;)', '\t': 'tabulación' }
const DATE_EXAMPLES: Readonly<Record<string, string>> = { 'dd/mm/aaaa': '30/09/2026', 'aaaa-mm-dd': '2026-09-30' }
const CATALOG_COLUMNS = [
  { column: 'Bien_Tipo_Id', file: 'cabecera y detalle', meaning: 'tipo de objeto' },
  { column: 'Tipo_Ingreso_Id', file: 'cabecera y detalle', meaning: 'tributo' },
  { column: 'NOTD_ESTA_id', file: 'detalle', meaning: 'estado de la obligación en el origen (puede venir vacío)' },
] as const

export const IMPORT_FORMAT = {
  separator: profile.formato.separador,
  separatorName: SEPARATOR_NAMES[profile.formato.separador] ?? profile.formato.separador,
  encoding: profile.formato.codificacion.toUpperCase(),
  decimal: profile.formato.decimal,
  thousands: profile.formato.miles,
  amountExample: `1${profile.formato.miles}234${profile.formato.decimal}50`,
  dateFormat: profile.formato.fecha,
  dateExample: DATE_EXAMPLES[profile.formato.fecha] ?? profile.formato.fecha,
  currency: profile.moneda,
  // Columna que une cada fila con su objeto en los dos archivos (contrato de origen).
  groupingColumn: contract.claves.enlace,
  // Columna de la cabecera con el identificador visible del caso (el que muestran los listados).
  identifierColumn: 'Identificador',
  catalogs: CATALOG_COLUMNS.map(item => ({
    ...item,
    codes: Object.entries(profile.catalogos[item.column] as Record<string, string>).map(([code, label]) => ({ code, label })),
  })),
  limits: {
    fileBytes: contract.limites.bytes,
    fileMegabytes: Math.floor(contract.limites.bytes / 1_000_000),
    rows: contract.limites.filas,
    columns: contract.limites.columnas,
    // Topes del servicio de importación (back/api/import_load.py y services/import_preview_process.py).
    records: 200_000,
    seconds: 180,
  },
  quarantinePercent: Number(contract.consistencias.cuarentena_max_objetos_pct),
} as const

// Encabezado de un CSV: nombres de columna sin comillas ni espacios. Alcanza para reconocer el archivo;
// la lectura real (comillas, codificación, filas) la hace el servicio de importación.
export function headerColumns(firstLine: string): string[] {
  return firstLine.replace(/^﻿/, '').replace(/\r$/, '').split(IMPORT_FORMAT.separator)
    .map(name => name.trim().replace(/^"(.*)"$/, '$1').trim()).filter(Boolean)
}

// Cada archivo se reconoce por sus columnas obligatorias, nunca por su nombre.
export function recognizeFile(firstLine: string): FileKind | null {
  const columns = new Set(headerColumns(firstLine))
  const matches = FILE_KINDS.filter(kind => requiredColumns(kind).every(name => columns.has(name)))
  // La cabecera no tiene DEUD_id y el detalle no tiene Destinatario_Id: un archivo solo puede ser uno de los dos.
  return matches.length === 1 ? matches[0] : null
}

export type SelectedFile = { name: string; size: number; firstLine: string }
export type FileAssignment =
  | { ok: true; files: Record<FileKind, SelectedFile> }
  | { ok: false; problems: string[] }

export function assignFiles(selected: readonly SelectedFile[]): FileAssignment {
  const problems: string[] = []
  if (selected.length !== 2) {
    return { ok: false, problems: [`El lote son dos archivos CSV (cabecera y detalle) elegidos juntos. ${selected.length === 1 ? 'Elegiste uno solo.' : selected.length === 0 ? 'Todavía no elegiste ninguno.' : `Elegiste ${selected.length}.`}`] }
  }
  const files: Partial<Record<FileKind, SelectedFile>> = {}
  for (const file of selected) {
    if (file.size === 0) problems.push(`«${file.name}» está vacío.`)
    else if (file.size > IMPORT_FORMAT.limits.fileBytes) problems.push(`«${file.name}» supera el máximo de ${IMPORT_FORMAT.limits.fileMegabytes} MB por archivo.`)
    const kind = recognizeFile(file.firstLine)
    if (!kind) problems.push(`No se reconoce «${file.name}»: su primera línea no tiene las columnas obligatorias de la cabecera ni las del detalle (separador esperado: ${IMPORT_FORMAT.separatorName}).`)
    else if (files[kind]) problems.push(`Los dos archivos parecen ser de ${FILE_ROLES[kind].title.toLowerCase()}: falta el de ${kind === 'cabecera' ? 'detalle' : 'cabecera'}.`)
    else files[kind] = file
  }
  return problems.length || !files.cabecera || !files.detalle ? { ok: false, problems } : { ok: true, files: files as Record<FileKind, SelectedFile> }
}

export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

// ---- Qué se esperaba, en palabras de quien corrige el archivo

const codes = (column: 'Bien_Tipo_Id' | 'Tipo_Ingreso_Id' | 'NOTD_ESTA_id') => Object.keys(profile.catalogos[column]).join(', ')
const AMOUNT_HINT = `Se espera un número con decimales con «${profile.formato.decimal}» y miles con «${profile.formato.miles}», sin símbolo de moneda (ejemplo: 1${profile.formato.miles}234${profile.formato.decimal}50).`
const DATE_HINT = `Se espera una fecha ${profile.formato.fecha} (ejemplo: ${DATE_EXAMPLES[profile.formato.fecha] ?? profile.formato.fecha}).`

// Un texto por cada código del contrato de origen. Si el servicio informa un código que no está acá,
// se muestra la descripción que envía: nunca queda un hallazgo sin explicación.
export const FINDING_MESSAGES: Readonly<Record<string, string>> = {
  DUPLICADO_IDENTICO: 'La fila está repetida tal cual: se toma una sola vez.',
  ESTADO_ORIGEN_NO_INFORMADO: 'La obligación no trae estado. Se carga con estado «Desconocido» y se calcula por importe y vencimiento.',
  CONTACTO_PLACEHOLDER: 'El valor es un marcador de «no tiene» (0, - o NO POSEE): no se cuenta como contacto.',
  CONTACTO_FORMATO_INVALIDO: 'El contacto no tiene forma de teléfono ni de correo: no se cuenta como contacto.',
  CONTACTO_INACTIVO: 'El contacto figura dado de baja: no se cuenta como contacto.',
  CUENTA_NO_CANONICA: 'La cuenta debe ser un número entero sin ceros a la izquierda, signos ni espacios.',
  IDENTIFICADOR_INVALIDO: 'El identificador numérico está vacío o no es un entero válido.',
  CAMPO_OBLIGATORIO_VACIO: 'Esta columna es obligatoria y la celda está vacía.',
  IMPORTE_VACIO: `Falta el importe. ${AMOUNT_HINT}`,
  IMPORTE_NO_NUMERICO: `El importe no tiene el formato del lote. ${AMOUNT_HINT}`,
  IMPORTE_NEGATIVO: 'El importe es negativo: se espera cero o un valor positivo.',
  IMPORTE_FUERA_DE_RANGO: 'El importe es demasiado grande para registrarse.',
  FECHA_VACIA: `Falta la fecha de vencimiento. ${DATE_HINT}`,
  FECHA_CENTINELA: `La fecha es un valor de relleno (como 00/00/0000), no una fecha real. ${DATE_HINT}`,
  FECHA_FORMATO_INVALIDO: `La fecha no tiene el formato del lote. ${DATE_HINT}`,
  FECHA_IMPOSIBLE: `Ese día no existe en el calendario. ${DATE_HINT}`,
  ESTADO_ORIGEN_DESCONOCIDO: `El código de estado no está en la lista admitida (${codes('NOTD_ESTA_id')}).`,
  ESTADOS_ORIGEN_CONFLICTIVOS: 'Las dos columnas de estado de la obligación se contradicen.',
  ESTADO_OBJETO_DESCONOCIDO: 'El estado del objeto debe ser «Activo» o «Inactivo» (o venir vacío).',
  TIPO_BIEN_FUERA_DE_CATALOGO: `El tipo de objeto no está en la lista admitida (${codes('Bien_Tipo_Id')}).`,
  TIPO_INGRESO_FUERA_DE_CATALOGO: `El tributo no está en la lista admitida (${codes('Tipo_Ingreso_Id')}).`,
  DUPLICADO_CONFLICTIVO: 'Hay dos filas con la misma clave y contenido distinto: no se puede saber cuál vale.',
  DETALLE_SIN_CABECERA: 'La obligación apunta a un objeto que no está en el archivo de cabecera (revisá ClaveAgrupacion).',
  CLAVE_AGRUPACION_AMBIGUA: 'La misma ClaveAgrupacion aparece para objetos distintos.',
  CABECERAS_INCONSISTENTES: 'Las filas de los titulares de un mismo objeto no coinciden en los datos del objeto.',
  CUENTA_DETALLE_DIFERENTE: 'La cuenta del detalle no coincide con la de la cabecera para esa ClaveAgrupacion.',
  TIPO_BIEN_DETALLE_DIFERENTE: 'El tipo de objeto del detalle no coincide con el de la cabecera para esa ClaveAgrupacion.',
  CONCILIACION_DIFERENTE: 'Deuda_Actualizada de la cabecera no coincide con la suma de las obligaciones del detalle.',
  PORCENTAJE_INVALIDO: 'El porcentaje debe ser un número entre 0 y 100.',
  ENTERO_INVALIDO: 'Se espera un número entero, sin decimales ni signo.',
  ARCHIVO_NO_LEIBLE: `El archivo no se pudo leer como texto ${profile.formato.codificacion.toUpperCase()}.`,
  ESTRUCTURA_INVALIDA: 'El encabezado está repetido o vacío, o la fila no tiene la misma cantidad de columnas que el encabezado.',
  COLUMNA_OBLIGATORIA_AUSENTE: 'Falta esta columna obligatoria en el encabezado del archivo.',
  LIMITE_ARCHIVO_EXCEDIDO: 'El archivo supera un límite de tamaño, filas, columnas o longitud de celda.',
  // Motivos por los que se rechaza el lote completo.
  CUARENTENA_EXCEDE_OBJETOS: `Más del ${contract.consistencias.cuarentena_max_objetos_pct} % de los objetos tiene errores.`,
  CUARENTENA_EXCEDE_IMPORTE: `Los objetos con errores suman más del ${contract.consistencias.cuarentena_max_importe_pct} % del importe del lote.`,
  CUARENTENA_IMPORTE_NO_EVALUABLE: 'Faltan importes, así que no se puede comprobar cuánto del lote quedaría afuera.',
  LOTE_VACIO: 'El lote no trae ningún objeto.',
}

export function findingMessage(code: string, fallback: string): string {
  return FINDING_MESSAGES[code] ?? fallback
}

// ---- Resultado de la carga, tal como lo devuelve el servicio de importación (back/api/import_load.py)

export type Finding = { archivo: string; linea: number; columna: string; codigo: string; descripcion: string; efecto: string }
export type FindingGroup = { total: number; por_codigo: { codigo: string; descripcion: string; cantidad: number }[]; detalle: Finding[] }
export type LoadSummary = {
  objetos: number | null; objetos_aceptados: number | null; objetos_en_cuarentena: number | null
  personas: number | null; obligaciones: number | null
  filas?: Record<string, { leidas: number; aceptadas: number; rechazadas: number }>
}
export type LoadBody = {
  resultado?: string; mensaje?: string; detail?: string; codigo?: string; fecha_corte?: string; lote?: number
  resumen?: LoadSummary; errores?: FindingGroup; advertencias?: FindingGroup; truncado?: boolean
  hallazgos_total?: number; hallazgos_mostrados?: number
  motivos?: { codigo: string; descripcion: string }[]
  estructura?: { codigo: string; descripcion: string; archivo: string | null; linea: number | null; columna: string | null }
  revision?: string | null; estado_anterior?: string | null; ausentes?: Record<string, number>
}

export type OutcomeKind = 'loaded' | 'already' | 'rejected' | 'retry' | 'service' | 'unconfirmed' | 'forbidden' | 'session' | 'input'
export type LoadOutcome = {
  kind: OutcomeKind
  title: string
  message: string
  // true solo cuando se sabe que la cartera cambió con esta carga.
  portfolioChanged: boolean
  // Referencia para reintentar de forma explícita el mismo lote, si el servicio la entregó.
  revision: string | null
  body: LoadBody
}

const INPUT_MESSAGES: Readonly<Record<string, string>> = {
  AS_OF_INVALIDO: 'Indicá la fecha de corte de los datos (día, mes y año).',
  ARCHIVOS_REQUERIDOS: 'El lote necesita los dos archivos CSV: cabecera y detalle.',
  FORMATO_NO_SOPORTADO: 'En esta versión el lote son dos archivos CSV. Los libros de Excel todavía no se pueden cargar.',
  ARCHIVO_VACIO: 'Uno de los archivos está vacío.',
  ARCHIVO_DUPLICADO: 'Se envió dos veces el mismo tipo de archivo.',
  ARCHIVO_NO_ESPERADO: 'Se envió un archivo que no es cabecera ni detalle.',
  REVISION_INVALIDA: 'La referencia del reintento no es válida. Volvé a elegir los archivos y cargalos de nuevo.',
  LIMITE_ARCHIVO_EXCEDIDO: `Los archivos superan el máximo de ${IMPORT_FORMAT.limits.fileMegabytes} MB por archivo.`,
  UPLOAD_TIEMPO_EXCEDIDO: 'La subida tardó demasiado y se interrumpió. Probá de nuevo.',
  UPLOAD_INTERRUMPIDO: 'La subida se interrumpió antes de terminar. Probá de nuevo.',
  MULTIPART_REQUERIDO: 'La solicitud no llegó con el formato esperado. Recargá la página y probá de nuevo.',
}
// Lo único que se afirma es lo demostrable: qué hizo ESTA carga.
const NOT_MODIFIED = 'Esta carga no modificó la cartera ni su fecha.'
const UNKNOWN_RESULT = 'No se pudo confirmar si la carga se completó. Repetí la misma carga: si ya había entrado, la aplicación lo va a informar y no se duplica nada.'

// Respuestas que solo pueden ocurrir ANTES de que el servicio de importación empiece a trabajar: con ellas
// se puede afirmar que esta carga no escribió nada. Cualquier otra respuesta sin `resultado` (un corte por
// tiempo, un error interno) es un resultado desconocido: el servicio pudo haber seguido hasta publicar.
const BEFORE_ANY_WRITE: Readonly<Record<string, string>> = {
  IMPORT_SERVICE_UNAVAILABLE: 'El servicio de importación local no está en marcha.',
  IMPORT_WRITER_NOT_CONFIGURED: 'El servicio de importación local no tiene configurada su credencial.',
  API_NOT_CONFIGURED: 'El servicio de importación local no está configurado para la base local.',
  AUTH_UNAVAILABLE: 'No se pudo verificar tu sesión en este momento.',
  CONTEXT_UNAVAILABLE: 'No se pudo verificar tu municipio y tu rol en este momento.',
  ALMACEN_TEMPORAL_INSEGURO: 'El servicio de importación no pudo usar su carpeta temporal privada.',
  TENANT_SELECTION_REQUIRED: 'Tu cuenta tiene acceso a más de un municipio y esta versión de la carga necesita uno solo.',
  NOT_FOUND: 'La ruta de carga no existe en esta instalación.',
}

function outcome(kind: OutcomeKind, title: string, message: string, body: LoadBody, portfolioChanged = false): LoadOutcome {
  const revision = typeof body.revision === 'string' && /^[0-9a-f]{64}$/.test(body.revision) ? body.revision : null
  return { kind, title, message, portfolioChanged, revision, body }
}

// Traduce la respuesta HTTP a lo que la persona necesita leer. Una falla del servicio nunca se presenta
// como un error del archivo, solo «loaded» afirma que la cartera cambió, y «no la modificó» se dice
// únicamente cuando se sabe.
export function describeLoadResponse(status: number, payload: unknown): LoadOutcome {
  const body: LoadBody = payload !== null && typeof payload === 'object' ? payload as LoadBody : {}
  const message = typeof body.mensaje === 'string' ? body.mensaje : ''
  switch (body.resultado) {
    case 'PUBLICADO': return outcome('loaded', 'Carga completada', message, body, true)
    case 'YA_CARGADO': return outcome('already', 'Este lote ya estaba cargado', message, body)
    case 'RECHAZADO': return outcome('rejected', 'El lote no se cargó', message, body)
    case 'REQUIERE_CONFIRMACION': return outcome('retry', 'Este lote tiene un intento anterior sin completar', message, body)
    case 'NO_CONFIRMADO': return outcome('unconfirmed', 'No se pudo confirmar el resultado', message, body)
    case 'NO_COMPLETADO': return outcome('service', 'La carga no se completó', message, body)
  }
  const code = typeof body.detail === 'string' ? body.detail : ''
  if (status === 401) return outcome('session', 'La sesión venció', `Volvé a ingresar y repetí la carga. ${NOT_MODIFIED}`, body)
  if (status === 403) {
    return outcome('forbidden', 'Tu cuenta no puede cargar CSV', code === 'ORIGIN_NOT_ALLOWED'
      ? `La solicitud no vino de esta aplicación. ${NOT_MODIFIED}`
      : `Cargar CSV cambia la cartera de todo el municipio y requiere una cuenta ADMIN. ${NOT_MODIFIED}`, body)
  }
  if (INPUT_MESSAGES[code]) return outcome('input', 'Revisá lo que elegiste', `${INPUT_MESSAGES[code]} ${NOT_MODIFIED}`, body)
  if (status === 413) return outcome('input', 'Revisá lo que elegiste', `${INPUT_MESSAGES.LIMITE_ARCHIVO_EXCEDIDO} ${NOT_MODIFIED}`, body)
  if (BEFORE_ANY_WRITE[code]) {
    return outcome('service', 'La carga no se completó', `${BEFORE_ANY_WRITE[code]} ${NOT_MODIFIED} Comprobá que el entorno local esté en marcha y probá de nuevo.`, body)
  }
  return outcome('unconfirmed', 'No se pudo confirmar el resultado', UNKNOWN_RESULT, body)
}

// Cuando la solicitud no llegó a tener respuesta (corte de red): no se sabe qué pasó.
export function describeLoadFailure(): LoadOutcome {
  return outcome('unconfirmed', 'No se pudo confirmar el resultado', UNKNOWN_RESULT, {})
}

export function formatBytes(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`
}
