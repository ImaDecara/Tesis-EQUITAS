'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogIn } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  mapAuthErrorMessage,
  signInWithPassword,
  signOutCurrentSession,
  validateCurrentUserTenantAccess,
} from '@/lib/services/auth-service'

type LoginFormProps = {
  nextPath: string
}

const INPUT = 'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-[#163a63]/20 transition placeholder:text-slate-400 focus:ring-4 aria-[invalid=true]:border-rose-400'

// Validación propia, en español: el navegador mostraría sus mensajes en el idioma del sistema.
export function validateLoginFields(email: string, password: string): { email?: string; password?: string } {
  const errors: { email?: string; password?: string } = {}
  if (!email.trim()) errors.email = 'Ingresá tu correo.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Revisá el correo: falta la arroba o el dominio.'
  if (!password) errors.password = 'Ingresá tu contraseña.'
  return errors
}

export function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function checkExistingSession() {
      const result = await validateCurrentUserTenantAccess()

      if (cancelled) {
        return
      }

      if (result.code === 'TENANT_SELECTION_REQUIRED') {
        router.replace('/select-tenant')
        return
      }

      if (result.isAuthorized) {
        router.replace(nextPath)
        return
      }

      setIsCheckingSession(false)
    }

    checkExistingSession()

    return () => {
      cancelled = true
    }
  }, [nextPath, router])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    const errors = validateLoginFields(email, password)
    setFieldErrors(errors)
    if (errors.email || errors.password) return
    setIsSubmitting(true)

    const signInResult = await signInWithPassword(email.trim(), password)

    if (signInResult.error) {
      setErrorMessage(mapAuthErrorMessage(signInResult.error))
      setIsSubmitting(false)
      return
    }

    const access = await validateCurrentUserTenantAccess()

    if (access.code === 'TENANT_SELECTION_REQUIRED') {
      router.replace('/select-tenant')
      return
    }

    if (!access.isAuthorized) {
      await signOutCurrentSession()
      // Los rechazos de acceso traen su mensaje y el próximo paso (ACCESS_MESSAGES): se muestran tal cual.
      setErrorMessage(access.message ?? 'Tu correo y tu contraseña son correctos, pero tu cuenta no tiene un acceso activo. Pedí el alta a quien administra el sistema.')
      setIsSubmitting(false)
      return
    }

    router.replace(nextPath)
    router.refresh()
    setIsSubmitting(false)
  }

  if (isCheckingSession) {
    return (
      <div role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
        Validando sesión…
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-slate-700">Correo</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? 'email-error' : undefined}
          className={INPUT}
          placeholder="nombre@municipio.gob.ar"
        />
        {fieldErrors.email && <p id="email-error" className="text-sm text-rose-700">{fieldErrors.email}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-slate-700">Contraseña</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? 'password-error' : undefined}
          className={INPUT}
        />
        {fieldErrors.password && <p id="password-error" className="text-sm text-rose-700">{fieldErrors.password}</p>}
      </div>

      {errorMessage && (
        <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {errorMessage}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        <LogIn className="size-4" />
        {isSubmitting ? 'Ingresando…' : 'Iniciar sesión'}
      </Button>
    </form>
  )
}
