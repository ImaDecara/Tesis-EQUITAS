'use client'

import { recordCaseDecision } from '@/app/debtors/[debtorId]/actions'
import { ChecklistFields, FormFeedback, RadioGroupField, ReasonTextField, ReviewFormShell, SelectField } from '@/components/review/review-form-controls'
import { useReviewForm } from '@/components/review/use-review-form'
import { Button } from '@/components/ui/button'
import { CASE_REVIEW_DECISIONS, type CaseReviewDecision, type CaseReviewSnapshot } from '@/lib/domain/case-review-contract'
import {
  actionOptionsFor,
  buildRecordInput,
  DECISION_LABELS,
  decisionFields,
  EMPTY_DECISION_FORM,
  PROVISIONAL_REASONS_NOTICE,
  REVIEW_REASONS,
  validateDecisionForm,
  type DecisionFormValues,
} from '@/lib/domain/case-review-form'

const DECISION_OPTIONS = CASE_REVIEW_DECISIONS.map(value => ({ value, label: DECISION_LABELS[value] }))
const REASON_OPTIONS = REVIEW_REASONS.map(reason => ({ value: reason.code, label: reason.label }))

// `snapshot` es la instantánea que la página acaba de leer. Si la acción avisa que cambió,
// se usa la vigente que devolvió, y la persona tiene que volver a elegir.
export function ReviewDecisionForm({ snapshot }: { snapshot: CaseReviewSnapshot }) {
  const form = useReviewForm<DecisionFormValues>({
    empty: EMPTY_DECISION_FORM,
    validate: (values, state) => validateDecisionForm(values, state.current ?? snapshot),
    send: (values, state) => recordCaseDecision(buildRecordInput(values, state.current ?? snapshot)),
  })
  const { values, errors, notice, current } = form.state
  const fields = decisionFields(values)
  const actionOptions = actionOptionsFor(values.decision, current ?? snapshot).map(item => ({ value: item.key, label: item.label }))

  return (
    <ReviewFormShell title="Tu decisión" formLabelId="rv-title" pending={form.pending} onSubmit={form.submit}>
      <FormFeedback
        prefix="rv"
        containerRef={form.feedbackRef}
        notice={notice}
        errors={errors}
        outdatedHint="Nada quedó confirmado. Revisa los datos y vuelve a elegir tu decisión."
        onReload={form.reload}
      />
      <RadioGroupField
        id="rv-decision"
        legend="Decisión"
        name="rv-decision"
        options={DECISION_OPTIONS}
        value={values.decision}
        error={errors.decision}
        onChange={value => form.change({ decision: value as CaseReviewDecision })}
      />
      {fields.showAction && (
        <SelectField
          id="rv-action"
          label={fields.actionRequired ? 'Acción propuesta' : 'Acción propuesta (opcional)'}
          placeholder={fields.actionRequired ? 'Elige una acción' : 'Sin indicar una acción'}
          options={actionOptions}
          value={values.action}
          error={errors.action}
          required={fields.actionRequired}
          onChange={action => form.change({ action })}
        />
      )}
      {fields.showReason && (
        <>
          <SelectField
            id="rv-reason"
            label="Motivo"
            placeholder="Elige un motivo"
            help={PROVISIONAL_REASONS_NOTICE}
            options={REASON_OPTIONS}
            value={values.reasonCode}
            error={errors.reasonCode}
            onChange={reasonCode => form.change({ reasonCode })}
          />
          <ReasonTextField id="rv-reason-text" value={values.reasonText} error={errors.reasonText} onChange={reasonText => form.change({ reasonText })} />
        </>
      )}
      {fields.intense && (
        <>
          <ChecklistFields prefix="rv" values={values.checklist} errors={errors} onChange={checklist => form.change({ checklist })} />
          <p id="rv-intense-note" className="text-sm text-slate-700">
            Es una propuesta: no se ejecuta hasta que la apruebe otra persona con rol de supervisor.
          </p>
        </>
      )}
      <Button type="submit" disabled={form.pending}>{fields.intense ? 'Registrar propuesta' : 'Registrar decisión'}</Button>
    </ReviewFormShell>
  )
}
