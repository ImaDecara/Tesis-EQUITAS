'use client'

import { useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Search } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Bandas del puntaje de prioridad (un solo concepto en toda la aplicación).
const BAND_FILTER_LABELS: Record<string, string> = { ALTO: 'Alta (70 a 100)', MEDIO: 'Media (40 a 69)', BAJO: 'Baja (0 a 39)' }

function getRiskFilterLabel(risk: string) {
  return BAND_FILTER_LABELS[risk] ?? risk
}

type DebtorsFiltersFormProps = {
  initialValues: {
    q: string
    risk: string
    status: string
    type: string
    contact: string
    personId: string
    minAmount?: string
    queue?: string
  }
  riskOptions: string[]
  statusOptions: string[]
  typeOptions: string[]
}

export function DebtorsFiltersForm({
  initialValues,
  riskOptions,
  statusOptions,
  typeOptions,
}: DebtorsFiltersFormProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const params = new URLSearchParams()

    const q = String(formData.get('q') ?? '').trim()
    const risk = String(formData.get('risk') ?? '').trim()
    const status = String(formData.get('status') ?? '').trim()
    const type = String(formData.get('type') ?? '').trim()
    const contact = String(formData.get('contact') ?? '').trim()
    const personId = String(formData.get('personId') ?? '').trim()

    if (q) params.set('q', q)
    if (risk) params.set('risk', risk)
    if (status) params.set('status', status)
    if (type) params.set('type', type)
    if (contact) params.set('contact', contact)
    if (personId) params.set('personId', personId)

    for (const key of ['minAmount', 'queue']) {
      const value = String(formData.get(key) ?? '').trim()
      if (value) params.set(key, value)
    }
    const href = params.toString() ? `${pathname}?${params.toString()}` : pathname

    startTransition(() => {
      router.replace(href, { scroll: false })
    })
  }

  function handleClear() {
    startTransition(() => {
      router.replace(pathname, { scroll: false })
    })
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
      {initialValues.personId && <input type="hidden" name="personId" value={initialValues.personId} />}
      {initialValues.minAmount && <input type="hidden" name="minAmount" value={initialValues.minAmount} />}
      {initialValues.queue && <input type="hidden" name="queue" value={initialValues.queue} />}
      <div className="xl:col-span-2">
        <label htmlFor="q" className="mb-1 block text-xs font-semibold text-slate-600">
          Buscar por identificador o persona
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" />
          <input
            id="q"
            name="q"
            defaultValue={initialValues.q}
            placeholder="Ej.: OBJ-001 o Pérez"
            className="h-9 w-full rounded-md border border-slate-300 bg-white pr-3 pl-8 text-sm text-slate-900 outline-none ring-[#163a63]/20 transition focus:ring-4"
          />
        </div>
      </div>

      <div>
        <label htmlFor="risk" className="mb-1 block text-xs font-semibold text-slate-600">Puntaje de prioridad</label>
        <select
          id="risk"
          name="risk"
          defaultValue={initialValues.risk}
          className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none"
        >
          <option value="">Todos</option>
          {riskOptions.map((risk) => (
            <option key={risk} value={risk}>
              {getRiskFilterLabel(risk)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="status" className="mb-1 block text-xs font-semibold text-slate-600">Estado</label>
        <select
          id="status"
          name="status"
          defaultValue={initialValues.status}
          className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none"
        >
          <option value="">Todos</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="type" className="mb-1 block text-xs font-semibold text-slate-600">Tipo</label>
        <select
          id="type"
          name="type"
          defaultValue={initialValues.type}
          className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none"
        >
          <option value="">Todos</option>
          {typeOptions.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="contact" className="mb-1 block text-xs font-semibold text-slate-600">Contacto</label>
        <select
          id="contact"
          name="contact"
          defaultValue={initialValues.contact}
          className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none"
        >
          <option value="">Todos</option>
          <option value="with">Disponible</option>
          <option value="without">Faltante</option>
        </select>
      </div>

      <div className="flex items-end gap-2 xl:col-span-6">
        <button
          type="submit"
          disabled={isPending}
          className={cn(buttonVariants({ variant: 'default' }), 'h-9')}
        >
          {isPending ? 'Aplicando…' : 'Aplicar filtros'}
        </button>
        <button
          type="button"
          onClick={handleClear}
          disabled={isPending}
          className={cn(buttonVariants({ variant: 'outline' }), 'h-9')}
        >
          Limpiar
        </button>
      </div>
    </form>
  )
}
