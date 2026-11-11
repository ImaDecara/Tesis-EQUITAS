'use client'

import { useState } from 'react'
import { ClipboardCopy, MessageSquareText } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { WHATSAPP_PENDING_LABEL } from '@/lib/whatsapp/contract'
import { DRAFT_MAX_CHARS, draftImpediments, effectiveSelection, type DraftContext } from '@/lib/whatsapp/draft'

// Panel «Preparar mensaje» de la ficha. Arma un borrador en el navegador para que la persona lo copie.
// No guarda nada, no llama a ningún servicio y no envía: la integración con WhatsApp está pendiente.

type CopyState = 'idle' | 'copied' | 'failed'

const PANEL_ID = 'whatsapp-draft-panel'

export function WhatsAppDraftPanel({ context }: { context: DraftContext }) {
  const [open, setOpen] = useState(false)
  const [personId, setPersonId] = useState('')
  const [contactId, setContactId] = useState('')
  const [text, setText] = useState(context.initialText)
  const [copy, setCopy] = useState<CopyState>('idle')
  const { recipient, phone } = effectiveSelection(context.recipients, { personId, contactId })
  const impediments = draftImpediments(context, { personId, contactId }, text)
  const blocked = context.caseImpediments.length > 0

  const edit = (value: string) => { setText(value); setCopy('idle') }
  const copyDraft = () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clipboard) { setCopy('failed'); return }
    void clipboard.writeText(text.trim()).then(() => setCopy('copied'), () => setCopy('failed'))
  }

  return (
    <div className="space-y-3">
      <Button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={PANEL_ID} data-whatsapp-open>
        <MessageSquareText className="size-4" aria-hidden />
        Preparar mensaje
      </Button>
      {open && (
        <section id={PANEL_ID} aria-labelledby={`${PANEL_ID}-title`} data-whatsapp-panel className="space-y-4 rounded-lg border border-[#d2dceb] bg-white p-4 text-sm text-slate-700 shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={`${PANEL_ID}-title`} className="text-base font-semibold text-[#163a63]">Borrador de mensaje</h2>
            <Badge variant="warning" data-whatsapp-status>{WHATSAPP_PENDING_LABEL}</Badge>
          </header>

          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div><dt className="text-xs text-slate-600">Caso</dt><dd className="font-medium text-slate-900">{context.caseRef.identifier} · {context.caseRef.type}</dd></div>
            <div><dt className="text-xs text-slate-600">Acción</dt><dd className="font-medium text-slate-900" data-whatsapp-basis={context.basis.source}>{context.basis.label}</dd></div>
          </dl>
          <p className="text-xs text-slate-600">{context.basis.note}</p>

          {!blocked && <Recipients context={context} personId={recipient?.personId ?? personId} contactId={phone?.contactId ?? contactId}
            onPerson={value => { setPersonId(value); setContactId(''); setCopy('idle') }} onContact={value => { setContactId(value); setCopy('idle') }} />}

          {!blocked && context.templateId && (
            <div className="space-y-1">
              <label htmlFor={`${PANEL_ID}-text`} className="font-medium text-slate-900">Texto (podés editarlo)</label>
              <textarea id={`${PANEL_ID}-text`} value={text} onChange={event => edit(event.target.value)} rows={6}
                className="w-full rounded-md border border-slate-300 p-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#163a63]" />
              <p className="flex flex-wrap justify-between gap-2 text-xs text-slate-600">
                <span>Plantilla {context.templateId}, de las reglas {context.rulesVersion}. Borrador sujeto a validación jurídica.</span>
                <span>{text.length.toLocaleString('es-AR')} de {DRAFT_MAX_CHARS.toLocaleString('es-AR')} caracteres</span>
              </p>
              {text !== context.initialText && <button type="button" className="text-xs text-[#163a63] underline" onClick={() => edit(context.initialText)}>Volver al texto de la plantilla</button>}
            </div>
          )}

          <div role="status" aria-live="polite" className="space-y-2" data-whatsapp-impediments={impediments.length}>
            {impediments.length > 0 && (
              <div className="rounded-md border border-[#e7d2ae] bg-[#fbf7ec] p-3">
                <p className="font-medium text-[#6f561e]">{blocked ? 'No se puede preparar un mensaje para este caso' : 'Antes de copiar'}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">{impediments.map(item => <li key={item.code} data-impediment={item.code}>{item.text}</li>)}</ul>
              </div>
            )}
            {copy === 'copied' && <p className="font-medium text-[#255a43]">Borrador copiado. No se envió nada: pegalo vos en el canal que corresponda.</p>}
            {copy === 'failed' && <p className="font-medium text-[#8f3434]">No se pudo copiar: seleccioná el texto y copialo a mano.</p>}
          </div>

          {!blocked && (
            <Button type="button" variant="outline" onClick={copyDraft} disabled={impediments.length > 0} data-whatsapp-copy>
              <ClipboardCopy className="size-4" aria-hidden />
              Copiar borrador
            </Button>
          )}

          <ul className="list-disc space-y-1 border-t border-slate-100 pt-3 pl-5 text-xs text-slate-600">
            <li>Un teléfono cargado no acredita que tenga WhatsApp activo, que esté verificado ni que la persona haya dado su consentimiento.</li>
            <li>El borrador queda solo en este navegador: no se guarda en la base, no sale por la red y no registra ninguna decisión ni aprobación.</li>
            <li>EQUITAS no envía este mensaje. La analítica no interviene: ningún grupo aprendido autoriza una comunicación.</li>
          </ul>
        </section>
      )}
    </div>
  )
}

function Recipients({ context, personId, contactId, onPerson, onContact }: {
  context: DraftContext; personId: string; contactId: string; onPerson: (value: string) => void; onContact: (value: string) => void
}) {
  const { recipients } = context
  if (recipients.length === 0) return null
  const chosen = recipients.find(item => item.personId === personId)
  return (
    <div className="space-y-3">
      {recipients.length > 1 && (
        <fieldset className="space-y-1">
          <legend className="font-medium text-slate-900">Persona</legend>
          {recipients.map(item => (
            <label key={item.personId} className="flex items-center gap-2">
              <input type="radio" name={`${PANEL_ID}-person`} value={item.personId} checked={personId === item.personId} onChange={() => onPerson(item.personId)} />
              {item.personName}{item.relation ? ` · ${item.relation}` : ''}
            </label>
          ))}
        </fieldset>
      )}
      {chosen && chosen.phones.length > 1 && (
        <fieldset className="space-y-1">
          <legend className="font-medium text-slate-900">Teléfono de {chosen.personName}</legend>
          {chosen.phones.map(item => (
            <label key={item.contactId} className="flex items-center gap-2">
              <input type="radio" name={`${PANEL_ID}-contact`} value={item.contactId} checked={contactId === item.contactId} onChange={() => onContact(item.contactId)} />
              {item.channel} · {item.value}
            </label>
          ))}
        </fieldset>
      )}
      {chosen && chosen.phones.length === 1 && (
        <p data-whatsapp-recipient><span className="text-slate-600">Para:</span> <span className="font-medium text-slate-900">{chosen.personName} · {chosen.phones[0].channel} {chosen.phones[0].value}</span></p>
      )}
      {context.inactivePhones > 0 && <p className="text-xs text-slate-600">{context.inactivePhones === 1 ? 'Hay 1 teléfono cargado como inactivo: no se ofrece.' : `Hay ${context.inactivePhones} teléfonos cargados como inactivos: no se ofrecen.`}</p>}
    </div>
  )
}
