import type { ReactNode } from 'react'
import Link from 'next/link'

import { ImportForm } from '@/components/import/import-form'
import { AppShell } from '@/components/layout/app-shell'
import { ModuleUnavailableCard } from '@/components/portfolio/portfolio-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FILE_KINDS, FILE_ROLES, IMPORT_FORMAT, optionalColumns, requiredColumns } from '@/lib/domain/import-upload'
import { importAvailability } from '@/lib/server/import-availability'
import { moduleAvailable } from '@/lib/domain/database-level-text'
import { loadViewerContext } from '@/lib/server/viewer-context'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const EXAMPLES = [
  { folder: '1-cartera-2026-09-30', title: 'Lote válido', date: '2026-09-30', note: 'La cartera de ejemplo completa. Usalo para la primera carga.' },
  { folder: '2-cartera-2026-10-31-con-errores', title: 'Lote con errores', date: '2026-10-31', note: 'Tiene errores a propósito: se rechaza y no cambia nada. Sirve para ver cómo se informan.' },
  { folder: '3-cartera-2026-10-31', title: 'Lote con fecha posterior', date: '2026-10-31', note: 'La misma cartera un mes después, ya corregida: actualiza el tablero y la fecha.' },
] as const

function FormatHelp() {
  const { limits } = IMPORT_FORMAT
  return (
    <Card>
      <CardHeader>
        <CardTitle>Qué archivos espera la carga</CardTitle>
        <CardDescription>
          Un lote son dos archivos CSV que se eligen juntos. La aplicación reconoce cuál es cuál por sus columnas, no por su nombre.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm text-slate-800">
        <div className="grid gap-4 md:grid-cols-2">
          {FILE_KINDS.map(kind => (
            <section key={kind} aria-label={FILE_ROLES[kind].title} className="space-y-1.5 rounded-md border border-slate-200 p-3" data-format-file={kind}>
              <h3 className="font-semibold">{FILE_ROLES[kind].title}</h3>
              <p>Trae {FILE_ROLES[kind].contains}.</p>
              <p><span className="font-medium">Columnas obligatorias:</span> {requiredColumns(kind).join(', ')}.</p>
              <details>
                <summary className="cursor-pointer text-slate-700 underline">Columnas opcionales</summary>
                <p className="mt-1 text-slate-700">{optionalColumns(kind).join(', ')}.</p>
              </details>
            </section>
          ))}
        </div>

        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div><dt className="font-medium">Separador de columnas</dt><dd>{IMPORT_FORMAT.separatorName}; codificación {IMPORT_FORMAT.encoding}. Un valor que contiene comas va entre comillas dobles.</dd></div>
          <div><dt className="font-medium">Importes</dt><dd>En {IMPORT_FORMAT.currency}, decimales con «{IMPORT_FORMAT.decimal}» y miles con «{IMPORT_FORMAT.thousands}». Ejemplo: {IMPORT_FORMAT.amountExample}</dd></div>
          <div><dt className="font-medium">Fechas</dt><dd>{IMPORT_FORMAT.dateFormat}. Ejemplo: {IMPORT_FORMAT.dateExample}</dd></div>
          <div><dt className="font-medium">Fecha de corte</dt><dd>No viene en los archivos: hay que indicarla al cargar.</dd></div>
        </dl>

        <section aria-label="Códigos admitidos" className="space-y-2">
          <h3 className="font-semibold">Códigos admitidos en las columnas de catálogo</h3>
          <ul className="space-y-1">
            {IMPORT_FORMAT.catalogs.map(catalog => (
              <li key={catalog.column} data-catalog={catalog.column}>
                <span className="font-medium">{catalog.column}</span> ({catalog.file}; {catalog.meaning}):{' '}
                {catalog.codes.map(item => `${item.code} = ${item.label}`).join(' · ')}
              </li>
            ))}
          </ul>
          <p className="text-slate-700">Un código que no esté en estas listas deja a ese objeto fuera de la carga.</p>
        </section>

        <section aria-label="Qué representa el lote" className="space-y-1">
          <h3 className="font-semibold">El lote representa la cartera completa</h3>
          <p>Cada carga reemplaza la foto anterior: tiene que traer todos los objetos y todas las obligaciones, también las pagadas. Si falta un objeto, una obligación o un titular que ya estaba cargado, el lote se rechaza entero y la cartera queda como estaba.</p>
          <p>Si más del {IMPORT_FORMAT.quarantinePercent} % de los objetos (o del importe) tiene errores, el lote se rechaza. Por debajo de ese límite, los objetos con errores quedan en cuarentena y el resto se carga.</p>
          <p>Volver a cargar exactamente el mismo lote con la misma fecha no duplica nada: la aplicación avisa que ya estaba.</p>
        </section>

        <section aria-label="Límites" className="space-y-1" data-import-limits>
          <h3 className="font-semibold">Límites de esta versión</h3>
          <p>Hasta {limits.fileMegabytes} MB y {limits.rows.toLocaleString('es-AR')} filas por archivo, {limits.columns} columnas, y {limits.records.toLocaleString('es-AR')} registros entre personas y objetos. El procesamiento se corta a los {limits.seconds} segundos. Si un lote supera un límite se rechaza sin cambiar nada.</p>
          <p>El formato admitido es el de los archivos de ejemplo (datos sintéticos). Excel y otros formatos municipales todavía no se pueden cargar.</p>
        </section>

        <section aria-label="Archivos de ejemplo" className="space-y-2">
          <h3 className="font-semibold">Archivos de ejemplo para descargar (sintéticos)</h3>
          <ul className="space-y-2">
            {EXAMPLES.map(example => (
              <li key={example.folder} data-example={example.folder}>
                <span className="font-medium">{example.title}</span> — fecha de corte {formatDate(example.date)}. {example.note}{' '}
                {FILE_KINDS.map(kind => (
                  <a key={kind} href={`/ejemplos/carga-csv/${example.folder}/${kind}.csv`} download={`${example.folder}-${kind}.csv`} className="mr-3 underline">
                    {kind}.csv
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  )
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="border-amber-300 bg-amber-50" data-import-notice>
      <CardHeader><CardTitle className="text-amber-950">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm text-amber-950">{children}</CardContent>
    </Card>
  )
}

export default async function ImportPage() {
  const viewer = await loadViewerContext()
  const availability = importAvailability()
  const currentAsOf = viewer?.portfolio.kind === 'LOADED' ? viewer.portfolio.asOf : null

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-[#163a63]">Cargar CSV</h1>
          <p className="text-sm text-slate-700">
            Incorpora la cartera del municipio desde dos archivos CSV. Los archivos se validan completos antes de guardar: si algo falla, la cartera anterior queda intacta.
          </p>
        </header>

        {!viewer && (
          <Notice title="No se pudo verificar tu sesión">
            <p>Volvé a ingresar para cargar un lote. <Link href="/login?next=%2Fimport" className="underline">Ir al ingreso</Link></p>
          </Notice>
        )}

        {viewer && !moduleAvailable(viewer) && <ModuleUnavailableCard what="Cargar CSV" />}

        {viewer && moduleAvailable(viewer) && !viewer.capabilities.canImport && (
          <Notice title="Tu cuenta no puede cargar CSV">
            <p>Cargar un lote cambia la cartera de todo el municipio, y por eso en esta versión solo lo hace una cuenta con rol ADMIN. Tu cuenta es {viewer.roleLabel}: podés ver la cartera, buscar casos y descargar los reportes de lo que ves.</p>
            <p>Si necesitás cargar datos, pedile a una persona administradora de tu municipio que lo haga o que revise tu rol.</p>
          </Notice>
        )}

        {viewer?.capabilities.canImport && !availability.available && (
          <Notice title="La carga de CSV está deshabilitada en esta instalación">
            <p>{availability.explanation}</p>
            <button type="button" disabled className="cursor-not-allowed rounded-md bg-slate-300 px-4 py-2 text-sm font-medium text-slate-600" data-load-button-disabled>Cargar CSV</button>
          </Notice>
        )}

        {viewer?.capabilities.canImport && availability.available && (
          <Card>
            <CardHeader>
              <CardTitle>Elegí los archivos y la fecha</CardTitle>
              <CardDescription>
                {currentAsOf
                  ? `Cartera vigente de ${viewer.tenantName ?? 'tu municipio'}: al ${formatDate(currentAsOf)}.`
                  : viewer.portfolio.kind === 'EMPTY'
                    ? `${viewer.tenantName ?? 'Tu municipio'} todavía no tiene cartera cargada. Esta va a ser la primera.`
                    : viewer.portfolio.kind === 'UNDATED'
                    ? `${viewer.tenantName ?? 'Tu municipio'} tiene una cartera sin fecha registrada. Un lote tiene que traerla completa: si le falta algo de lo que ya está, se rechaza.`
                    : 'No se pudo determinar la fecha de la cartera vigente.'}{' '}
                Los archivos se guardan en la base local de pruebas de esta instalación.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ImportForm currentAsOf={currentAsOf} />
            </CardContent>
          </Card>
        )}

        <FormatHelp />
      </div>
    </AppShell>
  )
}
