'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'

import { ImportResult } from '@/components/import/import-result'
import { Button } from '@/components/ui/button'
import {
  assignFiles,
  describeLoadFailure,
  describeLoadResponse,
  FILE_KINDS,
  FILE_ROLES,
  formatBytes,
  IMPORT_FORMAT,
  isCalendarDay,
  recognizeFile,
  type FileAssignment,
  type FileKind,
  type LoadOutcome,
} from '@/lib/domain/import-upload'
import { formatDate } from '@/lib/utils'

const HEAD_BYTES = 8192

async function firstLineOf(file: File): Promise<string> {
  const head = await file.slice(0, HEAD_BYTES).text()
  return head.split('\n', 1)[0] ?? ''
}

// Envía el lote a la aplicación (misma página, mismo origen). El navegador nunca habla con el
// servicio de importación: lo reenvía el servidor con la sesión. Municipio y persona no viajan acá.
export async function submitLot(files: Record<FileKind, File>, asOf: string, revision: string | null): Promise<LoadOutcome> {
  const form = new FormData()
  form.set('as_of', asOf)
  if (revision) form.set('revision', revision)
  for (const kind of FILE_KINDS) form.set(kind, files[kind], `${kind}.csv`)
  try {
    const response = await fetch('/api/imports/load', { method: 'POST', body: form, cache: 'no-store' })
    return describeLoadResponse(response.status, await response.json().catch(() => null))
  } catch {
    return describeLoadFailure()
  }
}

type Chosen = { assignment: FileAssignment; files: Partial<Record<FileKind, File>> }

export function ImportForm({ currentAsOf }: { currentAsOf: string | null }) {
  const router = useRouter()
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const [asOf, setAsOf] = useState('')
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<LoadOutcome | null>(null)

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(event.target.files ?? [])
    setOutcome(null)
    const described = await Promise.all(list.map(async file => ({ file, name: file.name, size: file.size, firstLine: await firstLineOf(file) })))
    const assignment = assignFiles(described)
    const files: Partial<Record<FileKind, File>> = {}
    // Con la asignación válida hay exactamente un archivo por tipo: se elige por contenido, no por nombre.
    if (assignment.ok) for (const kind of FILE_KINDS) files[kind] = described.find(item => recognizeFile(item.firstLine) === kind)!.file
    setChosen({ assignment, files })
  }

  const ready = chosen?.assignment.ok === true && isCalendarDay(asOf)
  const earlier = currentAsOf !== null && isCalendarDay(asOf) && asOf < currentAsOf

  async function send(revision: string | null) {
    if (!ready || pending) return
    setPending(true)
    const result = await submitLot(chosen!.files as Record<FileKind, File>, asOf, revision)
    setOutcome(result)
    setPending(false)
    // El marco y el tablero leen la cartera en el servidor: se vuelven a pedir cuando cambió.
    if (result.portfolioChanged) router.refresh()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void send(null)
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4" aria-busy={pending} data-import-form>
        <div className="space-y-1.5">
          <label htmlFor="import-files" className="text-sm font-medium text-slate-800">Archivos del lote (los dos CSV juntos)</label>
          <input id="import-files" name="files" type="file" multiple accept=".csv,text/csv" onChange={handleFiles} disabled={pending}
            aria-describedby="import-files-help"
            className="block w-full rounded-md border border-slate-300 bg-white text-sm text-slate-900 file:mr-3 file:border-0 file:bg-[#163a63] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white" />
          <p id="import-files-help" className="text-xs text-slate-600">
            Elegí los dos archivos en el mismo selector (con Ctrl o ⌘ para marcar ambos). Máximo {IMPORT_FORMAT.limits.fileMegabytes} MB por archivo.
          </p>
        </div>

        {chosen?.assignment.ok === true && (
          <ul className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm" data-recognized-files>
            {FILE_KINDS.map(kind => (
              <li key={kind}>
                <span className="font-medium">{FILE_ROLES[kind].title}:</span> {chosen.assignment.ok ? chosen.assignment.files[kind].name : ''}{' '}
                <span className="text-slate-600">({chosen.assignment.ok ? formatBytes(chosen.assignment.files[kind].size) : ''})</span>
              </li>
            ))}
          </ul>
        )}
        {chosen?.assignment.ok === false && (
          <ul role="alert" className="list-disc space-y-1 rounded-md border border-rose-200 bg-rose-50 p-3 pl-7 text-sm text-rose-800" data-file-problems>
            {chosen.assignment.problems.map(problem => <li key={problem}>{problem}</li>)}
          </ul>
        )}

        <div className="space-y-1.5">
          <label htmlFor="import-as-of" className="text-sm font-medium text-slate-800">Fecha de corte de los datos</label>
          <input id="import-as-of" name="as_of" type="date" required value={asOf} onChange={event => { setAsOf(event.target.value); setOutcome(null) }} disabled={pending}
            aria-describedby="import-as-of-help"
            className="block h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900" />
          <p id="import-as-of-help" className="text-xs text-slate-600">
            Es el día al que corresponden los importes y estados del archivo. Con esa fecha se calcula qué está vencido.
          </p>
          {earlier && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-earlier-date>
              Esa fecha es anterior a la de la cartera vigente ({formatDate(currentAsOf)}). Si la cargás, la cartera pasa a mostrarse con la fecha anterior.
            </p>
          )}
        </div>

        <Button type="submit" disabled={!ready || pending} data-load-button>
          <Upload className="size-4" />
          {pending ? 'Validando y cargando…' : 'Cargar CSV'}
        </Button>
        {pending && <p className="text-sm text-slate-600" role="status">No cierres esta pantalla: la carga puede tardar hasta {Math.ceil(IMPORT_FORMAT.limits.seconds / 60)} minutos.</p>}
      </form>

      {outcome && <ImportResult outcome={outcome} retrying={pending} onRetry={outcome.revision ? () => void send(outcome.revision) : undefined} />}
    </div>
  )
}
