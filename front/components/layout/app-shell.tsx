'use client'

import type { ComponentType, ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ListTree, Landmark, Shield } from 'lucide-react'

import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/debtors', label: 'Objetos de deuda', icon: ListTree },
]

function SideNavigation() {
  const pathname = usePathname()

  return (
    <aside className="hidden w-64 border-r border-slate-200 bg-white/70 backdrop-blur md:block">
      <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5">
        <div className="rounded-md bg-emerald-600 p-1.5 text-white">
          <Landmark className="size-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">EQUITAS</p>
          <p className="text-xs text-slate-500">Debt Recovery MVP</p>
        </div>
      </div>

      <nav className="space-y-1 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href))
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}

function TopBar() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur">
      <div className="flex h-16 items-center justify-between px-4 md:px-8">
        <div className="flex items-center gap-2 md:hidden">
          <div className="rounded-md bg-emerald-600 p-1.5 text-white">
            <Landmark className="size-4" />
          </div>
          <p className="text-sm font-semibold text-slate-900">EQUITAS</p>
        </div>

        <div className="hidden text-xs text-slate-500 md:block">
          Sistema inteligente de recupero de deuda municipal
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
          <Shield className="size-3.5 text-emerald-600" />
          Tenant activo
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto px-4 pb-3 md:hidden">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href))
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs',
                isActive
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-600'
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
            </Link>
          )
        })}
      </div>
    </header>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#dff7ea_0,_#f8fbff_34%,_#f5f7fb_100%)]">
      <div className="flex min-h-screen">
        <SideNavigation />

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
    </div>
  )
}
