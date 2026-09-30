import { createBrowserClient } from '@supabase/ssr'

import {
  hasSupabaseCredentials,
  supabasePublishableKey,
  supabaseUrl,
} from '@/lib/supabase-config'

export function createBrowserSupabaseClient() {
  if (!hasSupabaseCredentials) {
    return null
  }

  return createBrowserClient(supabaseUrl, supabasePublishableKey)
}
