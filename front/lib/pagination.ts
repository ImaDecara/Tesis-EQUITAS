export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZE_OPTIONS = [10, 20] as const

export function parsePositiveInteger(value: string | undefined) {
  const parsedValue = Number(value)

  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null
}

export function resolvePageSize(value: string | undefined) {
  const parsedValue = parsePositiveInteger(value)

  return parsedValue !== null && PAGE_SIZE_OPTIONS.some((option) => option === parsedValue)
    ? parsedValue
    : DEFAULT_PAGE_SIZE
}

export function paginateItems<T>(
  items: T[],
  pageValue: string | undefined,
  pageSizeValue: string | undefined
) {
  const pageSize = resolvePageSize(pageSizeValue)
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const parsedPage = parsePositiveInteger(pageValue)
  const currentPage = Math.min(parsedPage ?? 1, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const currentStart = items.length === 0 ? 0 : startIndex + 1
  const currentEnd = Math.min(startIndex + pageSize, items.length)

  return {
    pageSize,
    totalPages,
    currentPage,
    currentStart,
    currentEnd,
    hasPreviousPage: currentPage > 1,
    hasNextPage: currentPage < totalPages,
    items: items.slice(startIndex, startIndex + pageSize),
  }
}
