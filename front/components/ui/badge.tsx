import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition',
  {
    variants: {
      variant: {
        neutral: 'border-slate-300 bg-slate-100 text-slate-800',
        success: 'border-[#b7ddca] bg-[#e8f3ed] text-[#255a43]',
        warning: 'border-[#d8c28a] bg-[#f6efdc] text-[#6f561e]',
        danger: 'border-[#e8b7b7] bg-[#f8e7e7] text-[#8f3434]',
        info: 'border-[#b8c8dd] bg-[#e6edf6] text-[#123459]',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  // Insignia semantica liviana para estado (riesgo, estado, banderas).
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
