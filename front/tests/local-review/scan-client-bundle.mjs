// ALIGN-020. Busca la credencial de escritura en lo que recibe el navegador. Publica solo conteos.
// Uso: EQUITAS_REVIEW_LOCAL_CONFIG=/tmp/...json node tests/local-review/scan-client-bundle.mjs [--expect-actions]
// Con --expect-actions exige los controles positivos: sin ellos, cero hallazgos no probaria nada.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const config = JSON.parse(readFileSync(process.env.EQUITAS_REVIEW_LOCAL_CONFIG, 'utf8'))
const expectActions = process.argv.includes('--expect-actions')
const NEXT = '.next'

function files(directory) {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}
const contents = directory => files(directory).map(path => ({ path, text: readFileSync(path, 'latin1') }))

const clientFiles = contents(join(NEXT, 'static'))
const needles = {
  jwt_servidor_revision: config.reviewJwt,
  firma_jwt_revision: config.reviewJwt.split('.')[2],
  jwt_servidor_importacion: config.importJwt,
  secreto_jwt: config.jwtSecret,
  nombre_variable: 'EQUITAS_REVIEW_SERVER_JWT',
  rol_servidor: 'equitas_review_server',
  funcion_revision: 'record_case_review',
  funcion_aprobacion: 'record_case_review_approval',
  modulo_escritor: 'createCaseReviewWriter',
}
let hits = 0
for (const [name, needle] of Object.entries(needles)) {
  const found = clientFiles.filter(file => file.text.includes(needle)).length
  hits += found
  console.log(`static|${name}|${found}`)
}
console.log(`static|archivos_revisados|${clientFiles.length}`)

let controlsFailed = 0
if (expectActions) {
  const manifest = JSON.parse(readFileSync(join(NEXT, 'server', 'server-reference-manifest.json'), 'utf8'))
  const ids = Object.keys(manifest.node ?? {})
  const serverFiles = contents(join(NEXT, 'server'))
  const controls = {
    acciones_en_el_manifiesto: ids.length,
    referencias_en_bundle_cliente: ids.filter(id => clientFiles.some(file => file.text.includes(id))).length,
    variable_en_bundle_servidor: serverFiles.filter(file => file.text.includes('EQUITAS_REVIEW_SERVER_JWT')).length,
    funcion_en_bundle_servidor: serverFiles.filter(file => file.text.includes('record_case_review')).length,
  }
  for (const [name, value] of Object.entries(controls)) {
    console.log(`control|${name}|${value}`)
    if (value < 1) controlsFailed += 1
  }
}
console.log(`resultado|hallazgos=${hits}|controles_fallidos=${controlsFailed}`)
process.exit(hits === 0 && controlsFailed === 0 ? 0 : 1)
