import { describe, expect, it } from 'vitest'

import {
  isStale,
  PENDING_LABELS,
  PENDING_ORDER,
  pendingKind,
  RECORDED_STATUS_LABELS,
  recordedStatus,
  STALE_LABEL,
  staleExplanation,
  type PendingKind,
  type RecordedStatus,
} from '@/lib/domain/recorded-decision'
import { recordedDecision } from '@/tests/helpers/viewer-fixtures'

// Noche 7. Decisión registrada fuera de la pestaña de revisión: estado, «sobre datos anteriores» y qué
// espera cada caso de quien mira (Pendientes). Oráculo escrito a mano, combinación por combinación.

const day = (value: string) => value.split('-').reverse().join('/')

describe('recordedStatus', () => {
  it.each([
    [null, null, 'REGISTRADA'], [0, null, 'REGISTRADA'], [2, 'APRUEBA', 'REGISTRADA'], [2, 'OBJETA', 'REGISTRADA'],
    [3, null, 'PENDIENTE_APROBACION'], [3, 'APRUEBA', 'APROBADA'], [4, 'OBJETA', 'OBJETADA'], [4, null, 'PENDIENTE_APROBACION'],
  ] as const)('intensidad %s con respuesta %s → %s', (intensity, approval, status) => {
    expect(recordedStatus(intensity, approval)).toBe(status)
  })

  it('cada estado tiene su rótulo, sin nombrar roles anteriores', () => {
    expect(Object.keys(RECORDED_STATUS_LABELS).sort()).toEqual(['APROBADA', 'OBJETADA', 'PENDIENTE_APROBACION', 'REGISTRADA'])
    expect(Object.values(RECORDED_STATUS_LABELS).join(' ')).not.toMatch(/supervisor|operador/i)
  })
})

describe('sobre datos anteriores', () => {
  const decision = { asOf: '2026-09-30', rulesVersion: '1.1.0' }

  it.each([
    ['misma cartera y reglas', { asOf: '2026-09-30', rulesVersion: '1.1.0' }, false],
    ['otra fecha de cartera', { asOf: '2026-10-31', rulesVersion: '1.1.0' }, true],
    ['otras reglas', { asOf: '2026-09-30', rulesVersion: '1.2.0' }, true],
    ['sin cartera vigente', { asOf: null, rulesVersion: '1.1.0' }, true],
  ] as const)('%s → %s', (_name, current, stale) => {
    expect(isStale(decision, current)).toBe(stale)
  })

  it('explica cada motivo con fechas legibles', () => {
    expect(staleExplanation(decision, { asOf: '2026-10-31', rulesVersion: '1.1.0' }, day))
      .toBe(`${STALE_LABEL}: se registró con la cartera al 30/09/2026 y la vigente es al 31/10/2026. Conviene revisar el caso de nuevo.`)
    expect(staleExplanation(decision, { asOf: '2026-09-30', rulesVersion: '1.2.0' }, day))
      .toBe(`${STALE_LABEL}: se registró con las reglas 1.1.0 y las vigentes son 1.2.0. Conviene revisar el caso de nuevo.`)
    expect(staleExplanation(decision, { asOf: '2026-10-31', rulesVersion: '1.2.0' }, day))
      .toBe(`${STALE_LABEL}: se registró con la cartera al 30/09/2026 y la vigente es al 31/10/2026; se registró con las reglas 1.1.0 y las vigentes son 1.2.0. Conviene revisar el caso de nuevo.`)
    expect(staleExplanation(decision, { asOf: null, rulesVersion: '1.1.0' }, day))
      .toBe(`${STALE_LABEL}: hoy no hay una cartera vigente. Conviene revisar el caso de nuevo.`)
  })

  it('el rótulo es el acordado', () => {
    expect(STALE_LABEL).toBe('Registrada sobre datos anteriores')
  })
})

describe('pendingKind', () => {
  const ADMIN = { canRecord: true, canApprove: true }
  const USER = { canRecord: false, canApprove: false }
  type Who = 'propia' | 'reemplazada por otra' | 'ajena'
  const who: Record<Who, { mine: boolean; participated: boolean }> = {
    propia: { mine: true, participated: true },
    // Quien mira registró una versión anterior y otra persona la reemplazó.
    'reemplazada por otra': { mine: false, participated: true },
    ajena: { mine: false, participated: false },
  }
  // [estado, quién, sobre datos anteriores, esperado para ADMIN, esperado para USER]
  const ORACLE: [RecordedStatus, Who, boolean, PendingKind | null, PendingKind | null][] = [
    ['PENDIENTE_APROBACION', 'propia', false, 'WAITING_OTHER', null],
    ['PENDIENTE_APROBACION', 'propia', true, 'WAITING_OTHER', null],
    ['PENDIENTE_APROBACION', 'reemplazada por otra', false, 'WAITING_OTHER', null],
    ['PENDIENTE_APROBACION', 'reemplazada por otra', true, 'WAITING_OTHER', null],
    ['PENDIENTE_APROBACION', 'ajena', false, 'APPROVE', null],
    ['PENDIENTE_APROBACION', 'ajena', true, 'OBJECT_ONLY', null],
    ['REGISTRADA', 'propia', false, null, null],
    ['REGISTRADA', 'propia', true, 'REVIEW_AGAIN', null],
    ['REGISTRADA', 'reemplazada por otra', true, null, null],
    ['REGISTRADA', 'ajena', true, null, null],
    ['APROBADA', 'propia', false, null, null],
    ['APROBADA', 'propia', true, 'REVIEW_AGAIN', null],
    ['APROBADA', 'reemplazada por otra', true, null, null],
    ['APROBADA', 'ajena', false, null, null],
    ['OBJETADA', 'propia', false, 'OBJECTED', null],
    ['OBJETADA', 'propia', true, 'OBJECTED', null],
    ['OBJETADA', 'reemplazada por otra', false, null, null],
    ['OBJETADA', 'ajena', false, null, null],
    ['OBJETADA', 'ajena', true, null, null],
  ]

  it.each(ORACLE)('%s, %s, stale=%s → ADMIN %s, USER %s', (status, owner, stale, admin, user) => {
    const decision = recordedDecision('99', { status, stale, ...who[owner], decidedIntensity: status === 'REGISTRADA' ? 1 : 3 })
    expect(pendingKind(decision, ADMIN)).toBe(admin)
    expect(pendingKind(decision, USER)).toBe(user)
  })

  it('A registra y B reemplaza: a A no se le ofrece aprobar la versión de B', () => {
    const forA = recordedDecision('99', { status: 'PENDIENTE_APROBACION', mine: false, participated: true, decidedIntensity: 3 })
    expect(pendingKind(forA, ADMIN)).toBe('WAITING_OTHER')
    expect(pendingKind(forA, ADMIN)).not.toBe('APPROVE')
  })

  it('las capacidades se miran por separado', () => {
    const foreign = recordedDecision('99', { status: 'PENDIENTE_APROBACION', mine: false, participated: false, decidedIntensity: 3 })
    const own = recordedDecision('99', { status: 'PENDIENTE_APROBACION', mine: true, participated: true, decidedIntensity: 3 })
    expect(pendingKind(foreign, { canRecord: true, canApprove: false })).toBeNull()
    expect(pendingKind(own, { canRecord: true, canApprove: false })).toBe('WAITING_OTHER')
    expect(pendingKind(foreign, { canRecord: false, canApprove: true })).toBe('APPROVE')
    expect(pendingKind(own, { canRecord: false, canApprove: true })).toBeNull()
    expect(pendingKind(recordedDecision('99', { status: 'OBJETADA', decidedIntensity: 3 }), { canRecord: false, canApprove: true })).toBeNull()
  })

  it('cada tipo tiene título, ayuda y lugar en el orden; ninguno nombra roles anteriores', () => {
    expect([...PENDING_ORDER].sort()).toEqual(Object.keys(PENDING_LABELS).sort())
    expect(PENDING_ORDER[0]).toBe('APPROVE')
    expect(PENDING_LABELS.APPROVE.title).toBe('Para aprobar u objetar')
    expect(PENDING_LABELS.WAITING_OTHER.help).toContain('No podés aprobar una propuesta en la que participaste')
    expect(JSON.stringify(PENDING_LABELS)).not.toMatch(/supervisor|operador/i)
  })
})
