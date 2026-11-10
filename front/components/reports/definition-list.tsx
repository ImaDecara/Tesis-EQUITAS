import type { Definition } from '@/lib/reports/report-definitions'

// Noche 7. Término y definición en una línea: lo usan «Reportes» y «Ayuda».
export function DefinitionList({ items }: { items: readonly Definition[] }) {
  return (
    <dl className="space-y-1">
      {items.map(item => <div key={item.term}><dt className="inline font-medium">{item.term}:</dt> <dd className="inline">{item.text}</dd></div>)}
    </dl>
  )
}
