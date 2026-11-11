'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthState } from '@/components/auth/auth-provider'
import { LogoutButton } from '@/components/layout/logout-button'
import { buttonVariants } from '@/components/ui/button'
import { selectCurrentTenant, validateCurrentUserTenantAccess, type TenantChoice } from '@/lib/services/auth-service'

export function TenantSelectionForm() {
  const router = useRouter()
  const { refreshAuthState } = useAuthState()
  const [choices, setChoices] = useState<TenantChoice[]>([])
  const [tenantId, setTenantId] = useState('')
  const [message, setMessage] = useState('Verificando acceso…')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    // null pide las opciones actuales, sin reutilizar una cookie de otra sesion.
    validateCurrentUserTenantAccess(null).then(result => {
      if (!active) return
      setChoices(result.tenantChoices ?? (result.context ? [{ id: result.context.tenantId, name: 'Tu municipio' }] : []))
      setMessage(result.message ?? 'Seleccioná un municipio para continuar.')
    }).catch(() => { if (active) setMessage('No se pudo verificar tu acceso. Recargá la página; si sigue igual, avisá a quien administra el sistema.') })
    return () => { active = false }
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      const access = await selectCurrentTenant(tenantId)
      if (access.isAuthorized) {
        await refreshAuthState()
        router.replace('/')
        router.refresh()
      } else setMessage(access.message ?? 'No se pudo verificar tu acceso. Recargá la página; si sigue igual, avisá a quien administra el sistema.')
    } catch {
      setMessage('No se pudo verificar tu acceso. Recargá la página; si sigue igual, avisá a quien administra el sistema.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p role="status" className="text-sm text-slate-700">{message}</p>
      {choices.length > 0 && <>
        <label htmlFor="tenant" className="block text-sm font-medium text-slate-700">Municipio</label>
        <select id="tenant" value={tenantId} onChange={event => setTenantId(event.target.value)} required className="h-10 block w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
          <option value="" disabled>Seleccioná un municipio</option>
          {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
        </select>
        <button type="submit" disabled={pending || !tenantId} className={buttonVariants({ variant: 'default' })}>{pending ? 'Verificando…' : 'Continuar'}</button>
      </>}
      {/* «Volver al ingreso» con la sesión abierta volvía acá: la salida es cerrar la sesión. */}
      <LogoutButton />
    </form>
  )
}
