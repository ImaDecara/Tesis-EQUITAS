'use client'

import type { ComponentType, ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  ChartScatter,
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

// `module`: la función necesita el módulo de decisiones, cargas y registro de accesos de la base.
type NavItem = { href: string; label: string; icon: ComponentType<{ className?: string }>; module?: true }
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
      { href: '/pending', label: 'Pendientes', icon: Inbox, module: true },
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
      { href: '/analytics', label: 'Analítica', icon: ChartScatter },
    ],
  },
  {
    label: 'Datos',
    items: [
      { href: '/import', label: 'Cargar CSV', icon: Upload, module: true },
      { href: '/reports', label: 'Reportes', icon: FileDown, module: true },
      { href: '/help', label: 'Ayuda', icon: CircleHelp },
    ],
  },
]

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(href))
}

/** Qué fecha usan los cálculos. Sin fecha de corte acreditada se calcula con la de hoy, que NO es la de la cartera. */
export function portfolioLabel(viewer: ViewerContext | null): string {
  if (!viewer) return 'Cartera: no disponible'
  if (viewer.portfolio.kind === 'LOADED') return `Cartera al ${formatDate(viewer.portfolio.asOf)}${viewer.portfolio.declared ? ' (fecha declarada)' : ''}`
  if (viewer.portfolio.kind === 'UNDATED') return `Cálculo al ${formatDate(viewer.portfolio.today)} · Actualización de la cartera: no registrada`
  return viewer.portfolio.kind === 'EMPTY' ? 'Sin cartera cargada' : 'Fecha de la cartera no disponible'
}

/** Base sin el módulo de decisiones: se dice una sola vez, acá, y no en cada pantalla. */
export const consultationOnly = (viewer: ViewerContext | null) => viewer?.moduleMissing === true

function ConsultationNotice() {
  return (
    <details data-consultation-mode className="group relative">
      <summary className="cursor-pointer list-none rounded-full border border-[#cfdaea] bg-[#edf2f9] px-2.5 py-0.5 text-xs font-medium text-[#163a63]">
        Modo consulta
      </summary>
      <p className="absolute z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg">
        Esta base permite ver, buscar y analizar la cartera. Decisiones, pendientes, reportes y carga de CSV no están disponibles en esta base: no tiene instalado ese módulo. No es un error.
      </p>
    </details>
  )
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
      {consultationOnly(viewer) && <ConsultationNotice />}
      <span className="md:ml-auto">
        {viewer ? `${viewer.userName ?? 'Cuenta sin nombre'} · ${viewer.roleLabel}` : 'Sesión no verificada'}
      </span>
    </div>
  )
}

const unavailableHere = (item: NavItem, consultation: boolean) => consultation && item.module === true

function SideNavigation({ consultation }: { consultation: boolean }) {
  const pathname = usePathname()
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-[#0b2646] bg-[#0f2f57] text-slate-200 md:flex">
      <div className="flex h-[66px] items-center gap-2 border-b border-[#1d416e] px-5">
        <Image src="/icono.png" alt="" width={32} height={32} className="size-8 object-contain" priority />
        <div>
          <p className="text-base font-semibold tracking-wide text-white">EQUITAS</p>
          <p className="text-[11px] text-slate-300">Recupero municipal</p>
        </div>
      </div>
      <nav id="menu-principal" aria-label="Menú principal" className="flex-1 space-y-3 px-3 py-3">
        {NAV_SECTIONS.map(section => (
          <section key={section.label} className="space-y-1">
            <div className="px-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{section.label}</p>
              <div className="mt-0.5 h-px w-full bg-slate-400/20" />
            </div>
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
                    {unavailableHere(item, consultation) && <span className="ml-auto text-[10px] font-normal text-slate-400" data-nav-unavailable>no disponible</span>}
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

function TopBar({ consultation }: { consultation: boolean }) {
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
                active ? 'border-[#c7b176] bg-[#f6efdc] text-[#5f4a19]' : 'border-slate-200 bg-white text-slate-600',
                unavailableHere(item, consultation) && !active && 'text-slate-400'
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
              {unavailableHere(item, consultation) && <span className="sr-only"> (no disponible en esta base)</span>}
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
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#eef2f7_0,_#f7f5ef_40%,_#f4f4f1_100%)]">
        <div className="flex min-h-screen">
          <SideNavigation consultation={consultationOnly(viewer)} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar consultation={consultationOnly(viewer)} />
            <ContextLine viewer={viewer} />
            <main id="contenido" className="flex-1 px-4 py-5 md:px-8 md:py-6">{children}</main>
          </div>
        </div>
      </div>
    </AuthGuard>
  )
}
