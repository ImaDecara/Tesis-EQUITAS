import type { ReactNode } from 'react'
import Link from 'next/link'

import { IntensityTable, SCORE_FACTORS, ScoreBandTable, ScoreFactorTables } from '@/components/help/rules-tables'
import { AppShell } from '@/components/layout/app-shell'
import { GROUP_CRITERIA } from '@/components/portfolio/portfolio-text'
import { DefinitionList } from '@/components/reports/definition-list'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { STALE_LABEL } from '@/lib/domain/recorded-decision'
import { roleLabel } from '@/lib/domain/role-labels'
import { PORTFOLIO_TOTALS } from '@/lib/reports/report-definitions'
import { roleHasPermission, type DalPermission } from '@/lib/server/dal'

export const dynamic = 'force-dynamic'

// Noche 7 (plan §8.5). Ayuda breve, en secciones con ancla y sin jerga. Las tablas del puntaje, las
// bandas, los grupos y la intensidad salen del contrato ACTIVO de reglas; los permisos, de la DAL.

const SECTIONS = [
  ['que-muestra', 'Qué muestra la aplicación'],
  ['totales', 'Totales'],
  ['puntaje', 'Puntaje de prioridad'],
  ['grupos', 'Grupos de trabajo'],
  ['decisiones', 'Recomendación, decisión y aprobación'],
  ['estados', 'Estados de las obligaciones'],
  ['cargar-csv', 'Cómo cargar un CSV'],
  ['cuentas', 'Qué puede hacer cada cuenta'],
  ['limites', 'Límites de esta versión'],
] as const

type SectionId = (typeof SECTIONS)[number][0]
const title = (id: SectionId) => SECTIONS.find(([key]) => key === id)![1]

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="scroll-mt-24 space-y-3 rounded-lg border border-[#d2dceb] bg-white p-4 text-sm text-slate-700">
      <h2 id={`${id}-titulo`} className="text-lg font-semibold text-[#163a63]">{title(id)}</h2>
      {children}
    </section>
  )
}

// Rótulos del catálogo de estados. Ninguno tiene una regla propia salvo «Pagada».
const OBLIGATION_STATES = ['Vigente', 'Vencida', 'Plan de pago', 'Judicial', 'Certificado activo', 'Cancelada', 'Desconocido', 'Suspendida']

const PERMISSION_ROWS: readonly { permission: DalPermission; text: string }[] = [
  { permission: 'portfolio:read', text: 'Ver el tablero, los casos, los grupos de trabajo, las personas y la ficha de cada caso; descargar los reportes de casos y de calidad de datos' },
  { permission: 'decision:read', text: 'Ver la decisión registrada de cada caso y su estado; descargar el reporte de decisiones' },
  { permission: 'report:object-identifier', text: 'Ver el identificador de cada caso en los reportes descargados' },
  { permission: 'decision:record', text: 'Registrar una decisión sobre un caso' },
  { permission: 'decision:approve', text: 'Aprobar u objetar la propuesta de otra persona' },
  { permission: 'import:write', text: 'Cargar un CSV con la cartera del municipio' },
  { permission: 'supervision:read', text: 'Descargar el reporte de supervisión de decisiones' },
  { permission: 'audit:read', text: 'Descargar el registro de accesos' },
]
const ACCOUNTS = ['ADMIN', 'USER'] as const

export default function HelpPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-[#163a63]">Ayuda</h1>
          <nav aria-label="Secciones de la ayuda">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {SECTIONS.map(([id, label]) => <li key={id}><a href={`#${id}`} className="text-[#163a63] underline">{label}</a></li>)}
            </ul>
          </nav>
        </header>

        <Section id="que-muestra">
          <p>La aplicación muestra la cartera de deuda de un municipio a una fecha: la <span className="font-medium">fecha de la cartera</span>, que se ve siempre en la línea de arriba. Cada carga de CSV trae una fecha nueva.</p>
          <p>La unidad de trabajo es el <span className="font-medium">caso</span>: un objeto tributario (un inmueble, un rodado, una conexión), no la persona. Un caso puede tener varias personas vinculadas y una persona puede estar en varios casos.</p>
        </Section>

        <Section id="totales">
          <DefinitionList items={PORTFOLIO_TOTALS} />
          <p>Las obligaciones pagadas suman al total registrado pero no cuentan como deuda pendiente ni vencida. Las suspendidas, en plan de pago, judiciales, con certificado o canceladas se computan por su importe y su vencimiento, como cualquier otra: no tienen una regla especial.</p>
          <p>Un dato que falta nunca se cuenta como cero: la pantalla dice cuántos datos faltan. Los mismos números aparecen en el tablero, en la ficha del caso y en los <Link href="/reports" className="underline">reportes</Link>.</p>
        </Section>

        <Section id="puntaje">
          <p>Cada caso tiene un puntaje de prioridad de 0 a 100 que se calcula por reglas fijas. No es una probabilidad de pago ni usa aprendizaje automático: ordena el trabajo.</p>
          <p>Suma tres partes: {SCORE_FACTORS.map(factor => `${factor.name.toLowerCase()} (hasta ${factor.maximum} puntos)`).join(', ')}. Un caso sin obligaciones vencidas tiene 0. El desglose de cada caso está en su ficha, en la pestaña Resumen.</p>
          <ScoreFactorTables />
          <p className="font-medium text-[#163a63]">Bandas</p>
          <ScoreBandTable />
        </Section>

        <Section id="grupos">
          <p>Cada caso está en un solo grupo de trabajo. Las reglas se aplican en este orden y <span className="font-medium">gana la primera que se cumple</span>:</p>
          <ol className="list-decimal space-y-1 pl-5" data-group-rules>
            {GROUP_CRITERIA.map(item => <li key={item.rule}>Si {item.rule}: <span className="font-medium">{item.group}</span>.</li>)}
          </ol>
          <p>Los grupos son: {[...new Set(GROUP_CRITERIA.map(item => item.group))].join(', ')}. Dentro de cada grupo los casos se ordenan por su puntaje; los puntajes de grupos distintos no se comparan.</p>
        </Section>

        <Section id="decisiones">
          <ul className="list-disc space-y-1 pl-5">
            <li><span className="font-medium">Recomendación automática:</span> la acción que sugiere el sistema por reglas, con su explicación. Nunca sugiere una intensidad mayor que 2.</li>
            <li><span className="font-medium">Decisión registrada:</span> lo que decide una persona con rol ADMIN sobre el caso (aceptar, modificar, rechazar, posponer o derivar), con su motivo. Se registra en la pestaña Decisión de la ficha.</li>
            <li><span className="font-medium">Aprobación:</span> solo para acciones de intensidad 3 o 4. Quedan como propuesta hasta que <span className="font-medium">otra</span> persona con rol ADMIN las aprueba u objeta; quien registró la propuesta no puede aprobarla. Lo que espera tu respuesta está en Pendientes.</li>
          </ul>
          <IntensityTable />
          <p><span className="font-medium">«{STALE_LABEL}»</span>: la decisión se tomó con otra fecha de cartera o con otras reglas que las vigentes. Se conserva, pero conviene revisar el caso de nuevo con los datos actuales.</p>
        </Section>

        <Section id="estados">
          <p>Cada obligación trae un estado del catálogo del municipio. Todas suman al total registrado.</p>
          <ul className="list-disc space-y-1 pl-5" data-obligation-states>
            <li><span className="font-medium">Pagada:</span> no cuenta como deuda pendiente ni vencida, ni en el puntaje.</li>
            <li>
              <span className="font-medium">{OBLIGATION_STATES.join(', ')}:</span> cuentan como deuda pendiente. Son deuda vencida si tienen
              importe mayor que cero y vencen antes de la fecha de la cartera. El estado «Vencida» del archivo no decide por sí solo: se mira la fecha de vencimiento.
            </li>
          </ul>
          <p>Si no se pudo leer el catálogo de estados, el caso no se evalúa y la pantalla lo dice como error de lectura, nunca como «sin deuda».</p>
        </Section>

        <Section id="cargar-csv">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Entrá a <Link href="/import" className="underline">Cargar CSV</Link> (requiere una cuenta con rol ADMIN).</li>
            <li>Elegí juntos los dos archivos del lote: cabecera y detalle.</li>
            <li>Indicá la fecha de la cartera y confirmá.</li>
            <li>Revisá el resumen: si hay errores, la pantalla dice qué corregir y la cartera anterior queda intacta. Si entra, el tablero y los listados muestran la cartera nueva.</li>
          </ol>
          <p>El formato esperado de cada columna está en la misma pantalla de carga. En el registro de accesos la carga figura como «Confirmación de carga solicitada»: el resultado de esa carga está en el lote, no en ese registro.</p>
        </Section>

        <Section id="cuentas">
          <Table data-permissions>
            <TableHeader>
              <TableRow><TableHead>Función</TableHead>{ACCOUNTS.map(role => <TableHead key={role}>{role} ({roleLabel(role)})</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSION_ROWS.map(row => (
                <TableRow key={row.permission}>
                  <TableCell>{row.text}</TableCell>
                  {ACCOUNTS.map(role => <TableCell key={role}>{roleHasPermission(role, row.permission) ? 'Sí' : 'No'}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p>Las dos cuentas leen la misma cartera de su municipio. Lo que escribe o muestra la actividad de otras personas requiere ADMIN. Las aperturas de casos y las descargas quedan registradas para las dos.</p>
        </Section>

        <Section id="limites">
          <ul className="list-disc space-y-1 pl-5">
            <li>Los datos de esta versión son sintéticos.</li>
            <li>Las reglas del puntaje, los grupos y la escala de intensidad son provisionales: todavía no tienen validación municipal.</li>
            <li>La carga acepta archivos CSV; Excel queda pendiente.</li>
          </ul>
        </Section>
      </div>
    </AppShell>
  )
}
