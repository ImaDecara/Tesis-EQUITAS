import type { AuthError, SupabaseClient, User } from '@supabase/supabase-js'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'
import { denied, resolveTenantAccess, TENANT_COOKIE, type TenantAccessValidation } from '@/lib/auth/tenant-access'
export type { TenantAccessContext, TenantAccessValidation } from '@/lib/auth/tenant-access'

function selectedTenant() {
  if (typeof document === 'undefined') return undefined
  return document.cookie.split('; ').find(cookie => cookie.startsWith(`${TENANT_COOKIE}=`))?.slice(TENANT_COOKIE.length + 1)
}

export function mapAuthErrorMessage(error: AuthError | { message: string } | null) {
  if (!error) {
    return 'No se pudo iniciar sesion.'
  }

  const message = error.message.toLowerCase()

  if (
    message.includes('invalid login credentials') ||
    message.includes('invalid_credentials')
  ) {
    return 'Email o password incorrectos.'
  }

  if (message.includes('email not confirmed')) {
    return 'El email aun no fue confirmado.'
  }

  return error.message
}

export async function signInWithPassword(email: string, password: string) {
  const supabase = createBrowserSupabaseClient()

  if (!supabase) {
    return {
      error: {
        name: 'SupabaseNotConfigured',
        message: 'Supabase no esta configurado en el frontend.',
      },
    }
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return { error }
}

export async function signOutCurrentSession() {
  const supabase = createBrowserSupabaseClient()

  if (!supabase) {
    return
  }

  await supabase.auth.signOut()
}

export async function getCurrentAuthUser() {
  const supabase = createBrowserSupabaseClient()

  if (!supabase) {
    return null
  }

  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    return null
  }

  return data.user as User
}

export async function validateAuthUserTenantAccess(
  authUserId: string,
  supabase: SupabaseClient | null = createBrowserSupabaseClient(),
  tenantId = selectedTenant(),
): Promise<TenantAccessValidation> {
  return resolveTenantAccess(authUserId, supabase, tenantId)
}

export async function validateCurrentUserTenantAccess(): Promise<TenantAccessValidation> {
  const supabase = createBrowserSupabaseClient()
  if (!supabase) return denied('SUPABASE_NOT_CONFIGURED', 'Supabase no esta configurado en el frontend.')
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return denied('AUTH_REQUIRED', 'Debes iniciar sesion para continuar.')
  return validateAuthUserTenantAccess(data.user.id, supabase)
}
