'use client'

import type { ComponentType, ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  CircleHelp,
  ClipboardCheck,
  FileDown,
  Inbox,
  LayoutDashboard,
  ListChecks,
  ListTree,
  PhoneOff,
  ShieldAlert,
  Upload,
  UsersRound,
  WalletCards,
} from 'lucide-react'

import { AuthGuard } from '@/components/auth/auth-guard'
import { LogoutButton } from '@/components/layout/logout-button'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { ViewerContext } from '@/lib/server/viewer-context'

type NavItem = { href: string; label: string; icon: ComponentType<{ className?: string }> }
type NavigationSection = { label: string; items: NavItem[] }

// Un solo menú para toda la aplicación. Las entradas son las mismas para ADMIN y USER: lo que una
// cuenta no puede hacer se explica en la pantalla, no se esconde.
export const NAV_SECTIONS: NavigationSection[] = [
  {
    label: 'Trabajo',
    items: [
      { href: '/', label: 'Tablero', icon: LayoutDashboard },
      { href: '/debtors', label: 'Casos', icon: ListTree },
      { href: '/priority-cases', label: 'Grupos de trabajo', icon: ListChecks },
      { href: '/pending', label: 'Pendientes', icon: Inbox },
      { href: '/no-contact', label: 'Casos sin contacto', icon: PhoneOff },
      { href: '/people', label: 'Personas', icon: UsersRound },
    ],
  },
  {
    label: 'Análisis',
    items: [
      { href: '/debt-aging', label: 'Deuda y mora', icon: WalletCards },
      { href: '/risk-analysis', label: 'Puntaje de prioridad', icon: ShieldAlert },
      { href: '/recommended-actions', label: 'Acciones recomendadas', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Datos',
    items: [
      { href: '/import', label: 'Cargar CSV', icon: Upload },
      { href: '/reports', label: 'Reportes', icon: FileDown },
      { href: '/help', label: 'Ayuda', icon: CircleHelp },
    ],
  },
]

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(href))
}

export function portfolioLabel(viewer: ViewerContext | null): string {
  if (!viewer) return 'Cartera: no disponible'
  if (viewer.portfolio.kind === 'LOADED') return `Cartera al ${formatDate(viewer.portfolio.asOf)}`
  return viewer.portfolio.kind === 'EMPTY' ? 'Sin cartera cargada' : 'Fecha de la cartera no disponible'
}

// Línea fija: qué se está viendo, a qué fecha corresponde y quién está usando la aplicación.
export function ContextLine({ viewer }: { viewer: ViewerContext | null }) {
  return (
    <div
      aria-label="Contexto de trabajo"
      data-context-line
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 bg-white/90 px-4 py-2 text-sm text-slate-700 md:px-8"
    >
      <span className="font-semibold text-[#163a63]">{viewer?.tenantName ?? 'Municipio no disponible'}</span>
      <span data-portfolio-date>{portfolioLabel(viewer)}</span>
      <span className="md:ml-auto">
        {viewer ? `${viewer.userName ?? 'Cuenta sin nombre'} · ${viewer.roleLabel}` : 'Sesión no verificada'}
      </span>
    </div>
  )
}

function SideNavigation() {
  const pathname = usePathname()
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-[#0b2646] bg-[#0f2f57] text-slate-200 md:flex">
      <div className="flex h-[58px] items-center gap-2 border-b border-[#1d416e] px-5">
        <Image src="/icono.png" alt="" width={30} height={30} className="size-7 object-contain" priority />
        <div>
          <p className="text-base font-semibold tracking-wide text-white">EQUITAS</p>
          <p className="text-[11px] text-slate-300">Recupero municipal</p>
        </div>
      </div>
      <nav id="menu-principal" aria-label="Menú principal" className="flex-1 space-y-3 px-3 py-3">
        {NAV_SECTIONS.map(section => (
          <section key={section.label} className="space-y-1">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{section.label}</p>
            <div className="space-y-0.5">
              {section.items.map(item => {
                const Icon = item.icon
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm font-medium transition duration-150',
                      active
                        ? 'border-[#a58a47]/60 bg-[#8a6f2a] text-white shadow-sm'
                        : 'text-slate-200 hover:border-[#245287] hover:bg-[#1a4578] hover:text-white'
                    )}
                  >
                    <Icon className="size-[17px]" />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
        <LogoutButton className="mt-3 h-10 w-full justify-start border-[#245287] bg-[#143a66] text-slate-100 hover:border-[#35669f] hover:bg-[#1a4578] hover:text-white" />
      </nav>
    </aside>
  )
}

function TopBar() {
  const pathname = usePathname()
  return (
    <header className="border-b border-slate-200 bg-white md:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Image src="/icono.png" alt="" width={24} height={24} className="size-6 object-contain" priority />
          <p className="text-sm font-semibold text-[#163a63]">EQUITAS</p>
        </div>
        <LogoutButton />
      </div>
      <nav aria-label="Menú principal" className="flex gap-2 overflow-x-auto px-4 pb-3">
        {NAV_SECTIONS.flatMap(section => section.items).map(item => {
          const Icon = item.icon
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs',
                active ? 'border-[#c7b176] bg-[#f6efdc] text-[#5f4a19]' : 'border-slate-200 bg-white text-slate-600'
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}

export function AppFrame({ viewer, children }: { viewer: ViewerContext | null; children: ReactNode }) {
  return (
    <AuthGuard>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow">
        Saltar al contenido
      </a>
      <div className="min-h-screen bg-[#f5f5f2]">
        <div className="flex min-h-screen">
          <SideNavigation />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <ContextLine viewer={viewer} />
            <main id="contenido" className="flex-1 px-4 py-5 md:px-8 md:py-6">{children}</main>
          </div>
        </div>
      </div>
    </AuthGuard>
  )
}
