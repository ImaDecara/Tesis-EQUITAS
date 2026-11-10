import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'
import { FILE_ROLES, findingMessage, type FileKind, type Finding, type FindingGroup, type LoadOutcome } from '@/lib/domain/import-upload'
import { cn, formatDate } from '@/lib/utils'

// Resultado de una carga, sin estado propio: lo usa el formulario y se puede probar por separado.

const TONES: Readonly<Record<LoadOutcome['kind'], string>> = {
  loaded: 'border-emerald-300 bg-emerald-50 text-emerald-950',
  already: 'border-sky-300 bg-sky-50 text-sky-950',
  rejected: 'border-rose-300 bg-rose-50 text-rose-950',
  input: 'border-rose-300 bg-rose-50 text-rose-950',
  forbidden: 'border-rose-300 bg-rose-50 text-rose-950',
  retry: 'border-amber-300 bg-amber-50 text-amber-950',
  service: 'border-amber-300 bg-amber-50 text-amber-950',
  unconfirmed: 'border-amber-300 bg-amber-50 text-amber-950',
  session: 'border-amber-300 bg-amber-50 text-amber-950',
}

const fileTitle = (name: string) => FILE_ROLES[name as FileKind]?.title ?? name
const count = (value: number | null | undefined) => (typeof value === 'number' ? value.toLocaleString('es-AR') : 'No disponible')

function Summary({ outcome }: { outcome: LoadOutcome }) {
  const summary = outcome.body.resumen
  if (!summary) return null
  const quarantined = summary.objetos_en_cuarentena ?? 0
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4" data-load-summary>
      <div><dt className="text-xs opacity-80">Fecha de corte</dt><dd className="font-semibold">{outcome.body.fecha_corte ? formatDate(outcome.body.fecha_corte) : 'No disponible'}</dd></div>
      <div><dt className="text-xs opacity-80">Objetos incorporados</dt><dd className="font-semibold">{count(summary.objetos_aceptados)} de {count(summary.objetos)}</dd></div>
      <div><dt className="text-xs opacity-80">Obligaciones en el archivo</dt><dd className="font-semibold">{count(summary.obligaciones)}</dd></div>
      <div><dt className="text-xs opacity-80">Personas</dt><dd className="font-semibold">{count(summary.personas)}</dd></div>
      <div className="col-span-2 sm:col-span-4">
        <dt className="text-xs opacity-80">En cuarentena</dt>
        <dd>
          {quarantined > 0
            ? `${count(quarantined)} ${quarantined === 1 ? 'objeto quedó' : 'objetos quedaron'} fuera porque alguna de sus filas tiene un error; el detalle está abajo. No se incorporan hasta corregirlos en un lote nuevo.`
            : 'Ningún objeto quedó en cuarentena.'}
        </dd>
      </div>
    </dl>
  )
}

function FindingsTable({ title, group, kind }: { title: string; group: FindingGroup | undefined; kind: 'errores' | 'advertencias' }) {
  if (!group || group.total === 0) return null
  return (
    <section aria-label={title} data-findings={kind} className="space-y-2">
      <h3 className="text-sm font-semibold">{title}: {group.total}</h3>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {group.por_codigo.map(item => <li key={item.codigo}>{item.cantidad} × {findingMessage(item.codigo, item.descripcion)}</li>)}
      </ul>
      <div className="max-h-80 overflow-auto rounded border border-current/20 bg-white/70">
        <table className="w-full min-w-[32rem] text-left text-xs">
          <thead>
            <tr className="border-b border-current/20">
              <th scope="col" className="px-2 py-1.5">Archivo</th>
              <th scope="col" className="px-2 py-1.5">Fila</th>
              <th scope="col" className="px-2 py-1.5">Columna</th>
              <th scope="col" className="px-2 py-1.5">Qué se esperaba</th>
            </tr>
          </thead>
          <tbody>
            {group.detalle.map((finding: Finding) => (
              <tr key={`${finding.archivo}-${finding.linea}-${finding.columna}-${finding.codigo}`} className="border-b border-current/10 last:border-0">
                <td className="px-2 py-1.5">{fileTitle(finding.archivo)}</td>
                <td className="px-2 py-1.5">{finding.linea > 0 ? finding.linea : 'Todo el archivo'}</td>
                <td className="px-2 py-1.5">{finding.columna === '*' ? 'Toda la fila' : finding.columna}</td>
                <td className="px-2 py-1.5">{findingMessage(finding.codigo, finding.descripcion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function ImportResult({ outcome, onRetry, retrying = false }: { outcome: LoadOutcome; onRetry?: () => void; retrying?: boolean }) {
  const { body } = outcome
  const structure = body.estructura
  return (
    <section role={outcome.kind === 'loaded' || outcome.kind === 'already' ? 'status' : 'alert'} aria-live="polite" data-load-result={outcome.kind}
      className={cn('space-y-4 rounded-lg border p-4', TONES[outcome.kind])}>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{outcome.title}</h2>
        <p className="text-sm">{outcome.message}</p>
      </div>

      {structure && (
        <p className="text-sm" data-structure-error>
          {structure.descripcion}
          {structure.archivo ? ` Archivo: ${fileTitle(structure.archivo)}.` : ''}
          {structure.linea ? ` Fila: ${structure.linea}.` : ''}
          {structure.columna ? ` Columna: ${structure.columna}.` : ''}
        </p>
      )}

      {body.motivos && body.motivos.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm" data-load-reasons>
          {body.motivos.map(reason => <li key={reason.codigo}>{findingMessage(reason.codigo, reason.descripcion)}</li>)}
        </ul>
      )}

      <Summary outcome={outcome} />
      <FindingsTable title="Errores para corregir" group={body.errores} kind="errores" />
      <FindingsTable title="Advertencias (no impiden la carga)" group={body.advertencias} kind="advertencias" />
      {body.truncado && (
        <p className="text-xs">Se muestran los primeros {body.hallazgos_mostrados} de {body.hallazgos_total} hallazgos; los totales de arriba cuentan todos.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {(outcome.kind === 'loaded' || outcome.kind === 'already') && (
          <Link href="/" className={buttonVariants({ variant: 'default', size: 'sm' })}>Ver el tablero</Link>
        )}
        {outcome.kind === 'session' && <Link href="/login?next=%2Fimport" className={buttonVariants({ variant: 'default', size: 'sm' })}>Volver a ingresar</Link>}
        {outcome.revision && onRetry && (
          <button type="button" onClick={onRetry} disabled={retrying} data-retry className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {retrying ? 'Reintentando…' : 'Reintentar esta misma carga'}
          </button>
        )}
      </div>
    </section>
  )
}
