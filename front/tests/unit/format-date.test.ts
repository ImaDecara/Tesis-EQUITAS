import { afterEach, describe, expect, it } from 'vitest'

import { formatDate } from '@/lib/utils'

const ORIGINAL_TZ = process.env.TZ
// Desplazamiento esperado de cada zona: comprueba que el cambio de TZ realmente se aplicó.
const ZONES = [
  ['America/Argentina/Cordoba', 180],
  ['UTC', 0],
  ['Asia/Tokyo', -540],
] as const

function useZone(zone: string, offset: number) {
  process.env.TZ = zone
  expect(new Date('2026-06-01T12:00:00.000Z').getTimezoneOffset(), `TZ=${zone} no se aplicó`).toBe(offset)
}

describe('formatDate: el día calendario no depende de la zona horaria', () => {
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ
    else process.env.TZ = ORIGINAL_TZ
  })

  describe.each(ZONES)('con TZ=%s', (zone, offset) => {
    it.each([
      ['2026-06-01', '1/6/2026'],
      ['2026-01-01', '1/1/2026'],
      ['2026-12-31', '31/12/2026'],
      ['2024-02-29', '29/2/2024'],
      [' 2026-06-01 ', '1/6/2026'],
    ])('%s se muestra como %s', (value, expected) => {
      useZone(zone, offset)
      expect(formatDate(value)).toBe(expected)
    })

    it.each([
      ['2026-06-01T00:00:00.000Z', '1/6/2026'],
      ['2026-06-01T23:30:00-03:00', '1/6/2026'],
      ['2026-06-01 00:00:00+00', '1/6/2026'],
    ])('una fecha con hora %s conserva el día que trae escrito', (value, expected) => {
      useZone(zone, offset)
      expect(formatDate(value)).toBe(expected)
    })
  })

  it('usa el mismo formato que es-AR en el servidor y en el navegador', () => {
    const reference = new Date(Date.UTC(2026, 5, 1)).toLocaleDateString('es-AR', { timeZone: 'UTC' })
    expect(formatDate('2026-06-01')).toBe(reference)
  })

  it.each([[null], [undefined], ['']])('sin valor (%s) conserva "Sin fecha"', value => {
    expect(formatDate(value)).toBe('Sin fecha')
  })

  // Nunca se corre a otro día: lo imposible o ilegible se muestra tal como llegó.
  it.each(['2026-02-30', '2026-13-01', '2025-02-29', 'no-es-fecha', '01/06/2026'])('no interpreta %s', value => {
    expect(formatDate(value)).toBe(value)
  })
})
