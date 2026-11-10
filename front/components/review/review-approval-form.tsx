'use client'

import { approveCaseDecision } from '@/app/debtors/[debtorId]/actions'
import { ChecklistFields, FormFeedback, RadioGroupField, ReviewFormShell, SelectField } from '@/components/review/review-form-controls'
import { useReviewForm } from '@/components/review/use-review-form'
import { Button } from '@/components/ui/button'
import { APPROVAL_DECISIONS, type ApprovalDecision } from '@/lib/domain/case-review-contract'
import {
  APPROVAL_LABELS,
  buildApprovalInput,
  EMPTY_APPROVAL_FORM,
  OBJECTION_REASONS,
  PROVISIONAL_REASONS_NOTICE,
  validateApprovalForm,
  type ApprovalFormValues,
} from '@/lib/domain/case-review-form'

const REASON_OPTIONS = OBJECTION_REASONS.map(reason => ({ value: reason.code, label: reason.label }))

// Objetar frena la propuesta y no confirma nada: sigue disponible con una carga en curso y sobre
// datos anteriores. `blockedReason` dice por qué no se puede aprobar; sin él, aprobar está habilitado.
export function ReviewApprovalForm({ caseReviewId, supersedes, blockedReason }: {
  caseReviewId: string
  supersedes: string | null
  blockedReason?: string | null
}) {
  const approveBlocked = (blockedReason ?? null) !== null
  const form = useReviewForm<ApprovalFormValues>({
    empty: EMPTY_APPROVAL_FORM,
    validate: values => validateApprovalForm(values, { approveBlocked }),
    send: values => approveCaseDecision(buildApprovalInput(values, caseReviewId, supersedes)),
  })
  const { values, errors, notice } = form.state
  const options = APPROVAL_DECISIONS.map(value => ({ value, label: APPROVAL_LABELS[value], disabled: value === 'APRUEBA' && approveBlocked }))

  return (
    <ReviewFormShell title="Tu respuesta a la propuesta" formLabelId="ap-title" pending={form.pending} onSubmit={form.submit}>
      {supersedes !== null && <p className="text-sm text-slate-700">Reemplaza la respuesta vigente: la anterior queda en el historial.</p>}
      {approveBlocked && (
        <p id="ap-blocked-note" className="text-sm text-slate-700">
          {blockedReason} Objetar sigue disponible.
        </p>
      )}
      <FormFeedback
        prefix="ap"
        containerRef={form.feedbackRef}
        notice={notice}
        errors={errors}
        outdatedHint="La propuesta se hizo con otros datos: ya no se puede aprobar. Podés objetarla, o quien la registró puede registrar una decisión nueva."
        onReload={form.reload}
      />
      <RadioGroupField
        id="ap-decision"
        legend="Respuesta"
        name="ap-decision"
        options={options}
        value={values.decision}
        error={errors.decision}
        onChange={value => form.change({ decision: value as ApprovalDecision })}
      />
      {values.decision === 'APRUEBA' && (
        <ChecklistFields prefix="ap" values={values.checklist} errors={errors} onChange={checklist => form.change({ checklist })} />
      )}
      {values.decision === 'OBJETA' && (
        <SelectField
          id="ap-reason"
          label="Motivo de la objeción"
          placeholder="Elegí un motivo"
          help={PROVISIONAL_REASONS_NOTICE}
          options={REASON_OPTIONS}
          value={values.reasonCode}
          error={errors.reasonCode}
          onChange={reasonCode => form.change({ reasonCode })}
        />
      )}
      <Button type="submit" disabled={form.pending}>Registrar respuesta</Button>
    </ReviewFormShell>
  )
}
