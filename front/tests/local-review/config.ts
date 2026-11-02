import { readFileSync, realpathSync, statSync } from 'node:fs'

export const REVIEW_ACCOUNTS = ['consulta', 'operador', 'supervisor', 'importador', 'sin-membresia', 'inactivo', 'otro-operador', 'otro-supervisor'] as const
export type ReviewAccount = (typeof REVIEW_ACCOUNTS)[number]
export type LocalReviewConfig = {
  supabaseUrl: string
  publishableKey: string
  reviewJwt: string
  importJwt: string
  jwtSecret: string
  accounts: Record<ReviewAccount, { email: string; password: string }>
}

// Falla antes de crear clientes: la prueba real no se omite y nunca sale del stack local.
export function readLocalReviewConfig(): LocalReviewConfig {
  const path = process.env.EQUITAS_REVIEW_LOCAL_CONFIG
  if (!path) throw new Error('Falta EQUITAS_REVIEW_LOCAL_CONFIG; la prueba real no se omite.')
  const real = realpathSync(path)
  if (!real.startsWith('/tmp/') && !real.startsWith('/private/tmp/')) throw new Error('La configuracion privada debe vivir en /tmp.')
  if (statSync(real).mode & 0o077) throw new Error('La configuracion privada debe tener modo 0600.')
  const raw = readFileSync(real, 'utf8')
  if (/supabase\.co/i.test(raw) || Object.values(process.env).some(value => /supabase\.co/i.test(value ?? ''))) {
    throw new Error('Configuracion remota rechazada antes de crear clientes.')
  }
  const config = JSON.parse(raw) as LocalReviewConfig
  if (config.supabaseUrl !== 'http://127.0.0.1:54321') throw new Error('Solo se admite el stack local en 127.0.0.1:54321.')
  for (const label of REVIEW_ACCOUNTS) {
    const account = config.accounts?.[label]
    if (!account?.email?.endsWith('@example.test') || !account.password) throw new Error(`Falta la cuenta sintetica ${label}.`)
  }
  if (!config.reviewJwt || !config.importJwt) throw new Error('Faltan las credenciales de servidor locales.')
  return config
}
