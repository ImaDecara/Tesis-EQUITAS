const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

export const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''

// Evita errores cuando la URL viene con /rest/v1 o barras finales.
export function normalizeSupabaseUrl(url: string): string {
  const cleanUrl = url.trim().replace(/\/+$/, '')

  if (cleanUrl.endsWith('/rest/v1')) {
    return cleanUrl.replace(/\/rest\/v1$/, '')
  }

  return cleanUrl
}

export const supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl)

export const hasSupabaseCredentials = Boolean(
  supabaseUrl && supabasePublishableKey
)
