import costs from '../../../contracts/action-costs.v1.json'
import rules from '../../../contracts/decision-rules.v1.json'
import { WEB_ROLES } from '@/lib/auth/tenant-access'

// ALIGN-028. La base y las acciones de servidor solo exigen formato (`^[A-Z][A-Z0-9_]{0,63}$`):
// un "codigo" puede ser un nombre con su documento. Un campo editable se exporta solo si esta en
// una lista cerrada; si no, sale este valor fijo, nunca el original, y su fila se sigue contando.
// Se aplica al leer, asi que cubre tambien los eventos ya registrados.
export const NOT_CATALOGUED = 'CODIGO_NO_CATALOGADO'

// Esta lista no es el catalogo de motivos ni lo aprueba: solo dice que cadenas no llevan datos
// de una persona. Coincide con la lista provisional de ALIGN-021, sin depender de ella: si se
// integra otra, un motivo que no este aca sale como NOT_CATALOGUED hasta agregarlo.
export const EXPORTABLE_REASON_CODES: ReadonlySet<string> = new Set([
  'DATOS_INCOMPLETOS', 'VERIFICACION_JURIDICA', 'CANAL_NO_VALIDO', 'GESTION_EN_CURSO', 'ESPERA_DE_INFORMACION',
  'CORRESPONDE_A_OTRA_AREA', 'CRITERIO_DEL_SERVICIO', 'LISTA_DE_CONTROL_INSUFICIENTE', 'ALTERNATIVA_NO_OFRECIDA',
  'DATOS_CAMBIARON', 'CRITERIO_DE_SUPERVISION',
])

// Intervenciones de los dos contratos del repositorio; los niveles 3 y 4 estan en el de costos.
export const EXPORTABLE_INTERVENTIONS: ReadonlySet<string> = new Set([
  ...Object.keys(rules.intervenciones), ...costs.acciones.map(action => action.id),
])

const EXPORTABLE_ROLES: ReadonlySet<string> = new Set(WEB_ROLES)

export function controlledCode(value: unknown, allowed: ReadonlySet<string>) {
  return typeof value === 'string' && allowed.has(value) ? value : NOT_CATALOGUED
}

// Una ausencia no es un codigo desconocido: conserva su propio estado.
export function controlledOptional(value: unknown, allowed: ReadonlySet<string>) {
  return value === null || value === undefined ? null : controlledCode(value, allowed)
}

export const exportableReason = (value: unknown) => controlledOptional(value, EXPORTABLE_REASON_CODES)
export const exportableIntervention = (value: unknown) => controlledOptional(value, EXPORTABLE_INTERVENTIONS)
export const exportableRole = (value: unknown) => controlledOptional(value, EXPORTABLE_ROLES)
