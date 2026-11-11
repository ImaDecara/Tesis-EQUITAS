// Noche 7. La frase de la regla aplicada sale del contrato de reglas, que nombra el puntaje como «severidad» y
// los faltantes por su código interno. En pantalla se muestra con el vocabulario de la aplicación: «puntaje de
// prioridad» y el motivo del faltante en palabras. La frase guardada con cada decisión no se toca.
const MISSING_WORDS: Readonly<Record<string, string>> = {
  NO_INFORMADO_EN_ORIGEN: 'no informado en el archivo de origen',
  NO_INTEGRADO: 'no disponible en esta versión',
  INVALIDO: 'con un valor inválido',
  OBSERVADO_PARCIAL: 'incompleto',
  NO_DISPONIBLE: 'no disponible',
}
const MISSING_CODE = new RegExp(`\\b(?:${Object.keys(MISSING_WORDS).join('|')})\\b`, 'g')

export function plainRulePhrase(phrase: string): string {
  return phrase
    .replaceAll('la severidad mínima calculada', 'el puntaje de prioridad mínimo calculado')
    .replaceAll('la severidad', 'el puntaje de prioridad')
    .replace(MISSING_CODE, code => MISSING_WORDS[code])
}
