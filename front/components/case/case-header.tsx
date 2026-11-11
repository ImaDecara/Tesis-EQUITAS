import type { ReactNode } from 'react'

import { actionLabel, BAND_LABELS, scoreText } from '@/components/case/case-explanation'
import { RecordedDecisionSummary, type RecordedDecisionView } from '@/components/case/recorded-decision-summary'
import { Badge } from '@/components/ui/badge'
import { INTERVENTION_LABELS } from '@/lib/services/debtor-recommendation-generator'
import type { DebtorListItem } from '@/types/equitas-domain'

// Noche 7. Encabezado de la ficha, arriba de las pestañas: identifica el caso y dice, sin cambiar
// de pestaña, su puntaje de prioridad, su grupo de trabajo, la recomendación automática y la
// decisión registrada. Tres cosas que no se mezclan: recomendación (sistema), decisión (una
// persona) y aprobación (otra persona, en la pestaña «Decisión»).

const BAND_VARIANT: Readonly<Record<string, 'danger' | 'warning' | 'success'>> = { ALTA: 'danger', MEDIA: 'warning', BAJA: 'success' }

function HeaderItem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1 rounded-lg border border-[#d2dceb] bg-white p-4 shadow-sm">
      <h2 className="text-xs font-semibold tracking-wide text-slate-600 uppercase">{title}</h2>
      {children}
    </div>
  )
}

function notComputed(readFailed: boolean) {
  return readFailed
    ? 'No se pudieron leer los datos necesarios para evaluar este caso: revisá los avisos de lectura.'
    : 'No se pudo calcular: faltan datos del caso.'
}

export function CaseHeader({ debtor, recorded, readFailed }: { debtor: DebtorListItem; recorded: RecordedDecisionView; readFailed: boolean }) {
  const { decision } = debtor
  const band = debtor.priorityLevel
  const intervention = decision?.intervencion
  return (
    <section aria-labelledby="case-title" className="mb-6 space-y-4">
      <div className="min-w-0">
        <h1 id="case-title" className="text-2xl font-semibold tracking-tight break-words text-[#163a63]">{debtor.identifier}</h1>
        <p className="text-sm break-words text-slate-600">{debtor.type} · {debtor.description}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <HeaderItem title="Puntaje de prioridad">
          <p className="text-2xl font-semibold text-slate-900">
            {scoreText(debtor.priorityScore, decision?.severidad.estado ?? null)}
            {debtor.priorityScore !== null && <span className="text-sm font-normal text-slate-600"> de 100</span>}
          </p>
          {band && <Badge variant={BAND_VARIANT[band] ?? 'neutral'}>Banda {BAND_LABELS[band] ?? band}</Badge>}
          <p className="text-xs text-slate-600">
            {debtor.priorityScore === null ? notComputed(readFailed) : 'Por reglas, no es una probabilidad de pago.'}
          </p>
        </HeaderItem>
        <HeaderItem title="Grupo de trabajo">
          <p className="font-medium text-slate-900">{intervention ? INTERVENTION_LABELS[intervention.codigo] : 'No disponible'}</p>
          {!intervention && <p className="text-xs text-slate-600">{notComputed(readFailed)}</p>}
        </HeaderItem>
        <HeaderItem title="Recomendación automática">
          <p className="font-medium break-words text-slate-900">
            {intervention ? actionLabel(intervention.codigo, intervention.intensidad) : 'No disponible'}
          </p>
          <p className="text-xs text-slate-600">{intervention ? 'La calcula el sistema por reglas; la decide una persona.' : notComputed(readFailed)}</p>
        </HeaderItem>
        <HeaderItem title="Decisión registrada">
          <RecordedDecisionSummary view={recorded} />
        </HeaderItem>
      </div>
    </section>
  )
}
