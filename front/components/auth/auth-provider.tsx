'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Session } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabase'
import { validateAuthUserTenantAccess } from '@/lib/services/auth-service'

type AuthAppUser = {
  id: string
  authUserId: string
}

type AuthTenant = {
  id: string
}

type AuthContextValue = {
  session: Session | null
  appUser: AuthAppUser | null
  tenant: AuthTenant | null
  role: string | null
  isAuthenticated: boolean
  isAuthReady: boolean
  isRevalidating: boolean
  refreshAuthState: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function clearAccessState() {
  return {
    appUser: null as AuthAppUser | null,
    tenant: null as AuthTenant | null,
    role: null as string | null,
    isAuthenticated: false,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [appUser, setAppUser] = useState<AuthAppUser | null>(null)
  const [tenant, setTenant] = useState<AuthTenant | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [isRevalidating, setIsRevalidating] = useState(false)

  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const applyAnonymousState = useCallback((nextSession: Session | null) => {
    setSession(nextSession)
    const resetState = clearAccessState()
    setAppUser(resetState.appUser)
    setTenant(resetState.tenant)
    setRole(resetState.role)
    setIsAuthenticated(resetState.isAuthenticated)
  }, [])

  const resolveAccessForSession = useCallback(
    async (nextSession: Session | null, showBlockingState: boolean) => {
      if (!supabase) {
        applyAnonymousState(null)
        if (isMountedRef.current) {
          setIsRevalidating(false)
          setIsAuthReady(true)
        }
        return
      }

      if (!nextSession?.user?.id) {
        applyAnonymousState(nextSession)
        if (isMountedRef.current) {
          setIsRevalidating(false)
          setIsAuthReady(true)
        }
        return
      }

      if (!showBlockingState && isMountedRef.current) {
        setIsRevalidating(true)
      }

      const access = await validateAuthUserTenantAccess(nextSession.user.id)

      if (!isMountedRef.current) {
        return
      }

      setSession(nextSession)

      if (access.isAuthorized && access.context) {
        setAppUser({
          id: access.context.appUserId,
          authUserId: access.context.authUserId,
        })
        setTenant({ id: access.context.tenantId })
        setRole(access.context.role)
        setIsAuthenticated(true)
      } else {
        const resetState = clearAccessState()
        setAppUser(resetState.appUser)
        setTenant(resetState.tenant)
        setRole(resetState.role)
        setIsAuthenticated(resetState.isAuthenticated)
      }

      setIsAuthReady(true)
      setIsRevalidating(false)
    },
    [applyAnonymousState]
  )

  const refreshAuthState = useCallback(async () => {
    if (!supabase) {
      applyAnonymousState(null)
      if (isMountedRef.current) {
        setIsRevalidating(false)
        setIsAuthReady(true)
      }
      return
    }

    const { data, error } = await supabase.auth.getSession()

    if (error) {
      if (isMountedRef.current) {
        applyAnonymousState(null)
        setIsRevalidating(false)
        setIsAuthReady(true)
      }
      return
    }

    await resolveAccessForSession(data.session ?? null, false)
  }, [applyAnonymousState, resolveAccessForSession])

  useEffect(() => {
    let cancelled = false

    async function bootstrapAuth() {
      if (!supabase) {
        if (!cancelled) {
          applyAnonymousState(null)
          setIsAuthReady(true)
        }
        return
      }

      const { data, error } = await supabase.auth.getSession()

      if (cancelled) {
        return
      }

      if (error) {
        applyAnonymousState(null)
        setIsAuthReady(true)
        return
      }

      await resolveAccessForSession(data.session ?? null, true)
    }

    void bootstrapAuth()

    const authSubscription = supabase?.auth
      .onAuthStateChange((event, nextSession) => {
        if (event === 'TOKEN_REFRESHED') {
          setSession(nextSession ?? null)
          return
        }

        void resolveAccessForSession(nextSession ?? null, false)
      })
      .data.subscription

    return () => {
      cancelled = true
      authSubscription?.unsubscribe()
    }
  }, [applyAnonymousState, resolveAccessForSession])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      appUser,
      tenant,
      role,
      isAuthenticated,
      isAuthReady,
      isRevalidating,
      refreshAuthState,
    }),
    [
      appUser,
      isAuthenticated,
      isAuthReady,
      isRevalidating,
      refreshAuthState,
      role,
      session,
      tenant,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthState() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuthState debe usarse dentro de <AuthProvider>.')
  }

  return context
}
