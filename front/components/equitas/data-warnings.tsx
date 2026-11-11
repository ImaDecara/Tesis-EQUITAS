import { AlertTriangle } from 'lucide-react'

import { readLabel } from '@/components/portfolio/portfolio-text'
import { type DataWarning } from '@/types/equitas-domain'

// Error de lectura (plan §8.4): dice qué no se pudo leer y qué hacer, sin bloquear la pantalla.
// Las cifras que dependen de esa lectura se muestran «No disponible», nunca como cero.
// El nombre de la tabla y el mensaje del servidor quedan en el detalle técnico, plegado.
export function DataWarnings({ warnings }: { warnings: DataWarning[] }) {
  if (!warnings.length) {
    return null
  }
  const what = [...new Set(warnings.map(warning => readLabel(warning.table)))]
  const permission = warnings.some(warning => warning.needsSelectPolicy)

  return (
    <div role="alert" data-read-errors className="rounded-lg border border-[#d8c28a] bg-[#f6efdc] p-4 text-[#5f4a19]">
      <p className="mb-1 inline-flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        No se pudieron leer algunos datos
      </p>
      <p className="text-sm">
        Falta leer {what.join(', ')}. Las cifras que dependen de esos datos dicen «No disponible»: no son ceros.
        {permission
          ? ' Puede ser un permiso de tu cuenta: pedile a quien administra el sistema que lo revise.'
          : ' Recargá la página; si sigue igual, avisá a quien administra el sistema.'}
      </p>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer">Detalle técnico</summary>
        <ul className="mt-1 space-y-1">
          {warnings.map((warning) => (
            <li key={`${warning.table}-${warning.message}`}>
              <span className="font-medium">{warning.table}:</span> {warning.message}
              {warning.needsSelectPolicy && (
                <span> (Acceso no disponible. Solicite al administrador que revise los permisos de su cuenta.)</span>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
