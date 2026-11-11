import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertAtomicPublication, localOrigin, parseCsv } from './contracts.mjs'

test('los destinos ajenos, credenciales y URLs ambiguas se rechazan antes de Auth', () => {
  for (const url of ['https://localhost:3000', 'http://example.invalid:3000', 'http://127.0.0.1.example.invalid:3000',
    'http://user:secret@127.0.0.1:3000', 'http://127.0.0.1:3000/login', 'http://127.0.0.1:3000?secret=x',
    'http://127.0.0.1:3000#secret', 'http://localhost']) assert.throws(() => localOrigin(url))
  assert.equal(localOrigin('http://127.0.0.1:31029'), 'http://127.0.0.1:31029')
})

test('el lector CSV no confunde separadores o comillas en texto con columnas', () => {
  assert.deepEqual(parseCsv('\uFEFFa;b\r\n"con;separador";"con ""comilla"""\r\n'), [{ a: 'con;separador', b: 'con "comilla"' }])
  for (const text of ['a;b\r\n1;2\r\n', '\uFEFFa;b\r\n1\r\n', '\uFEFFa;a\r\n1;2\r\n', '\uFEFFa;b\r\n"sin cerrar;2']) {
    assert.throws(() => parseCsv(text))
  }
})

test('la carga exige la cadena atómica completa y un recibo de esa misma publicación', () => {
  const events = ['RECIBIDO', 'VALIDADO', 'CONFIRMADO', 'PUBLICADO'].map((status, index) => ({
    id: 71 + index, status, supersedes: index ? 70 + index : null,
    counts: { publicacion_atomica: 1, deudas_insertadas: 6 },
  }))
  const publication = { batch_id: 71, head_id: 74, status: 'PUBLICADO', idempotency_key: 'a'.repeat(64), revision: 'b'.repeat(64),
    result: { batch_id: 71, published_event_id: 74, status: 'PUBLICADO', idempotency_key: 'a'.repeat(64), revision: 'b'.repeat(64), counts: { deudas_insertadas: 6 } } }
  assert.doesNotThrow(() => assertAtomicPublication(events, publication))
  for (const corrupt of [
    e => e.splice(2, 1),
    e => { e[2].supersedes = e[0].id },
    e => { e[3].status = 'FALLIDO' },
    e => { e[1].counts.publicacion_atomica = '1' },
    e => { e[1].counts.publicacion_atomica = true },
    e => { e[3].id = e[2].id },
  ]) {
    const copy = structuredClone(events); corrupt(copy)
    assert.throws(() => assertAtomicPublication(copy, publication))
  }
  for (const corrupt of [
    p => { p.result.published_event_id = 75 },
    p => { p.result.batch_id = 72 },
    p => { p.result.revision = 'c'.repeat(64) },
    p => { p.result.status = 'VALIDADO' },
    p => { p.result.counts.deudas_insertadas = 5 },
  ]) {
    const copy = structuredClone(publication); corrupt(copy)
    assert.throws(() => assertAtomicPublication(events, copy))
  }
})
