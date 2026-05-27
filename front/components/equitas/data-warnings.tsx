import { AlertTriangle } from 'lucide-react'

import { type DataWarning } from '@/types/equitas-domain'

// Renderiza alertas de acceso a datos (RLS/policies faltantes) sin bloquear la interfaz.
export function DataWarnings({ warnings }: { warnings: DataWarning[] }) {
  if (!warnings.length) {
    return null
  }

  return (
    <div className="rounded-lg border border-[#d8c28a] bg-[#f6efdc] p-4 text-[#5f4a19]">
      <p className="mb-2 inline-flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="size-4" />
        Tablas con acceso restringido o errores de lectura
      </p>
      <ul className="space-y-1 text-xs">
        {warnings.map((warning) => (
          <li key={`${warning.table}-${warning.message}`}>
            <span className="font-medium">{warning.table}:</span> {warning.message}
            {warning.needsSelectPolicy && (
              <span> (agregar policy `SELECT` para el rol `anon`/`authenticated`)</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
