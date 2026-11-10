import type { ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, Inbox, Lock, Upload } from 'lucide-react'

import { AppShell } from '@/components/layout/app-shell'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MODULE_MISSING_EXPLANATION, UNAVAILABLE_ON_THIS_DATABASE } from '@/lib/domain/database-level-text'
import { loadViewerContext } from '@/lib/server/viewer-context'
import { cn } from '@/lib/utils'

// Noche 7 (plan §8.4). Los estados de las pantallas de cartera, con la misma forma en todas:
// qué pasa y qué puede hacer la persona. Un error de lectura nunca se muestra como vacío ni como cero.

type Tone = 'info' | 'warning' | 'error'
const TONES: Record<Tone, string> = {
  info: 'border-[#cfdaea] bg-white',
  warning: 'border-[#e7d2ae] bg-[#fbf7ec]',
  error: 'border-[#e5c0c0] bg-[#fbefef]',
}

export function StateCard({ title, tone = 'info', icon: Icon = Inbox, children, state }: {
  title: string; tone?: Tone; icon?: typeof Inbox; children: ReactNode; state: string
}) {
  return (
    <Card data-portfolio-state={state} role={tone === 'error' ? 'alert' : 'status'} className={cn('shadow-sm', TONES[tone])}>
      <CardHeader className="pb-2">
        <CardTitle className="inline-flex items-center gap-2 text-base text-[#163a63]">
          <Icon className="size-4 shrink-0" aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-700">{children}</CardContent>
    </Card>
  )
}

/** Municipio sin ninguna cartera cargada: una sola tarjeta, sin ceros, gráficos ni reportes. */
export function NoPortfolioCard({ canImport }: { canImport: boolean }) {
  return (
    <StateCard state="no-portfolio" title="Tu municipio todavía no tiene una cartera cargada" icon={Upload}>
      <p>Cuando se cargue el primer archivo CSV vas a ver acá los casos, los grupos de trabajo y los totales de la cartera.</p>
      {canImport
        ? <Link href="/import" className={buttonVariants({ variant: 'default' })}><Upload className="size-4" />Cargar CSV</Link>
        : <p className="font-medium">Pedile a una persona administradora que la cargue: cargar un CSV requiere una cuenta con rol ADMIN.</p>}
    </StateCard>
  )
}

/** La base no tiene el módulo de decisiones, cargas y registro de accesos (encargo 10.2): no es un error. */
export function ModuleUnavailableCard({ what }: { what: string }) {
  return (
    <StateCard state="module-unavailable" title={`${what}: ${UNAVAILABLE_ON_THIS_DATABASE.toLowerCase()}`} icon={Lock}>
      <p>{MODULE_MISSING_EXPLANATION}</p>
    </StateCard>
  )
}

/** Filtros sin coincidencias: es un resultado válido, no un error. */
export function EmptyFilterState({ clearHref, what = 'casos' }: { clearHref: string; what?: string }) {
  return (
    <div data-portfolio-state="empty-filter" role="status" className="space-y-2 py-4 text-center text-sm text-slate-600">
      <p>No hay {what} que cumplan los filtros elegidos.</p>
      <Link href={clearHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Limpiar filtros</Link>
    </div>
  )
}

/** Error de lectura: dice qué no se pudo leer y que no significa «no hay». */
export function ReadErrorState({ what, children }: { what: string; children?: ReactNode }) {
  return (
    <StateCard state="read-error" tone="error" icon={AlertTriangle} title={`No se pudo leer ${what}`}>
      <p>Esto no significa que no haya datos: recargá la página. Si sigue igual, avisá a quien administra el sistema.</p>
      {children}
    </StateCard>
  )
}

/** Función que el rol no permite: qué hace falta y qué sí puede hacer la persona. */
export function ForbiddenState({ title, children }: { title: string; children: ReactNode }) {
  return <StateCard state="forbidden" tone="warning" icon={Lock} title={title}>{children}</StateCard>
}

export function PageHeading({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-5 space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight text-[#163a63]">{title}</h1>
      {description && <p className="max-w-3xl text-sm text-slate-600">{description}</p>}
    </header>
  )
}

/**
 * Si el municipio no tiene cartera cargada devuelve la pantalla completa con la tarjeta única;
 * si tiene cartera (o no se pudo saber) devuelve null y la página sigue con su contenido.
 */
export async function emptyPortfolioScreen(title: string): Promise<ReactNode | null> {
  const viewer = await loadViewerContext()
  if (viewer?.portfolio.kind !== 'EMPTY') return null
  return (
    <AppShell>
      <PageHeading title={title} />
      <NoPortfolioCard canImport={viewer.capabilities.canImport} />
    </AppShell>
  )
}
