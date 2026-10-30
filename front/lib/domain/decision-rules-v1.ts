import contract from '../../../contracts/decision-rules.v1.json'
import type { DataPresence } from '@/types/equitas-domain'

// Importación estática: sin I/O, reloj, red ni dependencias de Next. La copia
// privada impide que otro consumidor del JSON cambie esta versión en memoria.
const rules = structuredClone(contract)
export const RULES_VERSION: string = rules.version

export type RuleDatum<T> = Readonly<
  | { estado: 'OBSERVADO'; valor: T }
  | { estado: Exclude<DataPresence, 'OBSERVADO'>; valor: null }
>
export type VulnerabilityValue = 'INDICIO_VULNERABILIDAD' | 'SIN_INDICIO'
export type DecisionObligation = Readonly<{
  id: string
  current_amount: RuleDatum<number>
  due_date: RuleDatum<string>
  estado_origen: RuleDatum<string | number>
  periodo_fiscal: RuleDatum<string | number>
}>
export type DecisionInput = Readonly<{
  id: string
  as_of: string
  source_updated_at: RuleDatum<string>
  obligaciones: readonly DecisionObligation[]
  contactos_activos: RuleDatum<number>
  personas: readonly Readonly<{
    tipo: RuleDatum<'FISICA' | 'JURIDICA' | 'UNKNOWN'>
    porcentaje_declarado: RuleDatum<number>
  }>[]
  vulnerabilidad: RuleDatum<VulnerabilityValue>
}>

export type SeverityState = keyof typeof rules.explicacion.severidad_texto
export type SeverityFactor = keyof typeof rules.severidad.factores
export type FlagCode = keyof typeof rules.banderas.definiciones
export type InterventionCode = keyof typeof rules.intervenciones
export type InterventionRule = Exclude<keyof typeof rules.explicacion.frases_contrastivas, 'M1'>
export type MissingReason = keyof typeof rules.evaluabilidad.detalle_no_evaluables.etiquetas
export type Severity = {
  valor: number | null
  banda: string
  estado: SeverityState
  monto_actualizado_ars: number | null
  dias_atraso_maximo: number | null
  cantidad_vencidas: number | null
  vencimiento_mas_antiguo: string | null
  obligaciones_no_evaluables: number
  motivos_no_evaluables: { motivo: MissingReason; estado: DataPresence; cantidad: number }[]
}
export type FactorExplanation = {
  factor: SeverityFactor
  insumo: number | null
  puntos: number | null
  maximo: number
}
export type Intervention = {
  codigo: InterventionCode
  intensidad: number
  canal_requerido: boolean
  regla: InterventionRule
  modificador: string | null
}
export type Decision = {
  severidad: Severity
  banderas: FlagCode[]
  vulnerabilidad: {
    valor: VulnerabilityValue | 'NO_INFORMADA'
    efecto: 'TOPE_INTENSIDAD_1_Y_REVISION' | 'NINGUNO'
  }
  intervencion: Intervention
  revision: {
    requiere_revision_humana: boolean
    motivos: (keyof typeof rules.revision.motivos)[]
  }
  prioridad: { cola: InterventionCode; valor: number | null }
  explicacion: { factores: FactorExplanation[]; frase_contrastiva: string }
  mensaje_borrador: { plantilla_id: string; estado: string } | null
}

function observed<T>(datum: RuleDatum<T>): T | null {
  if (!datum || !rules.estados_de_presencia.includes(datum.estado)) {
    throw new TypeError('Estado de presencia inválido')
  }
  if (datum.estado === 'OBSERVADO') {
    if (datum.valor == null) throw new TypeError('OBSERVADO requiere un valor')
    return datum.valor
  }
  if (datum.valor !== null) throw new TypeError('Un dato no observado debe tener valor null')
  return null
}

function finiteNumber(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Se requiere un número finito')
  }
  return value
}

function safeInteger(value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError('Importe fuera del rango de centavos seguros')
  return value
}

/** Centavos decimales exactos. También lo usa el adaptador para declarar INVALIDO. */
export function amountInCents(value: number): number {
  const { units, places } = decimalParts(value)
  const scale = places - 2
  const divisor = BigInt(10) ** BigInt(Math.max(scale, 0))
  if (units % divisor !== BigInt(0)) {
    throw new RangeError('El importe debe ser un número exacto de centavos')
  }
  return safeInteger(Number(units / divisor * BigInt(10) ** BigInt(Math.max(-scale, 0))))
}

function calendarDay(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) {
    throw new TypeError('Se requiere una fecha ISO YYYY-MM-DD')
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError('Se requiere una fecha ISO YYYY-MM-DD válida')
  }
  return date.getTime() / 86_400_000
}

function band<T extends { desde: number }>(value: number, bands: readonly T[]): T {
  // Las bandas del contrato son ascendentes y comienzan en cero.
  return bands.reduce((selected, item) => value >= item.desde ? item : selected, bands[0])
}

/** Severidad y factores a un corte explícito; no consulta personas ni contactos. */
export function evaluateSeverity(entry: Pick<DecisionInput, 'as_of' | 'obligaciones'>): {
  severidad: Severity; factores: FactorExplanation[]
} {
  const cutoff = calendarDay(entry.as_of)
  const minimum = calendarDay(rules.evaluabilidad.fecha_minima_plausible)
  const obligations = entry.obligaciones
  if (!Array.isArray(entry.obligaciones)) {
    throw new TypeError('Las obligaciones deben ser una lectura completa (lista)')
  }
  const counts = new Map<string, number>()
  const reason = (code: MissingReason, state: DataPresence) => {
    const key = `${code}/${state}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let evaluable = 0
  let totalCents = 0
  let overdue = 0
  let oldest: string | null = null
  let maxDays: number | null = null
  for (const obligation of obligations) {
    const amount = observed(obligation.current_amount)
    const amountCents = amount === null ? null : amountInCents(amount)
    const dueValue = observed(obligation.due_date)
    const due = dueValue === null ? null : calendarDay(dueValue)
    let valid = true
    if (amount === null) {
      reason('IMPORTE_NO_OBSERVADO', obligation.current_amount.estado)
      valid = false
    } else if (finiteNumber(amount) < 0) {
      reason('IMPORTE_NEGATIVO', 'OBSERVADO')
      valid = false
    }
    if (due === null) {
      reason('VENCIMIENTO_NO_OBSERVADO', obligation.due_date.estado)
      valid = false
    } else if (due < minimum) {
      reason('VENCIMIENTO_INCONSISTENTE', 'OBSERVADO')
      valid = false
    }
    if (valid && amountCents !== null && due !== null && dueValue !== null) {
      totalCents = safeInteger(totalCents + amountCents)
      evaluable += 1
      if (amountCents > 0 && due < cutoff) {
        overdue += 1
        maxDays = Math.max(maxDays ?? 0, cutoff - due)
        if (oldest === null || dueValue < oldest) oldest = dueValue
      }
    }
  }
  const missing = entry.obligaciones.length - evaluable
  const state: SeverityState = !missing ? 'COMPLETA' : evaluable ? 'PARCIAL' : 'NO_DISPONIBLE'
  const severity: Severity = {
    valor: null,
    banda: rules.severidad.banda_sin_valor,
    estado: state,
    monto_actualizado_ars: state === 'NO_DISPONIBLE' ? null : totalCents / 100,
    dias_atraso_maximo: maxDays,
    cantidad_vencidas: state === 'NO_DISPONIBLE' ? null : overdue,
    vencimiento_mas_antiguo: oldest,
    obligaciones_no_evaluables: missing,
    motivos_no_evaluables: [],
  }
  for (const code of rules.evaluabilidad.motivos_no_evaluable as MissingReason[]) {
    for (const presence of rules.estados_de_presencia as DataPresence[]) {
      const count = counts.get(`${code}/${presence}`)
      if (count) severity.motivos_no_evaluables.push({ motivo: code, estado: presence, cantidad: count })
    }
  }
  const factors = (rules.explicacion.factores as SeverityFactor[]).map((name) => {
    const definition = rules.severidad.factores[name]
    const input = severity[name]
    // No hay mora: cero derivado en los tres factores, sin ocultar el monto.
    const value = overdue ? input! : 0
    const monetary = name === 'monto_actualizado_ars'
    const bands = monetary
      ? definition.bandas.map((item) => ({ ...item, desde: amountInCents(item.desde) }))
      : definition.bandas
    const points = state === 'NO_DISPONIBLE' ? null : band(monetary ? amountInCents(value) : value, bands).puntos
    return { factor: name, insumo: input, puntos: points, maximo: definition.peso_maximo }
  })
  if (state !== 'NO_DISPONIBLE') {
    severity.valor = factors.reduce((total, factor) => total + factor.puntos!, 0)
    severity.banda = band(severity.valor, rules.severidad.bandas).codigo
  }
  return { severidad: severity, factores: factors }
}

// Compara la suma decimal declarada, sin redondear porcentajes ni introducir
// falsos positivos por IEEE-754 en 99,99/100,01. Equivale a Decimal(str(n)).
function decimalParts(value: number) {
  const [coefficient, exponent = '0'] = String(finiteNumber(value)).split('e')
  const places = (coefficient.split('.')[1]?.length ?? 0) - Number(exponent)
  return { units: BigInt(coefficient.replace('.', '')), places }
}

function percentagesOutsideTolerance(values: number[]): boolean {
  const decimals = [...values, -100, rules.banderas.tolerancia_porcentajes].map(decimalParts)
  const scale = decimals.reduce((maximum, item) => Math.max(maximum, item.places), decimals[0].places)
  const units = decimals.map((item) => item.units * BigInt(10) ** BigInt(scale - item.places))
  const tolerance = units.pop()!
  const difference = units.reduce((total, value) => total + value, BigInt(0))
  return (difference < BigInt(0) ? -difference : difference) > tolerance
}

/** Banderas en el orden del JSON; ninguna agrega puntos. */
export function evaluateFlags(entry: DecisionInput, severity: Severity): FlagCode[] {
  const contacts = observed(entry.contactos_activos)
  const percentages = entry.personas.map((person) => {
    const value = observed(person.porcentaje_declarado)
    return value === null ? null : finiteNumber(value)
  })
  const types = entry.personas.map((person) => observed(person.tipo))
  const updated = observed(entry.source_updated_at)
  const updatedDay = updated === null ? null : calendarDay(updated)
  const cutoff = calendarDay(entry.as_of)
  const origin = entry.obligaciones.map((item) => observed(item.estado_origen))
  const periods = entry.obligaciones.map((item) => observed(item.periodo_fiscal))
  const conditions: Record<FlagCode, boolean> = {
    SIN_CONTACTO_ACTIVO: contacts === null || finiteNumber(contacts) < 1,
    PORCENTAJES_NO_SUMAN_100: percentages.length > 0 && (
      percentages.some((value) => value === null) || percentagesOutsideTolerance(percentages as number[])
    ),
    ESTADO_ORIGEN_NO_INFORMADO: origin.some((value) => value === null),
    PERIODO_NO_INFORMADO: periods.some((value) => value === null),
    FECHAS_INCONSISTENTES: severity.motivos_no_evaluables.some(
      (item) => item.motivo === 'VENCIMIENTO_INCONSISTENTE'
    ) || (updatedDay !== null && updatedDay > cutoff),
    TIPO_PERSONA_DESCONOCIDO: types.some((value) => value === null || value === 'UNKNOWN'),
    VERIFICAR_PRESCRIPCION: severity.dias_atraso_maximo !== null &&
      severity.dias_atraso_maximo >= rules.banderas.verificar_prescripcion.umbral_dias_atraso,
  }
  return (rules.banderas.orden as FlagCode[]).filter((code) => conditions[code])
}

/** Primera regla aplicable del JSON, seguida del modificador M1. */
export function suggestIntervention(
  severity: Severity, flags: readonly FlagCode[], vulnerability: VulnerabilityValue | null
): Intervention {
  const conditions: Record<string, boolean> = {
    SIN_CONTACTO_ACTIVO: flags.includes('SIN_CONTACTO_ACTIVO'),
    'severidad NO_DISPONIBLE': severity.estado === 'NO_DISPONIBLE',
    VERIFICAR_PRESCRIPCION: flags.includes('VERIFICAR_PRESCRIPCION'),
    'banda ALTA': severity.banda === 'ALTA',
    'banda MEDIA': severity.banda === 'MEDIA',
    'banda BAJA y severidad > 0': severity.banda === 'BAJA' && severity.valor !== null && severity.valor > 0,
    'severidad = 0': severity.valor === 0,
  }
  const table = rules.reglas_intervencion.reglas
  const rule = table.find((item) => conditions[item.condicion])!
  let code = rule.intervencion as InterventionCode
  let intensity = rule.intensidad
  const vulnerable = vulnerability === 'INDICIO_VULNERABILIDAD'
  if (vulnerable) {
    intensity = Math.min(intensity, rules.vulnerabilidad.tope_intensidad_con_indicio)
    // El efecto M1 está en prosa en el JSON: R4 adopta la intervención de R5.
    if (rule.id === 'R4') code = table.find((item) => item.id === 'R5')!.intervencion as InterventionCode
  }
  return {
    codigo: code,
    intensidad: intensity,
    canal_requerido: intensity >= 1,
    regla: rule.id as InterventionRule,
    modificador: vulnerable ? rules.reglas_intervencion.modificador_vulnerabilidad.id : null,
  }
}

function format(template: string, values: Record<string, string | number | null>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]))
}

/** Texto exacto del contrato, incluido el detalle de cada dato no evaluable. */
export function explainDecision(severity: Severity, intervention: Intervention, total: number): string {
  const config = rules.explicacion
  const details = rules.evaluabilidad.detalle_no_evaluables
  const labels = severity.motivos_no_evaluables.map((item) =>
    `${format(details.etiquetas[item.motivo], { estado: item.estado })}: ${item.cantidad}`
  )
  // El sufijo del campo texto es una instrucción de unión, no texto visible.
  const detail = [format(details.texto.split('; {etiqueta}')[0], {
    obligaciones_no_evaluables: severity.obligaciones_no_evaluables,
    obligaciones_leidas: total,
  }), ...labels].join('; ')
  const thresholds = Object.fromEntries(rules.severidad.bandas.map((item) => [item.codigo, item.desde]))
  const key = intervention.modificador && intervention.regla === 'R4' ? 'M1' : intervention.regla
  const partial: Partial<Record<typeof key, string>> = config.frases_contrastivas_parcial
  const template = severity.estado === 'PARCIAL'
    ? `${partial[key]} ${config.complemento_parcial}`
    : config.frases_contrastivas[key]
  return format(template, {
    severidad_texto: format(config.severidad_texto[severity.estado], { valor: severity.valor }),
    umbral_alta: thresholds.ALTA,
    umbral_media: thresholds.MEDIA,
    umbral_prescripcion: rules.banderas.verificar_prescripcion.umbral_dias_atraso,
    detalle_no_evaluables: detail,
  })
}

export function calculatePriority(severity: Severity, intervention: Intervention): Decision['prioridad'] {
  return { cola: intervention.codigo, valor: severity.valor }
}

/**
 * Evalúa una lectura completa y normalizada sin mutarla. El llamador conserva
 * id, as_of y RULES_VERSION junto al resultado (misma estructura que Python).
 * Un fallo de lectura debe detenerse en el adaptador: jamás reemplazarlo por [].
 */
export function evaluateDecisionRulesV1(entry: DecisionInput): Decision {
  if (typeof entry.id !== 'string' || !entry.id || [...entry.id].some((char) => char.charCodeAt(0) > 127)) {
    throw new TypeError('El id debe ser texto ASCII no vacío')
  }
  const { severidad: severity, factores: factors } = evaluateSeverity(entry)
  const flags = evaluateFlags(entry, severity)
  const vulnerability = observed(entry.vulnerabilidad)
  if (vulnerability !== null && !rules.entrada.valores_vulnerabilidad_observada.includes(vulnerability)) {
    throw new TypeError('Valor de vulnerabilidad no reconocido')
  }
  const vulnerable = vulnerability === 'INDICIO_VULNERABILIDAD'
  const intervention = suggestIntervention(severity, flags, vulnerability)
  const reasons = {
    INDICIO_VULNERABILIDAD: vulnerable,
    SEVERIDAD_PARCIAL: severity.estado === 'PARCIAL',
  }
  const review = (rules.revision.orden_motivos as (keyof typeof reasons)[]).filter((key) => reasons[key])
  const messageConfig = rules.mensajes_borrador
  const messageKey = intervention.codigo === 'SEGUIMIENTO'
    ? `${intervention.codigo}_intensidad_${intervention.intensidad}` : intervention.codigo
  const selection: Partial<Record<string, string>> = messageConfig.seleccion
  const messageId = selection[messageKey]
  return {
    severidad: severity,
    banderas: flags,
    vulnerabilidad: {
      valor: vulnerability ?? 'NO_INFORMADA',
      efecto: vulnerable ? 'TOPE_INTENSIDAD_1_Y_REVISION' : 'NINGUNO',
    },
    intervencion: intervention,
    revision: { requiere_revision_humana: review.length > 0, motivos: review },
    prioridad: calculatePriority(severity, intervention),
    explicacion: { factores: factors, frase_contrastiva: explainDecision(severity, intervention, entry.obligaciones.length) },
    mensaje_borrador: messageId ? { plantilla_id: messageId, estado: messageConfig.estado } : null,
  }
}

export type PrioritizedDecision = Readonly<{ id: string; decision: Decision }>

function compareNullable<T extends string | number>(left: T | null, right: T | null, descending = false): number {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return (left < right ? -1 : 1) * (descending ? -1 : 1)
}

/** Comparador para Array.sort, únicamente dentro de una misma cola; null al final. */
export function comparePriority(left: PrioritizedDecision, right: PrioritizedDecision): number {
  const a = left.decision
  const b = right.decision
  if (a.prioridad.cola !== b.prioridad.cola) {
    throw new RangeError('Las prioridades de colas distintas no se comparan')
  }
  const amount = (severity: Severity) => severity.monto_actualizado_ars === null
    ? null : amountInCents(severity.monto_actualizado_ars)
  return compareNullable(a.prioridad.valor, b.prioridad.valor, true)
    || compareNullable(amount(a.severidad), amount(b.severidad), true)
    || compareNullable(a.severidad.vencimiento_mas_antiguo, b.severidad.vencimiento_mas_antiguo)
    || compareNullable(left.id, right.id)
}
