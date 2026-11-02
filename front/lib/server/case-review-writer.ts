import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { hasSupabaseCredentials, supabasePublishableKey, supabaseUrl } from '@/lib/supabase-config'

const REVIEW_SERVER_ROLE = 'equitas_review_server'

// Único lugar que lee esta credencial. Sin NEXT_PUBLIC_: Next no la inlinea en ningún
// bundle. Un JWT de otro rol (service_role, por ejemplo) se rechaza: abriría toda la base.
function reviewServerToken(): string | null {
  const token = process.env.EQUITAS_REVIEW_SERVER_JWT?.trim()
  if (!token) return null
  try {
    const claims: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
    return (claims as { role?: unknown } | null)?.role === REVIEW_SERVER_ROLE ? token : null
  } catch {
    return null
  }
}

// Cliente aparte del de sesión, por llamada y sin estado. Solo sirve para las funciones
// de ALIGN-018: el rol no lee ni escribe tablas. El actor lo resolvió antes la DAL.
export function createCaseReviewWriter(): SupabaseClient | null {
  const token = reviewServerToken()
  if (!token || !hasSupabaseCredentials) return null
  return createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
