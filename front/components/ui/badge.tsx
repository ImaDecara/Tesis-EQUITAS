import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition',
  {
    variants: {
      variant: {
        neutral: 'border-slate-200 bg-slate-100 text-slate-700',
        success: 'border-[#b7ddca] bg-[#e8f3ed] text-[#2d6a4f]',
        warning: 'border-[#d8c28a] bg-[#f6efdc] text-[#8a6f2a]',
        danger: 'border-[#e8b7b7] bg-[#f8e7e7] text-[#9d3d3d]',
        info: 'border-[#b8c8dd] bg-[#e6edf6] text-[#163a63]',
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
