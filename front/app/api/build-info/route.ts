// Identifica la version y el destino publico; nunca devuelve claves o sesiones.
export const dynamic = 'force-dynamic'

export function GET() {
  let supabaseProjectRef: string | null = null
  try {
    const hostname = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname
    supabaseProjectRef = hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] ?? null
  } catch { /* Configuracion ausente/invalida: el smoke debe rechazarla. */ }

  return Response.json({
    sourceSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.QUALITY_SOURCE_SHA ?? null,
    environment: process.env.VERCEL_ENV ?? 'local',
    supabaseProjectRef,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
