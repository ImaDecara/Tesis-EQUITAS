import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'
import { PAGE_SIZE_OPTIONS } from '@/lib/pagination'
import { cn } from '@/lib/utils'

type PaginationControlsProps = {
  currentPage: number
  totalPages: number
  pageSize: number
  currentStart: number
  currentEnd: number
  totalItems: number
  itemLabel: string
  buildHref: (page: number, pageSize: number) => string
}

export function PaginationSummary({
  currentStart,
  currentEnd,
  totalItems,
  itemLabel,
  pageSize,
  buildHref,
}: Pick<
  PaginationControlsProps,
  'currentStart' | 'currentEnd' | 'totalItems' | 'itemLabel' | 'pageSize' | 'buildHref'
>) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <p className="text-sm text-slate-600">
        Mostrando {currentStart.toLocaleString('es-AR')}-{currentEnd.toLocaleString('es-AR')}{' '}
        de {totalItems.toLocaleString('es-AR')} {itemLabel}.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-700">Ver</span>
        {PAGE_SIZE_OPTIONS.map((option) => (
          <Link
            key={option}
            href={buildHref(1, option)}
            aria-current={pageSize === option ? 'page' : undefined}
            className={cn(
              buttonVariants({
                variant: pageSize === option ? 'default' : 'outline',
                size: 'sm',
              }),
              'h-7 px-2.5'
            )}
          >
            {option}
          </Link>
        ))}
        <span>por pagina</span>
      </div>
    </div>
  )
}

export function PaginationControls({
  currentPage,
  totalPages,
  pageSize,
  currentStart,
  currentEnd,
  totalItems,
  itemLabel,
  buildHref,
}: PaginationControlsProps) {
  const hasPreviousPage = currentPage > 1
  const hasNextPage = currentPage < totalPages

  if (totalItems === 0) {
    return null
  }

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
      <p>
        Pagina {currentPage.toLocaleString('es-AR')} de {totalPages.toLocaleString('es-AR')}.{' '}
        {currentStart.toLocaleString('es-AR')}-{currentEnd.toLocaleString('es-AR')} de{' '}
        {totalItems.toLocaleString('es-AR')} {itemLabel}.
      </p>
      <div className="flex flex-wrap gap-2">
        {hasPreviousPage ? (
          <Link
            href={buildHref(currentPage - 1, pageSize)}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Anterior
          </Link>
        ) : (
          <span
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'pointer-events-none opacity-50'
            )}
            aria-disabled
          >
            Anterior
          </span>
        )}
        {hasNextPage ? (
          <Link
            href={buildHref(currentPage + 1, pageSize)}
            className={buttonVariants({ variant: 'default', size: 'sm' })}
          >
            Ver mas
          </Link>
        ) : (
          <span
            className={cn(
              buttonVariants({ variant: 'default', size: 'sm' }),
              'pointer-events-none opacity-50'
            )}
            aria-disabled
          >
            Ver mas
          </span>
        )}
      </div>
    </div>
  )
}
