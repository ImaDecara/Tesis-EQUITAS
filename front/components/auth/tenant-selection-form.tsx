'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthState } from '@/components/auth/auth-provider'
import { selectCurrentTenant, validateCurrentUserTenantAccess, type TenantChoice } from '@/lib/services/auth-service'

export function TenantSelectionForm() {
  const router = useRouter()
  const { refreshAuthState } = useAuthState()
  const [choices, setChoices] = useState<TenantChoice[]>([])
  const [tenantId, setTenantId] = useState('')
  const [message, setMessage] = useState('Verificando acceso...')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    // null pide las opciones actuales, sin reutilizar una cookie de otra sesion.
    validateCurrentUserTenantAccess(null).then(result => {
      if (!active) return
      setChoices(result.tenantChoices ?? (result.context ? [{ id: result.context.tenantId, name: `Municipio ${result.context.tenantId}` }] : []))
      setMessage(result.message ?? 'Seleccioná un municipio para continuar.')
    }).catch(() => { if (active) setMessage('No disponible: no se pudo verificar el acceso.') })
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
      } else setMessage(access.message ?? 'No disponible: no se pudo verificar el acceso.')
    } catch {
      setMessage('No disponible: no se pudo verificar el acceso.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p role="status">{message}</p>
      {choices.length > 0 && <>
        <label htmlFor="tenant">Municipio</label>
        <select id="tenant" value={tenantId} onChange={event => setTenantId(event.target.value)} required className="block w-full rounded border p-2">
          <option value="" disabled>Seleccioná un municipio</option>
          {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
        </select>
        <button type="submit" disabled={pending || !tenantId} className="rounded bg-slate-800 px-4 py-2 text-white">Continuar</button>
      </>}
      <a href="/login" className="block underline">Volver al ingreso</a>
    </form>
  )
}
