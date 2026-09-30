import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import {
  hasSupabaseCredentials,
  supabasePublishableKey,
  supabaseUrl,
} from '@/lib/supabase-config'

export async function createServerSupabaseClient() {
  if (!hasSupabaseCredentials) {
    return null
  }

  const cookieStore = await cookies()

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Server Components pueden leer cookies, pero no siempre escribirlas.
        }
      },
    },
  })
}
