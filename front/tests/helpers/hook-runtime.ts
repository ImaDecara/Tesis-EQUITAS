import type { ReactElement, ReactNode } from 'react'

// Sin DOM en Vitest: ejecuta el componente cliente real con el reductor real y deja disparar
// sus manejadores. El comportamiento en un navegador lo prueba tests/smoke/review-a11y.mjs.
// Solo tipos de 'react': la fábrica de vi.mock('react') importa este archivo y se bloquearía.
const slots: unknown[] = []
let cursor = 0
let pendingWork: unknown = null
const effects: (() => void)[] = []

export const hookRuntime = {
  reset() {
    slots.length = 0
    cursor = 0
    pendingWork = null
    effects.length = 0
  },
  useReducer(reducer: (state: unknown, event: unknown) => unknown, initialArg: unknown, init?: (arg: unknown) => unknown) {
    const index = cursor++
    if (!(index in slots)) slots[index] = init ? init(initialArg) : initialArg
    return [slots[index], (event: unknown) => { slots[index] = reducer(slots[index], event) }]
  },
  useRef(current: unknown) {
    const index = cursor++
    if (!(index in slots)) slots[index] = { current }
    return slots[index]
  },
  useTransition() {
    return [false, (work: () => unknown) => { pendingWork = work() }]
  },
  useEffect(effect: () => void, deps: unknown[]) {
    const index = cursor++
    const previous = slots[index] as unknown[] | undefined
    if (!previous || deps.some((dep, position) => dep !== previous[position])) effects.push(effect)
    slots[index] = deps
  },
  useId() {
    return `id-${cursor++}`
  },
  render<T>(component: () => T): T {
    cursor = 0
    const output = component()
    effects.splice(0).forEach(effect => effect())
    return output
  },
  settle: () => pendingWork,
}

type HostProps = Record<string, unknown> & { children?: ReactNode }
export type HostElement = ReactElement<HostProps> & { type: string }

// Llama a los componentes sin hooks y devuelve los elementos HTML en orden de aparición.
function isElement(node: unknown): node is ReactElement<HostProps> {
  return node !== null && typeof node === 'object' && '$$typeof' in node
}

export function hostElements(node: ReactNode): HostElement[] {
  if (Array.isArray(node)) return node.flatMap(hostElements)
  if (!isElement(node)) return []
  if (typeof node.type === 'function') return hostElements((node.type as (props: HostProps) => ReactNode)(node.props))
  if (typeof node.type === 'string') return [node as HostElement, ...hostElements(node.props.children)]
  return hostElements(node.props.children)
}
