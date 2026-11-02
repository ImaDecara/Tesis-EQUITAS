// ALIGN-052. Emite por stdout el encabezado Cookie de una sesion real del stack local, generado
// por el mismo @supabase/ssr que usa la web. Lee los datos de entorno y solo acepta loopback.
import { createServerClient } from '@supabase/ssr'

const { LOCAL_SUPABASE_URL: url, LOCAL_PUBLISHABLE_KEY: key, LOCAL_EMAIL: email, LOCAL_PASSWORD: password } = process.env
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('DETENERSE: destino no local')

const jar = new Map()
const supabase = createServerClient(url, key, {
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: cookies => cookies.forEach(({ name, value }) => jar.set(name, value)),
  },
})
const { error } = await supabase.auth.signInWithPassword({ email, password })
if (error) throw new Error(`LOGIN_FALLIDO ${error.status}`)
process.stdout.write([...jar].map(([name, value]) => `${name}=${value}`).join('; '))
