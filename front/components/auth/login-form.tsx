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

export function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    setIsSubmitting(true)

    const signInResult = await signInWithPassword(email.trim(), password)

    if (signInResult.error) {
      setErrorMessage(mapAuthErrorMessage(signInResult.error))
      setIsSubmitting(false)
      return
    }

    const access = await validateCurrentUserTenantAccess()

    if (!access.isAuthorized) {
      await signOutCurrentSession()
      setErrorMessage(
        access.message ??
          'Tus credenciales son correctas, pero no tienes permisos activos para ingresar.'
      )
      setIsSubmitting(false)
      return
    }

    router.replace(nextPath)
    setIsSubmitting(false)
  }

  if (isCheckingSession) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
        Validando sesion...
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-[#163a63]/20 transition placeholder:text-slate-400 focus:ring-4"
          placeholder="admin@municipio.gob.ar"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-[#163a63]/20 transition placeholder:text-slate-400 focus:ring-4"
          placeholder="********"
        />
      </div>

      {errorMessage && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {errorMessage}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        <LogIn className="size-4" />
        {isSubmitting ? 'Ingresando...' : 'Iniciar sesion'}
      </Button>
    </form>
  )
}
