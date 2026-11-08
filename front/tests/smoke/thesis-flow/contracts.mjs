import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const CHECKS = ['environment', 'real_load', 'operator_login', 'contact_queue', 'case_facts',
  'reason_required', 'proposal_checklist_required', 'modification_persists', 'supervisor_identity',
  'approval_checklist_required', 'approval_persists', 'csv_metadata_totals', 'logout_direct_denied',
  'expired_session_denied', 'console_clean']

export function localOrigin(value) {
  const url = new URL(value)
  assert(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
    && url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
  'Solo origen HTTP loopback con puerto, sin credenciales, ruta ni consulta')
  return url.origin
}

export async function loadEvidence(path, sha, rulesPath) {
  const directory = resolve(path)
  const load = JSON.parse(await readFile(resolve(directory, 'load.json'), 'utf8'))
  assert.equal(load.passed, true, 'Carga previa no aprobada')
  assert.equal(load.sha, sha, 'Carga de otro SHA')
  assert.equal(load.supabase_url, 'http://127.0.0.1:54321')
  assert.equal(load.scope, 'isolated_branch')
  assert.equal(load.rules_sha256, sha256(await readFile(rulesPath)), 'Reglas distintas')
  assert.deepEqual(load.commands.map(item => item.exit_code), [0, 0])
  assert(load.commands[0].command.includes('ETL.validate_source') && load.commands[1].command.includes('ETL.run_etl'))
  assert(load.commands.every(item => item.sha === sha && Date.parse(item.started_at_utc) <= Date.parse(item.ended_at_utc)))
  const hashes = Object.fromEntries(await Promise.all(['cabecera', 'detalle'].map(async name => [name,
    sha256(await readFile(resolve(directory, 'dataset', `${name}.tsv`)))])))
  assert.deepEqual(load.file_hashes, hashes, 'Dataset distinto al cargado')
  assert.equal(load.dataset_sha256, sha256(Object.keys(hashes).sort().map(name => `${name}:${hashes[name]}\n`).join('')))
  assert.equal(load.mapping_sha256, sha256(await readFile(resolve(directory, 'dataset/mapping.json'))))
  const validatorRaw = await readFile(resolve(directory, 'validator/report.json'))
  assert.equal(load.validator_sha256, sha256(validatorRaw), 'Reporte de validación alterado')
  const validator = JSON.parse(validatorRaw)
  assert.equal(validator.resultado_lote, 'VALIDADO')
  assert.equal(validator.publicacion_permitida, true)
  assert.equal(validator.fecha_corte, load.cutoff)
  assert.deepEqual(validator.motivos_bloqueo, [])
  assertAtomicPublication(load.events, load.publication)
  assert.equal(load.staging_rows, 0)
  for (const event of load.events) {
    for (const [name, hash] of Object.entries(hashes)) assert.equal(event.file_hashes[name], hash)
    assert.equal(event.rules_version, load.rules_version)
    assert.equal(event.as_of, load.cutoff)
    assert.equal(event.source, 'ETL_CLI')
  }
  assert.deepEqual(load.totals, { objects: 2, obligations: 6, amount: 1800000 })
  assert.deepEqual(load.debtors.map(row => row.identifier), ['FLOW029-A', 'FLOW029-B'])
  return load
}

export function assertAtomicPublication(events, publication) {
  assert.deepEqual(events.map(event => event.status), ['RECIBIDO', 'VALIDADO', 'CONFIRMADO', 'PUBLICADO'])
  assert.equal(new Set(events.map(event => event.id)).size, 4)
  events.forEach((event, index) => {
    assert(Number.isSafeInteger(event.id) && event.id > 0)
    assert.equal(event.supersedes, index ? events[index - 1].id : null)
    assert.equal(event.counts.publicacion_atomica, 1)
  })
  assert.equal(publication.status, 'PUBLICADO')
  assert.equal(publication.result.status, 'PUBLICADO')
  assert.equal(publication.batch_id, events[0].id)
  assert.equal(publication.result.batch_id, events[0].id)
  assert.equal(publication.head_id, events.at(-1).id)
  assert.equal(publication.result.published_event_id, events.at(-1).id)
  for (const key of ['idempotency_key', 'revision']) {
    assert.match(publication[key], /^[a-f0-9]{64}$/)
    assert.equal(publication.result[key], publication[key])
  }
  for (const [key, value] of Object.entries(publication.result.counts)) {
    assert.deepEqual(events.at(-1).counts[key], value)
  }
}

// CSV RFC4180 con separador local: conserva ';' y comillas dentro de celdas.
export function parseCsv(text) {
  assert(text.startsWith('\uFEFF'), 'Falta BOM UTF-8')
  const rows = [], row = []
  let cell = '', quoted = false
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1 }
      else quoted = !quoted
    } else if (char === ';' && !quoted) { row.push(cell); cell = '' }
    else if (char === '\r' && text[index + 1] === '\n' && !quoted) {
      row.push(cell); rows.push([...row]); row.length = 0; cell = ''; index += 1
    } else cell += char
  }
  assert(!quoted && !cell && row.length === 0, 'CSV incompleto')
  const header = rows.shift()
  assert(header && new Set(header).size === header.length)
  return rows.map(values => {
    assert.equal(values.length, header.length)
    return Object.fromEntries(header.map((name, index) => [name, values[index]]))
  })
}

export function assertCsvTotals(rows, load) {
  assert.equal(rows.length, 3, 'Se requieren dos detalles y un total')
  const details = rows.filter(row => row.tipo_fila === 'DETALLE')
  const totals = rows.filter(row => row.tipo_fila === 'TOTAL')
  assert.equal(details.length, 2)
  assert.equal(totals.length, 1)
  assert.deepEqual(details.map(row => row.identificador).sort(), ['FLOW029-A', 'FLOW029-B'])
  for (const row of details) {
    assert.equal(row.intervencion_codigo, 'CONTACTO_PERSONAL_Y_PLAN')
    assert.equal(row.intensidad, '2')
    assert.equal(row.severidad_puntos, '80')
    assert.equal(row.obligaciones, '3')
    assert.equal(row.deuda_total_ars, '900000')
    assert.equal(row.deuda_vencida_ars, '900000')
  }
  const total = totals[0]
  assert.equal(Number(total.objetos), load.totals.objects)
  assert.equal(Number(total.obligaciones), load.totals.obligations)
  for (const name of ['deuda_total_ars', 'deuda_vencida_ars', 'monto_evaluable_ars']) {
    assert.equal(Number(total[name]), load.totals.amount)
    assert.equal(Number(total[name]), details.reduce((sum, row) => sum + Number(row[name]), 0))
  }
}

export function assertCsv(rows, load) {
  assertCsvTotals(rows, load)
  for (const row of rows) {
    assert.equal(row.fecha_corte, load.cutoff, 'CSV: fecha de corte no coincide con la carga')
    assert.equal(row.version_reglas, load.rules_version)
    assert.equal(row.filtros, 'SIN_FILTROS')
    assert.equal(row.fecha_calculo_usada, 'NO_APLICA')
    assert.equal(row.definiciones, 'docs/tesis/catalogo-indicadores-v1.md#reporte-cola')
    assert(Number.isFinite(Date.parse(row.generado_en)))
    assert(Object.values(row).every(value => value.trim().length > 0))
  }
}
