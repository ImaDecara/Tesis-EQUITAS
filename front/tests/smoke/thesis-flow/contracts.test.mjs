import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localOrigin, parseCsv } from './contracts.mjs'

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
