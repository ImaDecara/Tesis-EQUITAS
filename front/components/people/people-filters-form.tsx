'use client'

import { useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Search } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type PeopleFiltersFormProps = {
  initialValues: {
    q: string
    risk: string
  }
}

export function PeopleFiltersForm({ initialValues }: PeopleFiltersFormProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const params = new URLSearchParams()
    const q = String(formData.get('q') ?? '').trim()
    const risk = String(formData.get('risk') ?? '').trim()

    if (q) params.set('q', q)
    if (risk) params.set('risk', risk)

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
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div className="xl:col-span-2">
        <label htmlFor="q" className="mb-1 block text-xs font-semibold text-slate-600">
          Buscar por nombre o documento
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" />
          <input
            id="q"
            name="q"
            defaultValue={initialValues.q}
            placeholder="Ej: Juan Perez o 30123456"
            className="h-9 w-full rounded-md border border-slate-300 bg-white pr-3 pl-8 text-sm text-slate-900 outline-none ring-[#163a63]/20 transition focus:ring-4"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600">
          Riesgo individual
        </label>
        <select
          name="risk"
          defaultValue={initialValues.risk}
          className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none"
        >
          <option value="">Todos</option>
          <option value="BAJO">Bajo (0-39)</option>
          <option value="MEDIO">Medio (40-69)</option>
          <option value="ALTO">Alto (70-100)</option>
        </select>
      </div>

      <div className="flex items-end gap-2">
        <button
          type="submit"
          disabled={isPending}
          className={cn(buttonVariants({ variant: 'default' }), 'h-9')}
        >
          {isPending ? 'Aplicando...' : 'Aplicar'}
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
