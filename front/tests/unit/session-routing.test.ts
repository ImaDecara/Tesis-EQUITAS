import { describe, expect, it } from 'vitest'
import {
  AuthApiError, AuthInvalidTokenResponseError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError,
} from '@supabase/supabase-js'

import { isAuthServiceUnavailable, loginRedirectPath, safeNextPath } from '@/lib/auth/session-routing'

describe('ALIGN-019: destino posterior al ingreso solo dentro de la misma aplicacion', () => {
  it.each([
    ['/', '/'], ['/debtors', '/debtors'], ['/debtors/99', '/debtors/99'],
    ['/debtors?q=a&page=2', '/debtors?q=a&page=2'], ['/a%20b', '/a%20b'],
  ])('acepta la ruta interna %s', (value, expected) => {
    expect(safeNextPath(value)).toBe(expected)
  })

  it.each([
    '//otro.example', '///otro.example', '//otro.example/debtors', '/\\otro.example', '\\\\otro.example', '/\\/otro.example',
    '/\t/otro.example', '/\n/otro.example', '/\r/otro.example', '/.//otro.example', '/x/..//otro.example', '/%00\u0000',
    'https://otro.example', 'javascript:alert(1)', 'debtors', '', undefined, null, 7, ['/debtors'],
  ])('rechaza %j', value => {
    expect(safeNextPath(value)).toBeNull()
  })

  it('conserva la ruta codificada para el formulario de ingreso, sin parametros para la raiz', () => {
    expect(loginRedirectPath('/debtors')).toBe('/login?next=%2Fdebtors')
    expect(loginRedirectPath('/debtors/99')).toBe('/login?next=%2Fdebtors%2F99')
    expect(loginRedirectPath('/')).toBe('/login')
  })

  it.each(['//otro.example', '/\\otro.example', '/.//otro.example'])('una ruta que cambiaria de host no viaja en next: %s', pathname => {
    expect(loginRedirectPath(pathname)).toBe('/login')
  })
})

describe('ALIGN-019: una caida de Auth no se confunde con una sesion ausente', () => {
  it.each([
    ['red o puerto cerrado', new AuthRetryableFetchError('fetch failed', 0)],
    ['gateway 502', new AuthRetryableFetchError('bad gateway', 502)],
    ['servicio 503', new AuthRetryableFetchError('unavailable', 503)],
    ['error interno 500', new AuthApiError('internal', 500, 'unexpected_failure')],
    ['limite de solicitudes 429', new AuthApiError('slow down', 429, 'over_request_rate_limit')],
    ['respuesta ilegible', new AuthUnknownError('not json', new Error('parse'))],
    ['respuesta de token invalida', new AuthInvalidTokenResponseError()],
  ])('%s: no disponible', (_name, error) => {
    expect(isAuthServiceUnavailable(error)).toBe(true)
  })

  it.each([
    ['sin error', null],
    ['sesion ausente', new AuthSessionMissingError()],
    ['JWT vencido o invalido', new AuthApiError('invalid JWT', 401, 'bad_jwt')],
    ['sesion revocada', new AuthApiError('session missing', 403, 'session_not_found')],
    ['usuario borrado', new AuthApiError('user missing', 403, 'user_not_found')],
    ['refresh invalido', new AuthApiError('invalid refresh', 400, 'refresh_token_not_found')],
    ['objeto ajeno al SDK', { message: 'expired' }],
    ['texto', 'fetch failed'],
  ])('%s: exige ingresar, no es una caida', (_name, error) => {
    expect(isAuthServiceUnavailable(error)).toBe(false)
  })
})
