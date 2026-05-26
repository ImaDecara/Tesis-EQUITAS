'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { useAuthState } from '@/components/auth/auth-provider'

type AuthGuardProps = {
  children: React.ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthReady, isAuthenticated } = useAuthState()

  useEffect(() => {
    if (!isAuthReady || isAuthenticated) {
      return
    }

    const currentPath = pathname
    const redirectTarget =
      currentPath && currentPath !== '/' ? `?next=${encodeURIComponent(currentPath)}` : ''

    router.replace(`/login${redirectTarget}`)
  }, [isAuthReady, isAuthenticated, pathname, router])

  if (!isAuthReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,_#eef2f7_0,_#f7f5ef_40%,_#f4f4f1_100%)] p-6">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-600 shadow-sm">
          Validando sesion...
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return <>{children}</>
}
