import { ProbeClient } from './probe-client'

// ALIGN-020. Sonda temporal: la copia el procedimiento a app/align020-probe y la retira al terminar.
// Sin una pagina que importe las acciones, Next no las compila y buscar en .next/static no probaria nada.
export default function Align020Probe() {
  return <ProbeClient />
}
