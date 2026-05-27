'use client'

import type { ComponentType, ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ListTree, Shield, UsersRound } from 'lucide-react'

import { AuthGuard } from '@/components/auth/auth-guard'
import { useAuthState } from '@/components/auth/auth-provider'
import { LogoutButton } from '@/components/layout/logout-button'
import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/debtors', label: 'Objetos de deuda', icon: ListTree },
  { href: '/people', label: 'Personas / Deudores', icon: UsersRound },
]

function SideNavigation() {
  const pathname = usePathname()

  return (
    <aside className="hidden w-72 border-r border-[#0b2646] bg-[#0f2f57] text-slate-200 md:block">
      <div className="flex h-16 items-center gap-2 border-b border-[#1d416e] px-5">
        <Image
          src="/icono.png"
          alt="EQUITAS"
          width={28}
          height={28}
          className="size-7 object-contain"
          priority
        />
        <div>
          <p className="text-sm font-semibold text-white">EQUITAS</p>
          <p className="text-xs text-slate-300">Recupero municipal</p>
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
                  ? 'bg-[#8a6f2a] text-white'
                  : 'text-slate-200 hover:bg-[#1c4477] hover:text-white'
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
  const { tenant, role } = useAuthState()

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex h-16 items-center justify-between px-4 md:px-8">
        <div className="flex items-center gap-2 md:hidden">
          <Image
            src="/icono.png"
            alt="EQUITAS"
            width={26}
            height={26}
            className="size-6 object-contain"
            priority
          />
          <p className="text-sm font-semibold text-[#163a63]">EQUITAS</p>
        </div>

        <div className="hidden text-xs text-slate-600 md:block">
          Sistema inteligente de recupero de deuda municipal
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d8c28a] bg-[#f6efdc] px-3 py-1 text-xs text-[#5f4a19]">
            <Shield className="size-3.5 text-[#8a6f2a]" />
            {tenant?.id ? `Tenant ${tenant.id}` : 'Tenant activo'}
            {role ? ` - ${role}` : ''}
          </div>
          <LogoutButton />
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
                  ? 'border-[#c7b176] bg-[#f6efdc] text-[#5f4a19]'
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
    <AuthGuard>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#eef2f7_0,_#f7f5ef_40%,_#f4f4f1_100%)]">
        <div className="flex min-h-screen">
          <SideNavigation />

          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
          </div>
        </div>
      </div>
    </AuthGuard>
  )
}
