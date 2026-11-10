import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatNumber } from '@/lib/data-presence'
import { ACTIVE_RULES, type SeverityFactor } from '@/lib/domain/decision-rules-v1'
import { formatCurrency } from '@/lib/utils'

// Noche 7 (plan §8.5). Tablas de la ayuda generadas desde el contrato ACTIVO de reglas: si cambia una
// versión, cambia la ayuda. Nada de esto se escribe a mano.

const severity = ACTIVE_RULES.severidad
const plural = (value: number, one: string, many: string) => `${formatNumber(value)} ${value === 1 ? one : many}`

const FACTORS: readonly { key: SeverityFactor; name: string; valueText: (value: number) => string }[] = [
  {
    key: 'monto_actualizado_ars', name: 'Importe: deuda pendiente del caso',
    valueText: value => value === 0 ? 'Sin importe' : value < 1 ? 'Más de $ 0' : `Desde ${formatCurrency(value)}`,
  },
  { key: 'dias_atraso_maximo', name: 'Atraso máximo', valueText: value => value === 0 ? 'Sin atraso' : `Desde ${plural(value, 'día', 'días')}` },
  { key: 'cantidad_vencidas', name: 'Cantidad de obligaciones vencidas', valueText: value => value === 0 ? 'Ninguna' : `Desde ${plural(value, 'obligación', 'obligaciones')}` },
]

export const SCORE_FACTORS = FACTORS.map(factor => ({ ...factor, maximum: severity.factores[factor.key].peso_maximo }))

const BAND_NAMES: Readonly<Record<string, string>> = { ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja' }

/** Bandas del puntaje, de la más alta a la más baja: «desde 70», «de 40 a 69», «menos de 40». */
export function scoreBands() {
  const ordered = [...severity.bandas].sort((left, right) => right.desde - left.desde)
  return ordered.map((band, index) => {
    const upper = index === 0 ? severity.escala[1] : ordered[index - 1].desde - 1
    const range = band.desde === 0 ? `De 0 a ${upper} (menos de ${ordered[index - 1]?.desde ?? upper + 1})` : `De ${band.desde} a ${upper}`
    return { code: band.codigo, name: BAND_NAMES[band.codigo] ?? band.codigo, range }
  })
}

export function ScoreFactorTables() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {SCORE_FACTORS.map(factor => (
        <div key={factor.key} data-score-factor={factor.key}>
          <p className="mb-1 font-medium text-[#163a63]">{factor.name} (hasta {factor.maximum} puntos)</p>
          <Table>
            <TableHeader><TableRow><TableHead>Valor</TableHead><TableHead>Puntos</TableHead></TableRow></TableHeader>
            <TableBody>
              {severity.factores[factor.key].bandas.map(band => (
                <TableRow key={band.desde}><TableCell>{factor.valueText(band.desde)}</TableCell><TableCell>{band.puntos}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  )
}

export function ScoreBandTable() {
  return (
    <Table data-score-bands>
      <TableHeader><TableRow><TableHead>Banda</TableHead><TableHead>Puntaje</TableHead></TableRow></TableHeader>
      <TableBody>
        {scoreBands().map(band => <TableRow key={band.code}><TableCell>{band.name}</TableCell><TableCell>{band.range}</TableCell></TableRow>)}
      </TableBody>
    </Table>
  )
}

export function IntensityTable() {
  const scale = ACTIVE_RULES.escala_intensidad
  return (
    <Table data-intensity>
      <TableHeader><TableRow><TableHead>Intensidad</TableHead><TableHead>Qué significa</TableHead><TableHead>Quién la decide</TableHead></TableRow></TableHeader>
      <TableBody>
        {scale.niveles.map(level => (
          <TableRow key={level.nivel}>
            <TableCell>{level.nivel}</TableCell>
            <TableCell>{level.descripcion}</TableCell>
            <TableCell>
              {level.nivel >= scale.intensa_desde
                ? 'Solo una persona puede proponerla; queda pendiente hasta que otra persona con rol ADMIN la apruebe.'
                : level.nivel <= scale.maximo_automatico ? 'La puede recomendar el sistema; la decisión registrada queda completa.' : 'Una persona.'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
