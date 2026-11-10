import { formatNumber } from '@/lib/data-presence'
import { ACTIVE_RULES } from '@/lib/domain/decision-rules-v1'
import type { DataPresence, DataWarning, DebtorListItem, NumericData, PresenceMetrics } from '@/types/equitas-domain'

// Noche 7. Textos de presentación compartidos por el tablero, los listados y las pantallas de
// análisis. No calculan nada: dan forma a lo que ya calcularon el mapeador y los selectores
// (definiciones únicas en lib/domain/portfolio-totals.ts). Sin códigos internos ni fechas crudas.

/** «1 caso», «2 casos». Sin dato: «No disponible», nunca «No disponible casos». */
export function countLabel(count: number | null, singular: string, plural: string): string {
  if (count === null || !Number.isFinite(count)) return formatNumber(null)
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}

export const casesLabel = (count: number | null) => countLabel(count, 'caso', 'casos')

export function daysLabel(days: number | null): string {
  return days === null || !Number.isFinite(days) ? formatNumber(null) : countLabel(days, 'día', 'días')
}

/** Línea única que reemplaza a los párrafos de población: solo cuando hay filtros activos. */
export function filterLine(shown: number | null, total?: number | null): string {
  if (shown === null || total === null) return 'No se puede determinar cuántos casos cumplen los filtros: falta leer algunos datos.'
  return total === undefined ? `Mostrando ${casesLabel(shown)} según los filtros.` : `Mostrando ${formatNumber(shown)} de ${casesLabel(total)} según los filtros.`
}

// Por qué falta un dato, en palabras. NO_APLICA no es un faltante: no se informa.
const PRESENCE_TEXT: Partial<Record<DataPresence, readonly [string, string]>> = {
  NO_INFORMADO_EN_ORIGEN: ['dato no informado en el archivo de origen', 'datos no informados en el archivo de origen'],
  NO_INTEGRADO: ['dato no disponible en esta versión', 'datos no disponibles en esta versión'],
  INVALIDO: ['dato con un valor inválido', 'datos con valores inválidos'],
}

/** «Deuda vencida: 1 dato no informado en el archivo de origen». Vacío si no falta nada. */
export function missingText(label: string, data: NumericData | undefined): string {
  if (!data) return ''
  const parts = Object.entries(data.missing).flatMap(([state, count]) => {
    const text = PRESENCE_TEXT[state as DataPresence]
    return text && count ? [countLabel(count, ...text)] : []
  })
  return parts.length ? `${label}: ${parts.join(', ')}` : ''
}

/** Une las notas de faltantes de varias cifras en una sola línea. */
export function missingLines(entries: readonly (readonly [string, NumericData | undefined])[]): string {
  return entries.map(([label, data]) => missingText(label, data)).filter(Boolean).join('; ')
}

// Un solo concepto visible para el puntaje (plan §6.3): «Puntaje de prioridad», de 0 a 100, por reglas.
export const SCORE_LABEL = 'Puntaje de prioridad'
export const SCORE_NOTE = 'De 0 a 100, por reglas: no es una probabilidad de pago.'

const BAND_TEXT: Record<string, string> = { ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja', ALTO: 'Alta', MEDIO: 'Media', BAJO: 'Baja' }
export const bandLabel = (band: string | null | undefined) => (band && BAND_TEXT[band]) || 'Sin banda'

export type ScoreView = { text: string; band: 'ALTA' | 'MEDIA' | 'BAJA' | null }

const BANDS = { ALTA: 'ALTA', MEDIA: 'MEDIA', BAJA: 'BAJA', ALTO: 'ALTA', MEDIO: 'MEDIA', BAJO: 'BAJA' } as const

/** «45 · Media»; «Al menos 45 · Media» cuando faltan datos de alguna obligación. */
export function scoreText(score: number | null, band: string | null | undefined, partial = false): ScoreView {
  if (score === null) return { text: 'No disponible: no se pudo evaluar', band: null }
  const code = band ? BANDS[band as keyof typeof BANDS] ?? null : null
  return { text: `${partial ? 'Al menos ' : ''}${formatNumber(score)} · ${bandLabel(code)}`, band: code }
}

/** Puntaje de un caso: con valor, «No calculable» (faltan datos) o «No disponible» (no se evaluó). */
export function scoreView(debtor: Pick<DebtorListItem, 'decision'>): ScoreView {
  const severity = debtor.decision?.severidad
  if (!severity) return scoreText(null, null)
  if (severity.valor === null) return { text: 'No calculable: faltan datos', band: null }
  return scoreText(severity.valor, severity.banda, severity.estado === 'PARCIAL')
}

// Bandas y umbral del contrato ACTIVO: si cambian las reglas, cambia el texto.
const bands = Object.fromEntries(ACTIVE_RULES.severidad.bandas.map(item => [item.codigo, item.desde]))
const legalDays = ACTIVE_RULES.banderas.verificar_prescripcion.umbral_dias_atraso
const queue = (code: keyof typeof ACTIVE_RULES.intervenciones) => ACTIVE_RULES.intervenciones[code].cola

const factors = ACTIVE_RULES.severidad.factores
/** Cómo se arma el puntaje, desde el contrato activo. */
export const SCORE_RECIPE = `Suma tres partes: deuda pendiente (hasta ${factors.monto_actualizado_ars.peso_maximo} puntos), atraso máximo (hasta ${factors.dias_atraso_maximo.peso_maximo}) y cantidad de obligaciones vencidas (hasta ${factors.cantidad_vencidas.peso_maximo}). Banda alta desde ${bands.ALTA}, media de ${bands.MEDIA} a ${bands.ALTA - 1} y baja por debajo de ${bands.MEDIA}. Un caso sin deuda vencida tiene 0.`

/** El índice anterior por persona solo se muestra si existe para alguna persona (H10). Un valor
 * inválido existe (es un faltante que se informa), aunque no se pueda usar. */
export const hasLegacyIndex = (people: readonly ({ riskValue: number | null } & PresenceMetrics)[]) =>
  people.some(person => person.riskValue !== null || (person.metrics?.riskValue?.missing.INVALIDO ?? 0) > 0)

/** Criterio de cada grupo de trabajo, en el orden en que se aplican (gana la primera que se cumple). */
export const GROUP_CRITERIA: readonly { group: string; rule: string }[] = [
  { group: queue('MEJORAR_DATOS'), rule: 'el caso no tiene un contacto activo cargado' },
  { group: queue('MEJORAR_DATOS'), rule: 'el puntaje no se puede calcular porque faltan importes o vencimientos' },
  { group: queue('REVISION_JURIDICA'), rule: `alguna obligación vencida tiene ${formatNumber(legalDays)} días o más de atraso` },
  { group: queue('CONTACTO_PERSONAL_Y_PLAN'), rule: `puntaje en banda alta (desde ${bands.ALTA})` },
  { group: queue('RECORDATORIO_INFORMATIVO'), rule: `puntaje en banda media (de ${bands.MEDIA} a ${bands.ALTA - 1})` },
  { group: queue('SEGUIMIENTO'), rule: `puntaje en banda baja (menos de ${bands.MEDIA})` },
]

// Nombres legibles de las lecturas: el nombre de la tabla queda en el detalle técnico.
const READ_LABELS: Record<string, string> = {
  debtor: 'los casos', debtor_type: 'los tipos de caso', debt: 'las obligaciones', debt_status: 'los estados de las obligaciones',
  debtor_person: 'las personas vinculadas a cada caso', person: 'las personas', debtor_contact: 'los contactos',
  contact_type: 'los tipos de contacto', debtor_profile: 'el perfil guardado de cada caso',
  debtor_profile_detail: 'el índice anterior por persona', import_batch: 'la fecha de la cartera',
}
export const readLabel = (table: string) => READ_LABELS[table] ?? 'otros datos'

// La lectura de personas agrega este aviso cuando el índice anterior no devolvió filas: puede ser
// un permiso faltante o, como en una cartera cargada desde CSV, que el dato no existe.
export const isEmptyLegacyIndexWarning = (warning: DataWarning) =>
  warning.table === 'debtor_profile_detail' && warning.message === 'No devolvió filas para esta sesión.'

/** Los avisos que agregó un filtro (no son errores de lectura): lo que no venía en la lectura. */
export function filterNotes(selection: readonly DataWarning[], read: readonly DataWarning[]): DataWarning[] {
  return selection.filter(warning => !read.includes(warning))
}
