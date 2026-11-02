import type { ReactNode, Ref } from 'react'

import { Button } from '@/components/ui/button'
import { REASON_TEXT_MAX_CHARS, REASON_TEXT_WARNING } from '@/lib/domain/case-review-contract'
import {
  CHANGE_LABELS,
  CHECKBOX_LABELS,
  HOUSEHOLD_LABELS,
  reasonCharCount,
  type ChecklistValues,
  type FieldKey,
  type FormErrors,
  type ReviewNotice,
} from '@/lib/domain/case-review-form'
import { INTERVENTION_LABELS } from '@/lib/services/debtor-recommendation-generator'
import type { InterventionCode } from '@/lib/domain/decision-rules-v1'

// Controles compartidos por los dos formularios de revisión. Sin hooks. Cada control tiene su
// etiqueta, y sus errores quedan asociados con aria-describedby.

const CONTROL = 'w-full rounded-md border border-slate-400 bg-white px-2 py-2 text-sm text-slate-900 outline-none ring-[#163a63]/30 transition focus:ring-4 aria-[invalid=true]:border-red-700'
const FIELD_TITLE = 'block text-sm font-semibold text-slate-800'
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#163a63]/40'

const joinIds = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined
const invalid = (error: string | undefined) => (error ? true : undefined)

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? <p id={id} className="text-sm font-medium text-red-800">{message}</p> : null
}

type RadioOption = { value: string; label: string; disabled?: boolean }

export function RadioGroupField({ id, legend, name, options, value, error, help, onChange }: {
  id: string
  legend: string
  name: string
  options: readonly RadioOption[]
  value: string
  error: string | undefined
  help?: string
  onChange: (value: string) => void
}) {
  return (
    <fieldset
      id={id}
      role="radiogroup"
      aria-labelledby={`${id}-legend`}
      aria-required
      aria-invalid={invalid(error)}
      aria-describedby={joinIds(help && `${id}-help`, error && `${id}-error`)}
      className="min-w-0 space-y-2"
    >
      <legend id={`${id}-legend`} className={FIELD_TITLE}>{legend}</legend>
      {help && <p id={`${id}-help`} className="text-xs text-slate-600">{help}</p>}
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
        {options.map(option => (
          <label key={option.value} className="flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className={`size-4 shrink-0 accent-[#163a63] ${FOCUS_RING}`}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </fieldset>
  )
}

export function SelectField({ id, label, placeholder, options, value, error, help, required = true, onChange }: {
  id: string
  label: string
  placeholder: string
  options: readonly { value: string; label: string }[]
  value: string
  error: string | undefined
  help?: string
  required?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={FIELD_TITLE}>{label}</label>
      {help && <p id={`${id}-help`} className="text-xs text-slate-600">{help}</p>}
      <select
        id={id}
        value={value}
        aria-required={required}
        aria-invalid={invalid(error)}
        aria-describedby={joinIds(help && `${id}-help`, error && `${id}-error`)}
        onChange={event => onChange(event.target.value)}
        className={CONTROL}
      >
        <option value="">{placeholder}</option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}

export function ReasonTextField({ id, value, error, onChange }: { id: string; value: string; error: string | undefined; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={FIELD_TITLE}>Detalle del motivo (opcional)</label>
      <p id={`${id}-help`} className="text-xs text-slate-600">{REASON_TEXT_WARNING}</p>
      <textarea
        id={id}
        rows={3}
        value={value}
        aria-invalid={invalid(error)}
        aria-describedby={joinIds(`${id}-help`, `${id}-count`, error && `${id}-error`)}
        onChange={event => onChange(event.target.value)}
        className={CONTROL}
      />
      <p id={`${id}-count`} className="text-xs text-slate-600">{reasonCharCount(value)} de {REASON_TEXT_MAX_CHARS} caracteres, contando los espacios.</p>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}

export function ChecklistFields({ prefix, values, errors, onChange }: {
  prefix: string
  values: ChecklistValues
  errors: FormErrors
  onChange: (checklist: ChecklistValues) => void
}) {
  const checkboxes = Object.keys(CHECKBOX_LABELS) as (keyof typeof CHECKBOX_LABELS)[]
  return (
    <fieldset className="min-w-0 space-y-3 rounded-md border border-slate-300 bg-slate-50 p-3">
      <legend className="px-1 text-sm font-semibold text-slate-800">Lista de control</legend>
      <p className="text-xs text-slate-600">Solo casillas y códigos: aquí no se escribe nada sobre el hogar.</p>
      <RadioGroupField
        id={`${prefix}-situacion_hogar`}
        legend="Situación del hogar"
        name={`${prefix}-situacion_hogar`}
        options={Object.entries(HOUSEHOLD_LABELS).map(([value, label]) => ({ value, label }))}
        value={values.situacion_hogar}
        error={errors.situacion_hogar}
        onChange={value => onChange({ ...values, situacion_hogar: value as ChecklistValues['situacion_hogar'] })}
      />
      {checkboxes.map(key => (
        <div key={key} className="space-y-1">
          <label htmlFor={`${prefix}-${key}`} className="flex items-start gap-2 text-sm text-slate-900">
            <input
              type="checkbox"
              id={`${prefix}-${key}`}
              checked={values[key]}
              aria-required
              aria-invalid={invalid(errors[key])}
              aria-describedby={errors[key] ? `${prefix}-${key}-error` : undefined}
              onChange={event => onChange({ ...values, [key]: event.target.checked })}
              className={`mt-0.5 size-4 shrink-0 accent-[#163a63] ${FOCUS_RING}`}
            />
            <span>{CHECKBOX_LABELS[key]}</span>
          </label>
          <FieldError id={`${prefix}-${key}-error`} message={errors[key]} />
        </div>
      ))}
    </fieldset>
  )
}

const FIELD_ANCHORS: Readonly<Record<FieldKey, string>> = {
  decision: 'decision', action: 'action', reasonCode: 'reason', reasonText: 'reason-text',
  situacion_hogar: 'situacion_hogar', estado_juridico_verificado: 'estado_juridico_verificado',
  canal_valido: 'canal_valido', alternativa_asistida_ofrecida: 'alternativa_asistida_ofrecida',
}

const interventionLabel = (code: string) => INTERVENTION_LABELS[code as InterventionCode] ?? code

function NoticeBody({ notice, outdatedHint, onReload }: { notice: ReviewNotice; outdatedHint: string; onReload: () => void }) {
  if (notice.kind === 'outdated') {
    const { current, changed } = notice
    return (
      <>
        <p className="font-medium">{notice.message}</p>
        {changed.length > 0 && <p>Cambió: {changed.map(item => CHANGE_LABELS[item]).join(', ')}.</p>}
        <p>Sugerencia vigente: {interventionLabel(current.suggestedIntervention)}, intensidad {current.suggestedIntensity}, reglas v{current.rulesVersion}.</p>
        <p>{outdatedHint}</p>
      </>
    )
  }
  return (
    <>
      <p className={notice.kind === 'recorded' ? 'font-medium' : undefined}>{notice.message}</p>
      {notice.kind === 'conflict' && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onReload}>Recargar el caso</Button>}
      {notice.kind === 'crash' && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => window.location.reload()}>Recargar la página</Button>}
    </>
  )
}

const NOTICE_STYLE: Readonly<Record<ReviewNotice['kind'], string>> = {
  recorded: 'border-emerald-300 bg-emerald-50 text-emerald-950',
  cutoff: 'border-slate-300 bg-slate-50 text-slate-900',
  conflict: 'border-amber-300 bg-amber-50 text-amber-950',
  outdated: 'border-amber-300 bg-amber-50 text-amber-950',
  rejected: 'border-red-300 bg-red-50 text-red-950',
  crash: 'border-red-300 bg-red-50 text-red-950',
}

// Recibe el foco tras cada envío. Lo que no exige actuar de inmediato no se anuncia como alerta:
// una carga en curso o un registro correcto no son un error del usuario.
export function FormFeedback({ prefix, containerRef, notice, errors, outdatedHint, onReload }: {
  prefix: string
  containerRef: Ref<HTMLDivElement>
  notice: ReviewNotice | null
  errors: FormErrors
  outdatedHint: string
  onReload: () => void
}) {
  const errorEntries = Object.entries(errors) as [FieldKey, string][]
  return (
    <div id={`${prefix}-feedback`} ref={containerRef} tabIndex={-1} className="space-y-2 outline-none">
      {notice && (
        <div
          id={`${prefix}-notice`}
          role={notice.kind === 'recorded' || notice.kind === 'cutoff' ? 'status' : 'alert'}
          className={`space-y-1 rounded-md border p-3 text-sm ${NOTICE_STYLE[notice.kind]}`}
        >
          <NoticeBody notice={notice} outdatedHint={outdatedHint} onReload={onReload} />
        </div>
      )}
      {errorEntries.length > 0 && (
        <div id={`${prefix}-summary`} role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950">
          <p className="font-medium">Revisa estos datos antes de enviar:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {errorEntries.map(([field, message]) => (
              <li key={field}><a className="underline" href={`#${prefix}-${FIELD_ANCHORS[field]}`}>{message}</a></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function ReviewFormShell({ title, formLabelId, pending, onSubmit, children }: {
  title: string
  formLabelId: string
  pending: boolean
  onSubmit: (event: React.FormEvent) => void
  children: ReactNode
}) {
  // `post` y sin atributos `name` en el texto: si se envía antes de hidratar, ningún motivo termina en la URL.
  return (
    <form method="post" noValidate aria-labelledby={formLabelId} aria-busy={pending} onSubmit={onSubmit} className="space-y-4">
      <h3 id={formLabelId} className="text-base font-semibold text-[#163a63]">{title}</h3>
      {children}
    </form>
  )
}
