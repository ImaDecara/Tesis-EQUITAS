import { describe, expect, it } from 'vitest'
import golden from '../../../contracts/decision-rules.v1.1.golden.json'
import { evaluateDecisionRulesV1, type DecisionInput } from '@/lib/domain/decision-rules-v1'
import { generateDebtorRecommendation } from '@/lib/services/debtor-recommendation-generator'

// Las expectativas heredadas dependían del perfil y del contacto para sumar
// puntos. Ahora la intervención es la salida de R1–R7/M1 del contrato v1.
describe('ALIGN-010: presentación de las intervenciones v1', () => {
  it.each([
    ['R1', 'Mejorar datos'], ['R2', 'Mejorar datos'], ['R3', 'Revisión jurídica'],
    ['R4', 'Contacto y plan'], ['R5', 'Recordatorio'], ['R6', 'Seguimiento'], ['R7', 'Seguimiento'],
  ])('%s se presenta como %s', (rule, label) => {
    const sample = golden.casos.find(item => item.esperado.intervencion.regla === rule && !item.esperado.intervencion.modificador)!
    const decision = evaluateDecisionRulesV1(sample.entrada as DecisionInput)
    const result = generateDebtorRecommendation(decision)
    expect(result.type).toBe(label)
    expect(result.summary).toBe(label)
    expect(result.reason).toContain(decision.explicacion.frase_contrastiva)
    expect(result.reason).not.toMatch(/deuda exigible|escalamiento|recordatorio formal/)
    if (rule === 'R3') expect(result.reason).toContain('Evaluar con supervisor')
  })

  it.each(golden.casos)('$id conserva la explicación, sin porcentajes ni acciones intensas', sample => {
    const decision = evaluateDecisionRulesV1(sample.entrada as DecisionInput)
    const result = generateDebtorRecommendation(decision)
    expect(result.reason).toContain(decision.explicacion.frase_contrastiva)
    expect(result.reason).not.toContain('%')
    expect(decision.intervencion.intensidad).toBeLessThan(3)
    if (decision.banderas.includes('SIN_CONTACTO_ACTIVO')) {
      expect(result.type).toBe('Mejorar datos')
      expect(decision.mensaje_borrador).toBeNull()
    }
    if (decision.revision.requiere_revision_humana) {
      expect(result.isUrgent).toBe(true)
      expect(result.reason).toContain('Evaluar con supervisor')
    }
  })

  it('una lectura fallida no genera una intervención ni urgencia', () => {
    expect(generateDebtorRecommendation(null)).toMatchObject({ type: 'No disponible', isUrgent: false })
  })
})
