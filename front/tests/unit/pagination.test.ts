import { describe, expect, it } from 'vitest'

import { paginateItems, resolvePageSize } from '@/lib/pagination'

describe('paginacion', () => {
  it('usa diez elementos y la primera pagina por defecto', () => {
    const items = Array.from({ length: 25 }, (_, index) => index + 1)

    const result = paginateItems(items, undefined, undefined)

    expect(result.pageSize).toBe(10)
    expect(result.currentPage).toBe(1)
    expect(result.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(result.currentStart).toBe(1)
    expect(result.currentEnd).toBe(10)
    expect(result.totalPages).toBe(3)
  })

  it('respeta el tamano de veinte y calcula la ultima pagina parcial', () => {
    const items = Array.from({ length: 25 }, (_, index) => index + 1)

    const result = paginateItems(items, '2', '20')

    expect(result.pageSize).toBe(20)
    expect(result.currentPage).toBe(2)
    expect(result.items).toEqual([21, 22, 23, 24, 25])
    expect(result.currentStart).toBe(21)
    expect(result.currentEnd).toBe(25)
    expect(result.hasNextPage).toBe(false)
  })

  it('normaliza valores invalidos de pagina y tamano', () => {
    const items = Array.from({ length: 12 }, (_, index) => index + 1)

    const result = paginateItems(items, '-4', '50')

    expect(resolvePageSize('50')).toBe(10)
    expect(result.currentPage).toBe(1)
    expect(result.items).toHaveLength(10)
  })

  it('limita una pagina fuera de rango a la ultima disponible', () => {
    const items = Array.from({ length: 25 }, (_, index) => index + 1)

    const result = paginateItems(items, '99', '10')

    expect(result.currentPage).toBe(3)
    expect(result.items).toEqual([21, 22, 23, 24, 25])
    expect(result.hasPreviousPage).toBe(true)
  })

  it('maneja listados vacios sin rangos invalidos', () => {
    const result = paginateItems<number>([], undefined, undefined)

    expect(result.totalPages).toBe(1)
    expect(result.currentStart).toBe(0)
    expect(result.currentEnd).toBe(0)
    expect(result.items).toEqual([])
  })
})
