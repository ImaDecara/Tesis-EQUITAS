// Noche 7. Rótulos de los roles vigentes, sin I/O: los usan el servidor (línea de contexto) y la
// ficha del caso (historial de decisiones). Un nombre que no esté acá es un dato histórico de un
// registro guardado y se muestra como tal.
export const ROLE_LABELS: Readonly<Record<string, string>> = { ADMIN: 'Administrador', USER: 'Usuario', tp_operator: 'Cuenta de prueba de solo lectura' }

export function roleLabel(name: string): string {
  return ROLE_LABELS[name] ?? `${name} (rol anterior)`
}
