import type { AuthError, User } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabase'
import {
  selectTextFromRow,
  selectValueFromRow,
  stringifyUnknownValue,
} from '@/lib/parsers/generic-value-selector'
import type { RawRow } from '@/types/equitas-domain'

type AuthValidationErrorCode =
  | 'SUPABASE_NOT_CONFIGURED'
  | 'AUTH_REQUIRED'
  | 'APP_USER_NOT_FOUND'
  | 'TENANT_ACCESS_NOT_FOUND'
  | 'TENANT_ACCESS_INACTIVE'
  | 'DATABASE_ERROR'

export type TenantAccessContext = {
  authUserId: string
  appUserId: string
  tenantId: string
  role: string
}

export type TenantAccessValidation = {
  isAuthorized: boolean
  requiresLogin: boolean
  code?: AuthValidationErrorCode
  message?: string
  context?: TenantAccessContext
}

const APP_USER_TABLE = 'user'
const TENANT_USER_TABLE = 'tenant_user'

const APP_USER_ID_CANDIDATES = ['id', 'user_id']
const TENANT_USER_TENANT_KEY_CANDIDATES = ['tenant', 'tenant_id', 'id_tenant']
const TENANT_USER_ROLE_KEY_CANDIDATES = ['role', 'role_id', 'user_role']

async function findAppUserByAuthUserId(authUserId: string) {
  if (!supabase) {
    return {
      row: null as RawRow | null,
      error: {
        code: 'SUPABASE_NOT_CONFIGURED',
        message: 'Cliente Supabase no configurado',
      },
    }
  }

  // Flujo obligatorio: public.user.auth_user = session.user.id (UUID de Auth).
  const response = await supabase
    .from(APP_USER_TABLE)
    .select('*')
    .eq('auth_user', authUserId)
    .limit(1)

  if (response.error) {
    return {
      row: null as RawRow | null,
      error: {
        code: response.error.code ?? undefined,
        message: response.error.message,
      },
    }
  }

  return {
    row: ((response.data as RawRow[] | null) ?? [])[0] ?? null,
    error: null,
  }
}

async function findActiveTenantMembershipByAppUserId(appUserId: string | number) {
  if (!supabase) {
    return {
      row: null as RawRow | null,
      error: {
        code: 'SUPABASE_NOT_CONFIGURED',
        message: 'Cliente Supabase no configurado',
      },
    }
  }

  // Flujo obligatorio: tenant_user.user = public.user.id y status = true.
  const activeResponse = await supabase
    .from(TENANT_USER_TABLE)
    .select('*')
    .eq('user', appUserId)
    .eq('status', true)
    .limit(1)

  if (activeResponse.error) {
    return {
      row: null as RawRow | null,
      error: {
        code: activeResponse.error.code ?? undefined,
        message: activeResponse.error.message,
      },
    }
  }

  const activeRow = ((activeResponse.data as RawRow[] | null) ?? [])[0] ?? null

  if (activeRow) {
    return {
      row: activeRow,
      error: null,
    }
  }

  const anyStatusResponse = await supabase
    .from(TENANT_USER_TABLE)
    .select('*')
    .eq('user', appUserId)
    .limit(20)

  if (anyStatusResponse.error) {
    return {
      row: null as RawRow | null,
      error: {
        code: anyStatusResponse.error.code ?? undefined,
        message: anyStatusResponse.error.message,
      },
    }
  }

  const hasInactiveMembership = (((anyStatusResponse.data as RawRow[] | null) ?? []).length > 0)

  if (hasInactiveMembership) {
    return {
      row: null as RawRow | null,
      error: {
        code: 'TENANT_ACCESS_INACTIVE',
        message: 'La relacion tenant_user existe pero no esta activa',
      },
    }
  }

  return {
    row: null as RawRow | null,
    error: null,
  }
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
  if (!supabase) {
    return
  }

  await supabase.auth.signOut()
}

export async function getCurrentAuthUser() {
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
  authUserId: string
): Promise<TenantAccessValidation> {
  if (!supabase) {
    return {
      isAuthorized: false,
      requiresLogin: false,
      code: 'SUPABASE_NOT_CONFIGURED',
      message: 'Supabase no esta configurado en el frontend.',
    }
  }
  const appUserLookup = await findAppUserByAuthUserId(authUserId)

  if (appUserLookup.error) {
    return {
      isAuthorized: false,
      requiresLogin: false,
      code: 'DATABASE_ERROR',
      message: `Error consultando public.user: ${appUserLookup.error.message}`,
    }
  }

  if (!appUserLookup.row) {
    return {
      isAuthorized: false,
      requiresLogin: false,
      code: 'APP_USER_NOT_FOUND',
      message:
        'Tu usuario existe en Auth, pero no tiene registro en public.user vinculado por auth_user.',
    }
  }

  const appUserIdValue = selectValueFromRow(appUserLookup.row, APP_USER_ID_CANDIDATES)
  const appUserIdText = stringifyUnknownValue(appUserIdValue)
  const appUserIdForTenantLookup =
    typeof appUserIdValue === 'number'
      ? appUserIdValue
      : Number.parseInt(appUserIdText, 10)

  if (!appUserIdText || Number.isNaN(appUserIdForTenantLookup)) {
    return {
      isAuthorized: false,
      requiresLogin: false,
      code: 'APP_USER_NOT_FOUND',
      message: 'No se pudo resolver el id del usuario en public.user.',
    }
  }

  const tenantLookup = await findActiveTenantMembershipByAppUserId(appUserIdForTenantLookup)

  if (tenantLookup.error && tenantLookup.error.code === 'TENANT_ACCESS_INACTIVE') {
    return {
      isAuthorized: false,
      requiresLogin: false,
      code: 'TENANT_ACCESS_INACTIVE',
      message: 'Tu relacion tenant_user existe, pero esta inactiva.',
    }
  }

  if (tenantLookup.error) {
    return {
      isAuthorized: false,
      requiresLogin: false,
      code: 'DATABASE_ERROR',
      message: `Error consultando tenant_user: ${tenantLookup.error.message}`,
    }
  }

  if (!tenantLookup.row) {
    return {
      isAuthorized: false,
      requiresLogin: false,
      code: 'TENANT_ACCESS_NOT_FOUND',
      message:
        'No existe relacion tenant_user activa para este usuario. Contacta al administrador.',
    }
  }

  const tenantId =
    selectTextFromRow(tenantLookup.row, TENANT_USER_TENANT_KEY_CANDIDATES) || 'sin-tenant'
  const role = selectTextFromRow(tenantLookup.row, TENANT_USER_ROLE_KEY_CANDIDATES) || 'user'

  return {
    isAuthorized: true,
    requiresLogin: false,
    context: {
      authUserId,
      appUserId: appUserIdText,
      tenantId,
      role,
    },
  }
}

export async function validateCurrentUserTenantAccess(): Promise<TenantAccessValidation> {
  if (!supabase) {
    return {
      isAuthorized: false,
      requiresLogin: false,
      code: 'SUPABASE_NOT_CONFIGURED',
      message: 'Supabase no esta configurado en el frontend.',
    }
  }

  const authUser = await getCurrentAuthUser()

  if (!authUser) {
    return {
      isAuthorized: false,
      requiresLogin: true,
      code: 'AUTH_REQUIRED',
      message: 'Debes iniciar sesion para continuar.',
    }
  }

  return validateAuthUserTenantAccess(authUser.id)
}
