import type { ReactNode } from 'react'

import { withMaturityMetrics } from '@/lib/analytics'
import { portfolioHref, normalizePortfolioSearchParams, type RawPortfolioSearchParams } from '@/lib/portfolio-filters'
import { formatNumber, numericData, readingFailed } from '@/lib/data-presence'
import { ACTIVE_RULES as decisionRules } from '@/lib/domain/decision-rules-v1'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'

import { CaseHeader } from '@/components/case/case-header'
import { CaseTotals, PriorityBreakdown, TechnicalDetail } from '@/components/case/case-summary'
import { recordedDecisionView } from '@/components/case/recorded-decision-summary'
import { DebtsTable } from '@/components/debtors/debts-table'
import { DataWarnings } from '@/components/equitas/data-warnings'
import { AppShell } from '@/components/layout/app-shell'
import { ModuleUnavailableCard } from '@/components/portfolio/portfolio-state'
import { reviewDifferenceNotice, ReviewPanel } from '@/components/review/review-panel'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { auditCaseOpen } from '@/lib/server/audit'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getDebtorDetailData } from '@/lib/equitas-data'
import { loadCaseReviewScreen } from '@/lib/server/case-review-screen'
import { loadRecordedDecisions } from '@/lib/server/recorded-decisions'
import { loadViewerContext } from '@/lib/server/viewer-context'
import type { DataWarning, DebtorContactItem, DebtorPersonItem } from '@/types/equitas-domain'

// Pestañas de la ficha. `?tab=revision` es el alias con que otras pantallas (Pendientes, grupos de
// trabajo) abren la pestaña «Decisión»; `?tab=decision` también vale.
const TAB_ALIASES: Readonly<Record<string, string>> = {
  resumen: 'summary', summary: 'summary', obligaciones: 'debts', debts: 'debts',
  personas: 'people', people: 'people', revision: 'review', decision: 'review', 'decisión': 'review', review: 'review',
}

function StatePage({ title, children, back }: { title: string; children: ReactNode; back: string }) {
  return (
    <AppShell>
      <section className="mx-auto max-w-3xl space-y-3">
        <h1 className="text-2xl font-semibold text-[#163a63]">{title}</h1>
        <div className="space-y-2 text-sm text-slate-700">{children}</div>
        <Link href={back} className="text-sm text-[#163a63] underline">Volver al listado</Link>
      </section>
    </AppShell>
  )
}

function PeopleCard({ people, warnings }: { people: DebtorPersonItem[]; warnings: DataWarning[] }) {
  const relationsReadFailed = readingFailed(warnings, 'debtor', 'debtor_person')
  const personCatalogReadFailed = readingFailed(warnings, 'person')
  const contactsReadFailed = readingFailed(warnings, 'debtor', 'debtor_person', 'debtor_contact')
  const percentages = people.map(person => numericData(person.priority).value)
  const percentageTotal = relationsReadFailed || percentages.some(value => value === null)
    ? null : percentages.reduce<number>((sum, value) => sum + value!, 0)
  // Misma tolerancia que las reglas v1, con margen de representación de Number.
  const percentagesMismatch = percentageTotal !== null &&
    Math.abs(percentageTotal - 100) > decisionRules.banderas.tolerancia_porcentajes + Number.EPSILON * 100
  return (
    <Card>
      <CardHeader>
        <CardTitle>Personas asociadas</CardTitle>
      </CardHeader>
      <CardContent>
        {!relationsReadFailed && people.length > 0 && (percentageTotal === null || percentagesMismatch) && (
          <p role="status" className="mb-3 text-sm text-amber-800">
            {percentageTotal === null
              ? 'No se puede verificar la suma: hay porcentajes no informados o inválidos.'
              : `Los porcentajes declarados suman ${formatNumber(percentageTotal)}%, no 100%.`}{' '}
            No se normalizan ni determinan una cuota legal de deuda.
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Porcentaje declarado en origen</TableHead>
              <TableHead>Relación</TableHead>
              <TableHead>Contacto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-500">
                  {relationsReadFailed ? 'No disponible: no se pudo leer la lista de personas asociadas.' : 'Sin personas asociadas visibles.'}
                </TableCell>
              </TableRow>
            )}
            {people.map((person) => (
              <TableRow key={person.id}>
                <TableCell className="font-medium text-slate-900">{person.name}</TableCell>
                <TableCell>{personCatalogReadFailed ? 'No disponible' : person.document}</TableCell>
                <TableCell>{person.priority}</TableCell>
                <TableCell>{person.relation}</TableCell>
                <TableCell>{contactsReadFailed ? 'No disponible' : person.contact}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function ContactsCard({ contacts, warnings }: { contacts: DebtorContactItem[]; warnings: DataWarning[] }) {
  const contactsReadFailed = readingFailed(warnings, 'debtor', 'debtor_person', 'debtor_contact')
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contactos de las personas asociadas</CardTitle>
      </CardHeader>
      <CardContent>
        {contacts.some(contact => contact.channel === 'No disponible') && (
          <p role="status" className="mb-3 text-sm text-amber-800">
            {readingFailed(warnings, 'contact_type')
              ? 'Canal no disponible: no se pudo leer el catálogo de tipos de contacto.'
              : 'Canal no disponible en contactos cuyo tipo no figura en el catálogo.'}
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead>Canal</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-slate-500">
                  {contactsReadFailed ? 'No disponible: no se pudo leer la lista de contactos.' : 'Sin contactos registrados para este caso.'}
                </TableCell>
              </TableRow>
            )}
            {contacts.map((contact) => (
              <TableRow key={`${contact.personId}-${contact.id}-${contact.value}`}>
                <TableCell className="font-medium text-slate-900">
                  {contact.personName || `Persona ${contact.personId}`}
                </TableCell>
                <TableCell>{contact.channel}</TableCell>
                <TableCell className="break-all">{contact.value}</TableCell>
                <TableCell>
                  <Badge variant={contact.isActive ? 'success' : 'warning'}>
                    {contact.isActive ? 'Activo' : 'Inactivo'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export default async function DebtorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ debtorId: string }>
  searchParams?: Promise<RawPortfolioSearchParams & { tab?: string | string[] }>
}) {
  const { debtorId } = await params
  const rawParams = await searchParams ?? {}
  const requestedTab = (Array.isArray(rawParams.tab) ? rawParams.tab[0] : rawParams.tab)?.trim().toLowerCase()
  const filters = normalizePortfolioSearchParams(rawParams)
  const back = portfolioHref('/debtors', filters)
  const { detail, warnings } = await getDebtorDetailData(debtorId)

  if (!detail) {
    if (readingFailed(warnings, 'debtor')) {
      return (
        <StatePage title="No se pudo leer este caso" back={back}>
          <p>No se puede saber si el caso existe: la lectura de la cartera falló. Recargá la página en unos minutos; si sigue igual, avisá a quien administra el sistema.</p>
          <details>
            <summary className="cursor-pointer">Detalle técnico</summary>
            <DataWarnings warnings={warnings} />
          </details>
        </StatePage>
      )
    }
    const viewer = await loadViewerContext()
    if (viewer?.portfolio.kind === 'EMPTY') {
      return (
        <StatePage title="Tu municipio todavía no tiene una cartera cargada" back={back}>
          <p>Por eso no hay casos para abrir.</p>
          {viewer.capabilities.canImport
            ? <p><Link href="/import" className="font-medium text-[#163a63] underline">Cargar CSV</Link> para publicar la primera cartera.</p>
            : <p>Cargar la cartera requiere una cuenta con rol ADMIN.</p>}
        </StatePage>
      )
    }
    notFound()
  }

  // Si no se puede leer la decisión registrada, el encabezado lo dice («No se pudo leer…»): la ficha
  // se entrega igual y nunca muestra «sin decisión» en su lugar.
  const recordedDecisions = await loadRecordedDecisions().catch(() => ({ ok: false as const, reason: 'UNAVAILABLE' as const }))
  // Noche 7 (encargo 10.2): en una base sin el módulo de decisiones la pestaña lo dice y no se lee nada más.
  const moduleMissing = !recordedDecisions.ok && recordedDecisions.reason === 'NO_MODULE'
  const reviewScreen = moduleMissing ? null : await loadCaseReviewScreen(debtorId)
  const reviewNotice = reviewScreen ? reviewDifferenceNotice(detail.debtor, reviewScreen) : null

  const { debtor: sourceDebtor, debts, people, contacts } = detail
  const debtor = withMaturityMetrics(sourceDebtor)
  const decisionReadFailed = !debtor.decision && (debtor.decisionIssues?.some(issue => issue.reason === 'LECTURA_FALLIDA') ?? false)
  const defaultTab = (requestedTab && TAB_ALIASES[requestedTab]) || 'summary'

  // ALIGN-069: cada entrega de la ficha deja un registro. Si no se puede registrar, no se entrega.
  await auditCaseOpen(debtor.id)

  return (
    <AppShell>
      <Link
        href={back}
        className="mb-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="size-3.5" />
        Volver al listado
      </Link>

      <CaseHeader debtor={debtor} recorded={recordedDecisionView(recordedDecisions, debtor.id)} readFailed={decisionReadFailed} />

      <div className="space-y-5">
        <DataWarnings warnings={warnings} />
        {reviewNotice && <p role="status" className="text-sm text-amber-800">{reviewNotice}</p>}

        <Tabs defaultValue={defaultTab}>
          <TabsList aria-label="Secciones del caso">
            <TabsTrigger value="summary">Resumen</TabsTrigger>
            <TabsTrigger value="debts">Obligaciones</TabsTrigger>
            <TabsTrigger value="people">Personas y contactos</TabsTrigger>
            <TabsTrigger value="review">Decisión</TabsTrigger>
          </TabsList>

          <TabsContent value="summary">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <PriorityBreakdown debtor={debtor} readFailed={decisionReadFailed} />
              <div className="min-w-0 space-y-4">
                <CaseTotals debtor={debtor} />
                <TechnicalDetail debtor={debtor} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="debts">
            <Card>
              <CardHeader>
                <CardTitle>Obligaciones del caso</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <DebtsTable
                  debts={debts}
                  readFailed={readingFailed(warnings, 'debtor', 'debt')}
                  asOf={debtor.decisionAsOf?.valor ?? null}
                  statusesFailed={readingFailed(warnings, 'debt_status')}
                />
                <p className="text-xs text-slate-600">
                  Vencida: pendiente, con importe mayor que cero y vencimiento anterior a la fecha de la cartera. Las pagadas no cuentan como deuda pendiente ni vencida.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="people">
            <div className="space-y-4">
              <PeopleCard people={people} warnings={warnings} />
              <ContactsCard contacts={contacts} warnings={warnings} />
            </div>
          </TabsContent>

          <TabsContent value="review" keepMounted>
            {reviewScreen ? <ReviewPanel screen={reviewScreen} /> : <ModuleUnavailableCard what="Decisión" />}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  )
}
