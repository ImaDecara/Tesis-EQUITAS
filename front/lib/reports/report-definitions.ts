// Noche 7 (plan §6.6 y §9.3). Qué es una fila de cada reporte y cómo se define cada total, en palabras.
// Lo muestran la pantalla «Reportes» y la «Ayuda»; las mismas definiciones que el tablero y la ficha
// (lib/domain/portfolio-totals.ts). Sin I/O ni React.

export type Definition = Readonly<{ term: string; text: string }>

/** Las tres definiciones de importes, iguales en toda pantalla y todo reporte. */
export const PORTFOLIO_TOTALS: readonly Definition[] = [
  { term: 'Total registrado', text: 'Importe de todas las obligaciones de la cartera, cualquiera sea su estado.' },
  { term: 'Deuda pendiente', text: 'El total registrado menos las obligaciones pagadas: la suma de las obligaciones que no están pagadas.' },
  { term: 'Deuda vencida', text: 'Obligaciones pendientes con importe mayor que cero y vencimiento anterior a la fecha de la cartera.' },
]

const [registered, pending, overdue] = PORTFOLIO_TOTALS

export type ReportId = 'queue' | 'data-quality' | 'decisions' | 'supervision' | 'access'

export type ReportDefinition = Readonly<{
  // Muestra datos de la cartera: sin cartera cargada no se ofrece.
  portfolio: boolean
  row: string
  totals: readonly Definition[]
}>

export const REPORT_DEFINITIONS: Readonly<Record<ReportId, ReportDefinition>> = {
  queue: {
    portfolio: true,
    row: 'Una fila por caso (objeto tributario), con su grupo de trabajo, su puntaje de prioridad y sus importes, en el orden de «Grupos de trabajo» y con los filtros de esa pantalla. Al final, una fila de total.',
    totals: [
      { term: 'Casos', text: 'Cantidad de casos de la selección. Sin filtros es la cantidad de casos del tablero.' },
      { term: `${registered.term}, ${pending.term.toLowerCase()} y ${overdue.term.toLowerCase()}`, text: 'Suma de los casos de la selección, con las definiciones de abajo. Sin filtros son las cifras del tablero.' },
      { term: 'Monto evaluable', text: 'La deuda pendiente que usan las reglas para el puntaje: no incluye importes ilegibles ni obligaciones sin vencimiento.' },
      { term: 'Faltantes', text: 'Cuántas obligaciones quedaron fuera de cada suma porque les falta el dato. Un dato faltante nunca se cuenta como cero.' },
    ],
  },
  'data-quality': {
    portfolio: true,
    row: 'Una fila por indicador y categoría: cuántos casos tienen cada dato (importes, contactos, atraso, puntaje) y en qué estado. No trae casos individuales.',
    totals: [
      { term: 'Casos leídos', text: 'Todos los casos del municipio que leen las pantallas.' },
      { term: 'Obligaciones leídas', text: 'Todas las obligaciones de esos casos, también las pagadas.' },
      { term: 'Casos sin contacto', text: 'Los mismos de la pantalla «Casos sin contacto».' },
    ],
  },
  decisions: {
    portfolio: false,
    row: 'Una fila por decisión registrada, también las que reemplazó una posterior, con el identificador del caso, la acción decidida y su estado. Al final, una fila de total. Sin texto libre ni nombres.',
    totals: [
      { term: 'Decisiones', text: 'Cantidad de filas de la selección.' },
      { term: 'Vigentes', text: 'Decisiones que ninguna posterior reemplaza: la decisión registrada que hoy muestra cada caso.' },
      { term: 'Datos anteriores', text: '«SI» cuando la decisión se registró con otra fecha de cartera o con otras reglas que las vigentes: la pantalla la muestra como «Registrada sobre datos anteriores».' },
    ],
  },
  supervision: {
    portfolio: false,
    row: 'Una fila por indicador: decisiones vigentes por tipo y por motivo, cuántas acciones de intensidad 3 o 4 esperan aprobación y cuántas se aprobaron u objetaron. No trae casos ni personas.',
    totals: [
      { term: 'Decisiones vigentes', text: 'Las que ninguna posterior reemplaza, con los mismos filtros que el reporte de decisiones.' },
      { term: 'Porcentaje de discrepancia', text: 'Decisiones vigentes que no aceptan la recomendación automática, sobre el total de vigentes. Sin decisiones no hay porcentaje.' },
      { term: 'Aprobación requerida', text: 'Decisiones vigentes de intensidad 3 o 4: necesitan la aprobación de otra persona con rol ADMIN.' },
    ],
  },
  access: {
    portfolio: false,
    row: 'Una fila por registro: apertura de un caso (con su identificador), descarga de un reporte o confirmación de carga solicitada. Quién lo hizo se indica como «propio» u «otra persona» y por su rol, sin nombres.',
    totals: [
      { term: 'Registros', text: 'Cantidad de filas de la selección. Bajar este reporte también deja un registro, que aparece en la descarga siguiente.' },
      { term: 'Confirmación de carga solicitada', text: 'Alguien pidió confirmar la carga de un lote de CSV. El resultado de esa carga está en el lote, no en este registro.' },
    ],
  },
}

/** Por qué una cuenta no puede bajar un reporte (los permisos están en la DAL). */
export const RESTRICTED_REASON = 'Muestra la actividad de otras personas: requiere una cuenta ADMIN.'

/**
 * Columnas e indicadores agregados en la noche 7. El catálogo de indicadores (docs/tesis) define los
 * anteriores; hasta que se actualice, la definición de estas está acá y la prueba exige una de las dos.
 */
export const NEW_COLUMNS: Readonly<Record<string, string>> = {
  fecha_cartera: 'Fecha de la cartera vigente del municipio, la misma de la línea de contexto. Constante en todo el archivo.',
  version_reglas_vigente: 'Versión de reglas vigente, la del tablero. Constante en todo el archivo.',
  deuda_pendiente_ars: pending.text,
  presencia_deuda_pendiente: 'Estado del dato de deuda pendiente en cada caso.',
  identificador: 'Identificador visible del caso, el mismo de los listados; NO_EN_CARTERA_VIGENTE si el caso no está en la cartera vigente.',
  rol_rotulo: 'Rol en palabras; un rol que ya no existe se marca «(rol anterior)».',
  decision_rotulo: 'Decisión en palabras, como en la ficha.',
  motivo_rotulo: 'Motivo en palabras, como en la ficha.',
  accion_sugerida: 'Acción de la recomendación automática, con su intensidad.',
  accion_decidida: 'Acción decidida, con su intensidad, o «Sin acción decidida».',
  aprobacion_rotulo: 'Estado de la decisión en palabras: registrada, pendiente de aprobación, aprobada, objetada o reemplazada.',
  datos_anteriores: 'SI cuando la decisión se registró con otra fecha de cartera o con otras reglas que las vigentes.',
  accion_rotulo: 'Acción registrada en palabras.',
  quien: 'PROPIO si la hizo quien descarga el reporte; OTRA_PERSONA si no. Sin nombres.',
  rol_actor_rotulo: 'Rol de quien actuó, en palabras.',
}
