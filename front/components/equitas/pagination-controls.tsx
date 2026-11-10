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
  /** Unidad en singular y plural: «caso» / «casos». */
  itemLabel: readonly [string, string]
  buildHref: (page: number, pageSize: number) => string
}

const n = (value: number) => value.toLocaleString('es-AR')
const unit = (count: number, [one, other]: readonly [string, string]) => (count === 1 ? one : other)

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
        {totalItems === 0 ? `0 ${itemLabel[1]}.` : `${n(currentStart)}–${n(currentEnd)} de ${n(totalItems)} ${unit(totalItems, itemLabel)}.`}
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
        <span>por página</span>
      </div>
    </div>
  )
}

function PageLink({ href, label, variant }: { href: string | null; label: string; variant: 'outline' | 'default' }) {
  if (href) return <Link href={href} className={buttonVariants({ variant, size: 'sm' })}>{label}</Link>
  return (
    <span className={cn(buttonVariants({ variant, size: 'sm' }), 'pointer-events-none opacity-50')} aria-disabled>
      {label}
    </span>
  )
}

export function PaginationControls({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  buildHref,
}: PaginationControlsProps) {
  if (totalItems === 0) {
    return null
  }

  return (
    <nav aria-label="Páginas" className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
      <p>Página {n(currentPage)} de {n(totalPages)}</p>
      <div className="flex flex-wrap gap-2">
        <PageLink href={currentPage > 1 ? buildHref(currentPage - 1, pageSize) : null} label="Anterior" variant="outline" />
        <PageLink href={currentPage < totalPages ? buildHref(currentPage + 1, pageSize) : null} label="Siguiente" variant="default" />
      </div>
    </nav>
  )
}
