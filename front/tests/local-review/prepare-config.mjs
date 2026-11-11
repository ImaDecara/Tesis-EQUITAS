// ALIGN-020. Arma la configuracion privada de la prueba real. No imprime claves. Solo stack local.
// Uso: node tests/local-review/prepare-config.mjs <credenciales.psv> <salida.json>
import { readFileSync, writeFileSync } from 'node:fs'

// Noche 7: EQUITAS_LOCAL_DIR y EQUITAS_LOCAL_API_URL apuntan a un proyecto local propio (scripts/campanas/equitas_campanas.py).
const LOCAL = process.env.EQUITAS_LOCAL_DIR ?? '/tmp/equitas-local-db'
const API_URL = process.env.EQUITAS_LOCAL_API_URL ?? 'http://127.0.0.1:54321'
const [credentialsPath, outputPath] = process.argv.slice(2)
if (!credentialsPath || !(outputPath?.startsWith('/tmp/') || outputPath?.startsWith(`${LOCAL}/`)) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(API_URL)) {
  throw new Error('Uso: prepare-config.mjs <credenciales.psv> </tmp/...json>')
}

const env = Object.fromEntries(readFileSync(`${LOCAL}/supabase-local.env`, 'utf8').split('\n').flatMap(line => {
  const at = line.indexOf('=')
  return at > 0 ? [[line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, '')]] : []
}))
if (env.API_URL !== API_URL) throw new Error('Solo se admite el stack local.')

const accounts = Object.fromEntries(readFileSync(credentialsPath, 'utf8').trim().split('\n').map(line => {
  const [label, email, password] = line.split('|')
  return [label, { email, password }]
}))
const config = {
  supabaseUrl: env.API_URL,
  publishableKey: env.PUBLISHABLE_KEY,
  reviewJwt: readFileSync(`${LOCAL}/equitas_review_server.jwt`, 'utf8').trim(),
  importJwt: readFileSync(`${LOCAL}/equitas_import_server.jwt`, 'utf8').trim(),
  jwtSecret: env.JWT_SECRET,
  accounts,
}
writeFileSync(outputPath, JSON.stringify(config), { mode: 0o600 })
console.log(`cuentas=${Object.keys(accounts).length}`)
