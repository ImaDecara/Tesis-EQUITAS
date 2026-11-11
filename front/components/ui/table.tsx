import * as React from 'react'

import { cn } from '@/lib/utils'

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  // Contenedor que preserva scroll horizontal en pantallas chicas.
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm text-slate-700', className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-slate-200', className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      className={cn('[&_tr:last-child]:border-0 [&_tr]:border-slate-100', className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b transition-colors duration-150 hover:bg-[#eef3fa] data-[state=selected]:bg-[#e6eef8]',
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-10 px-4 text-left align-middle text-xs font-semibold tracking-wide text-slate-600 uppercase',
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-4 py-3 align-middle text-slate-700', className)} {...props} />
}

/** En pantallas angostas una tabla ancha se desplaza dentro de su marco: se avisa, porque no es evidente. */
function TableScrollHint() {
  return <p data-table-scroll-hint className="pb-1 text-xs text-slate-500 xl:hidden">Deslizá la tabla hacia los lados para ver las demás columnas.</p>
}

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableScrollHint }
