import { describe, expect, it } from 'vitest'

import { operationalSummary } from '@/components/dashboard/operational-summary'

// Resumen operativo del tablero: frases con cifras presentes; sin dato, lo dice y no escribe un cero.
const groups = [{ label: 'Recordatorio', count: 7 }, { label: 'Seguimiento', count: 5 }, { label: 'Revisión jurídica', count: 0 }]

describe('operationalSummary', () => {
  it('con todos los datos: deuda vencida y su proporción, puntaje alto, sin contacto y el grupo más grande', () => {
    expect(operationalSummary({ total: 20, priorityCases: 6, overdueCases: 16, withoutContactCases: 2, groups })).toEqual([
      '16 casos con deuda vencida (80% de la cartera); 6 casos con puntaje alto.',
      '2 casos sin un contacto activo cargado: primero hay que mejorar sus datos.',
      'El grupo de trabajo con más casos es «Recordatorio» (7 casos).',
    ])
  })

  it('sin datos no inventa ceros', () => {
    expect(operationalSummary({ total: null, priorityCases: null, overdueCases: null, withoutContactCases: null, groups: [{ label: 'Recordatorio', count: null }] })).toEqual([
      'No se pudo determinar cuántos casos tienen deuda vencida.',
      'No se pudieron leer los contactos: no se sabe cuántos casos no tienen uno.',
      'No se puede decir qué grupo de trabajo tiene más casos: faltan datos de algún grupo.',
    ])
    expect(operationalSummary({ total: 3, priorityCases: null, overdueCases: 1, withoutContactCases: 0, groups: [{ label: 'Seguimiento', count: 0 }] })).toEqual([
      '1 caso con deuda vencida (33% de la cartera); el puntaje alto no está disponible.',
      'Todos los casos tienen un contacto activo cargado.',
      'No se puede decir qué grupo de trabajo tiene más casos: faltan datos de algún grupo.',
    ])
  })

  it('selección vacía: una sola frase', () => {
    expect(operationalSummary({ total: 0, priorityCases: 0, overdueCases: 0, withoutContactCases: 0, groups })).toEqual(['No hay casos en la selección.'])
  })
})
