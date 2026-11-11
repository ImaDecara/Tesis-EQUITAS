import { readFileSync, realpathSync, statSync } from 'node:fs'

export const labels = ['a', 'b', 'none', 'inactive', 'multi'] as const
export type Label = (typeof labels)[number]
export type LocalDalConfig = {
  supabaseUrl: string
  publishableKey: string
  reviewServerJwt: string
  accounts: Record<Label, { email: string; password: string }>
}

export function readLocalDalConfig(): LocalDalConfig {
  const path = process.env.EQUITAS_DAL_LOCAL_CONFIG
  if (!path) throw new Error('Falta EQUITAS_DAL_LOCAL_CONFIG; la prueba real no se omite.')
  const real = realpathSync(path)
  if (!real.startsWith('/tmp/') && !real.startsWith('/private/tmp/')) throw new Error('La configuracion privada debe vivir en /tmp.')
  if (statSync(real).mode & 0o077) throw new Error('La configuracion privada debe tener modo 0600.')
  const raw = readFileSync(real, 'utf8')
  if (/folyslqzqvnpolexcxjo|iylwghgvtydpmwidojdo/i.test(raw) ||
      Object.values(process.env).some(value => /folyslqzqvnpolexcxjo|iylwghgvtydpmwidojdo/i.test(value ?? ''))) {
    throw new Error('Configuracion remota rechazada antes de crear clientes.')
  }
  const config = JSON.parse(raw) as LocalDalConfig
  if (config.supabaseUrl !== 'http://127.0.0.1:54321') throw new Error('Solo se admite el stack local en 127.0.0.1:54321.')
  let anon = false
  try { anon = JSON.parse(Buffer.from(config.publishableKey.split('.')[1], 'base64url').toString()).role === 'anon' } catch { /* Puede ser una clave publicable nueva. */ }
  if (!config.publishableKey?.startsWith('sb_publishable_') && !anon) throw new Error('Se exige clave publicable o anon, nunca administrativa.')
  // ALIGN-069: sin credencial de servidor, la ficha falla cerrada y los controles positivos de detalle no se pueden probar.
  let serverRole: unknown
  try { serverRole = JSON.parse(Buffer.from(config.reviewServerJwt.split('.')[1], 'base64url').toString()).role } catch { /* Se rechaza abajo. */ }
  if (serverRole !== 'equitas_review_server') throw new Error('Se exige el JWT de equitas_review_server en reviewServerJwt.')
  for (const label of labels) {
    const account = config.accounts?.[label]
    if (!account?.email?.endsWith('@example.test') || !account.password) throw new Error(`Falta la cuenta sintetica ${label}.`)
  }
  return config
}
