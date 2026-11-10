// Noche 7 (encargo 10.2). Textos de lo que no está disponible cuando la base no tiene el módulo de
// decisiones, cargas y registro de accesos. No es un error: la cartera se puede ver y analizar.
export const UNAVAILABLE_ON_THIS_DATABASE = 'No disponible en esta base'

export const MODULE_MISSING_EXPLANATION =
  'Esta base de datos no tiene instalado el módulo de decisiones, cargas y registro de accesos. La cartera se puede ver, ' +
  'buscar y analizar. Para usar esta función, quien administra la base tiene que instalar ese módulo.'

export function undatedPortfolioText(today: string): string {
  return `Sin fecha de cartera registrada: se calcula con la fecha de hoy (${today})`
}

/**
 * false: la base no tiene el módulo de decisiones, cargas y registro de accesos. El contexto de quien mira lo
 * expresa en el estado de la cartera: sin módulo no hay fecha de corte registrada.
 */
export function moduleAvailable(viewer: { portfolio: { kind: string } }): boolean {
  return viewer.portfolio.kind !== 'UNDATED'
}
