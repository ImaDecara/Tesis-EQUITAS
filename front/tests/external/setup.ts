import fixture from '../../../quality/supabase-testing.json'

const raw = process.env.SUPABASE_TEST_CONFIG
if (!raw) throw new Error('Falta SUPABASE_TEST_CONFIG: la integracion real obligatoria no se omite.')
let config: { url: string; publishableKey: string; accounts: Record<string, { email: string; password: string }> }
try { config = JSON.parse(raw) } catch { throw new Error('SUPABASE_TEST_CONFIG no es JSON valido.') }
if (config.url !== fixture.url || !config.publishableKey?.startsWith('sb_publishable_')) {
  throw new Error('Se requiere URL exacta del testing registrado y clave sb_publishable_; se rechazan proyectos ajenos y claves administrativas.')
}
for (const label of ['a', 'b', 'none', 'inactive']) {
  if (!config.accounts?.[label]?.email || !config.accounts[label].password) {
    throw new Error(`Faltan credenciales de testing para ${label}.`)
  }
}
// Se usa la configuracion productiva y su lector, sin reemplazar modulos ni HTTP.
process.env.NEXT_PUBLIC_SUPABASE_URL = config.url
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = config.publishableKey
