import { createElement, type ComponentProps, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDebtorDetailData, loadCaseReviewScreen, loadRecordedDecisions, loadViewerContext } = vi.hoisted(() => ({
  getDebtorDetailData: vi.fn(), loadCaseReviewScreen: vi.fn(), loadRecordedDecisions: vi.fn(), loadViewerContext: vi.fn(),
}))
vi.mock('@/lib/equitas-data', () => ({ getDebtorDetailData }))
vi.mock('@/lib/server/case-review-screen', () => ({ loadCaseReviewScreen }))
vi.mock('@/lib/server/recorded-decisions', () => ({ loadRecordedDecisions }))
vi.mock('@/lib/server/viewer-context', () => ({ loadViewerContext }))
// Esta suite comprueba el marcado; la auditoria real se verifica en local-audit.
vi.mock('@/lib/server/audit', () => ({ auditCaseOpen: vi.fn() }))
vi.mock('@/app/debtors/[debtorId]/actions', () => ({ recordCaseDecision: vi.fn(), approveCaseDecision: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => '/debtors/99', notFound: () => { throw new Error('notFound') } }))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))

import DebtorDetailPage from '@/app/debtors/[debtorId]/page'
import { OWN_PROPOSAL_MESSAGE, PARTICIPATED_MESSAGE, READ_ONLY_MESSAGE } from '@/components/review/review-panel'
import { Tabs, TabsContent, TabsTrigger } from '@/components/ui/tabs'
import { caseReviewFailure } from '@/lib/domain/case-review-contract'
import type { CaseReviewScreen } from '@/lib/domain/case-review-history'
import { buildDebtorDetail } from '@/tests/helpers/equitas-fixtures'
import {
  ADMIN, CHECKLIST, decisionsWith, evaluatedDecision, EXPLANATION, historyEntry as entry, markupOf, nodesOfType, panelOf, PROPOSAL, readyScreen as screen, SNAPSHOT, textOf, USER,
} from '@/tests/helpers/case-page'

async function open(review: CaseReviewScreen, detail = buildDebtorDetail(), search?: { tab?: string }) {
  loadCaseReviewScreen.mockResolvedValue(review)
  getDebtorDetailData.mockResolvedValue({ detail, warnings: [] })
  const page = await DebtorDetailPage({ params: Promise.resolve({ debtorId: '99' }), searchParams: Promise.resolve(search ?? {}) })
  const { markup, text } = panelOf(page, 'review')
  return { page, markup, text, whole: textOf(markupOf(page)) }
}

const answered = (decision: 'APRUEBA' | 'OBJETA', patch: { mine?: boolean; approverRole?: string } = {}) => ({
  ...PROPOSAL, status: decision === 'APRUEBA' ? 'APROBADA' as const : 'OBJETADA' as const, currentApprovalId: '11',
  approvals: [{ id: '11', decision, reasonCode: decision === 'OBJETA' ? 'LISTA_DE_CONTROL_INSUFICIENTE' : null, approverRole: patch.approverRole ?? 'ADMIN', createdAt: '2026-11-03T15:00:00+00:00', isCurrent: true, mine: patch.mine ?? false }],
})

beforeEach(() => {
  vi.clearAllMocks()
  loadRecordedDecisions.mockResolvedValue(decisionsWith())
  loadViewerContext.mockResolvedValue(null)
})

describe('pestañas de la ficha', () => {
  it('son cuatro, con nombres en español', async () => {
    const { page } = await open(screen())
    const triggers = nodesOfType(page, TabsTrigger)
    expect(triggers.map(node => node.props.value)).toEqual(['summary', 'debts', 'people', 'review'])
    expect(triggers.map(node => node.props.children)).toEqual(['Resumen', 'Obligaciones', 'Personas y contactos', 'Decisión'])
  })

  it('por defecto abre Resumen; ?tab=revision (alias de otras pantallas) abre Decisión', async () => {
    const tab = async (value?: string) => nodesOfType((await open(screen(), undefined, value === undefined ? undefined : { tab: value })).page, Tabs)[0].props.defaultValue
    expect(await tab()).toBe('summary')
    expect(await tab('revision')).toBe('review')
    expect(await tab('decision')).toBe('review')
    expect(await tab('obligaciones')).toBe('debts')
    expect(await tab('otra')).toBe('summary')
  })

  it('funciona sin searchParams, como las llamadas existentes', async () => {
    loadCaseReviewScreen.mockResolvedValue(screen())
    getDebtorDetailData.mockResolvedValue({ detail: buildDebtorDetail(), warnings: [] })
    await expect(DebtorDetailPage({ params: Promise.resolve({ debtorId: '99' }) })).resolves.toBeTruthy()
  })

  it('un caso inexistente es 404 y no consulta la revisión', async () => {
    getDebtorDetailData.mockResolvedValue({ detail: null, warnings: [] })
    await expect(DebtorDetailPage({ params: Promise.resolve({ debtorId: '99' }), searchParams: Promise.resolve({}) })).rejects.toThrow('notFound')
    expect(loadCaseReviewScreen).not.toHaveBeenCalled()
  })

  it('la pestaña Decisión conserva lo escrito al mirar otra', async () => {
    const { page } = await open(screen())
    expect(nodesOfType(page, TabsContent).find(node => node.props.value === 'review')?.props).toMatchObject({ keepMounted: true })
  })

  it('no quedan pestañas ni textos retirados', async () => {
    const { whole } = await open(screen())
    for (const removed of ['Índice heredado', 'Perfil / Severidad', 'Ejemplo de lectura operativa', 'supervisor', 'Supervisor', 'Operador']) {
      expect(whole).not.toContain(removed)
    }
  })
})

describe('recomendación automática a revisar', () => {
  it('el orden es recomendación, decisión e historial', async () => {
    const { text } = await open(screen())
    const positions = ['Recomendación automática a revisar', 'Tu decisión', 'Historial de decisiones'].map(title => text.indexOf(title))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('trae la acción con su intensidad, la regla aplicada y la cartera', async () => {
    const { text } = await open(screen())
    const suggestion = text.slice(text.indexOf('Recomendación automática a revisar'), text.indexOf('Tu decisión'))
    expect(suggestion).toContain('Contacto y plan (intensidad 2)')
    expect(suggestion).toContain(EXPLANATION.frase_contrastiva)
    expect(suggestion).toContain('Cartera al 30/10/2026 · reglas 1.1.0')
  })

  it('si requiere revisión humana lo dice', async () => {
    const { text } = await open(screen({ snapshot: { ok: true, snapshot: { ...SNAPSHOT, explanation: { ...EXPLANATION, revision: { requiere_revision_humana: true, motivos: ['SEVERIDAD_PARCIAL'] } } } } }))
    expect(text).toContain('Requiere revisión caso por caso')
  })

  it('si la del encabezado se calculó con otra fecha y difiere, la página lo avisa', async () => {
    const detail = buildDebtorDetail()
    detail.debtor.decision = evaluatedDecision({ codigo: 'SEGUIMIENTO', intensidad: 0 })
    detail.debtor.decisionAsOf = { estado: 'OBSERVADO', valor: '2026-11-02' }
    detail.debtor.decisionAsOfSource = 'FECHA_CALCULO'
    const { whole } = await open(screen(), detail)
    expect(whole).toContain('usa la cartera al 30/10/2026 y no coincide con la del encabezado (Seguimiento)')
  })

  it('si coinciden no avisa; con fecha de cálculo aclara qué usa cada parte', async () => {
    const detail = buildDebtorDetail()
    detail.debtor.decision = evaluatedDecision({ codigo: 'CONTACTO_PERSONAL_Y_PLAN', intensidad: 2 })
    detail.debtor.decisionAsOfSource = 'MANIFIESTO_LOTE'
    expect((await open(screen(), detail)).whole).not.toContain('no coincide')
    detail.debtor.decisionAsOfSource = 'FECHA_CALCULO'
    detail.debtor.decisionAsOf = { estado: 'OBSERVADO', valor: '2026-11-02' }
    expect((await open(screen(), detail)).whole).toContain('El encabezado y el resumen usan la fecha de cálculo del 2/11/2026; la pestaña Decisión usa la cartera al 30/10/2026.')
  })

  it('sin instantánea no afirma que haya una cartera vigente', async () => {
    const detail = buildDebtorDetail()
    detail.debtor.decisionAsOfSource = 'FECHA_CALCULO'
    for (const review of [screen({ snapshot: caseReviewFailure('CUTOFF_NOT_AVAILABLE') }), { kind: 'restricted', message: 'x' } as const]) {
      expect((await open(review, detail)).whole).not.toContain('usa la cartera al')
    }
  })

  it('la fecha de la cartera no cambia con la zona horaria', async () => {
    const zone = process.env.TZ
    try {
      for (const value of ['America/Argentina/Cordoba', 'UTC', 'Asia/Tokyo']) {
        process.env.TZ = value
        expect((await open(screen())).text).toContain('Cartera al 30/10/2026')
      }
    } finally {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
    }
  })
})

describe('qué se ofrece según los permisos', () => {
  const FORM = 'Tu decisión'
  const SUBMIT = 'Registrar decisión'

  it('ADMIN: formulario de decisión, con la regla de intensidad explicada', async () => {
    const { text } = await open(screen())
    expect(text).toContain(FORM)
    expect(text).toContain(SUBMIT)
    expect(text).toContain('Una decisión de intensidad 0 a 2 queda completa al registrarse')
    expect(text).not.toContain(READ_ONLY_MESSAGE)
  })

  it('USER: recomendación e historial, sin formularios, y la explicación de por qué', async () => {
    const { text, markup } = await open(screen({ capabilities: USER, history: { ok: true, entries: [PROPOSAL] } }))
    expect(text).toContain('Recomendación automática a revisar')
    expect(text).toContain('Historial de decisiones')
    expect(text).toContain(READ_ONLY_MESSAGE)
    expect(text).toContain('Espera la aprobación de otra persona con rol ADMIN.')
    expect(text).not.toContain(FORM)
    expect(text).not.toContain('Tu respuesta a la propuesta')
    expect(markup).not.toContain('<form')
  })

  it('rol sin acceso a las decisiones: ni recomendación ni formulario ni historial', async () => {
    const message = 'Tu cuenta puede leer la cartera, pero no las decisiones registradas de los casos.'
    const { text, markup } = await open({ kind: 'restricted', message })
    expect(text).toBe(message)
    expect(markup).not.toContain('<form')
  })

  it('acceso no disponible: mensaje, sin formulario', async () => {
    const { text, markup } = await open({ kind: 'unavailable', message: 'No disponible: no se pudo verificar la sesión.' })
    expect(text).toContain('No disponible: no se pudo verificar la sesión.')
    expect(markup).not.toContain('<form')
  })

  it.each(['CUTOFF_NOT_AVAILABLE', 'SUGGESTION_UNAVAILABLE'] as const)('%s al abrir: aviso y sin formulario', async code => {
    const { text, markup } = await open(screen({ snapshot: caseReviewFailure(code) }))
    expect(text).toContain('Recomendación automática no disponible')
    expect(text).toContain(caseReviewFailure(code).message)
    expect(markup).not.toContain('<form')
  })
})

describe('aprobación por otra persona', () => {
  const approveRadio = (markup: string, value: string) => [...markup.matchAll(/<input\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes(`value="${value}"`))

  it('propuesta ajena pendiente: ofrece aprobar u objetar', async () => {
    const { text, markup } = await open(screen({ history: { ok: true, entries: [PROPOSAL] } }))
    expect(text).toContain('Tu respuesta a la propuesta')
    expect(approveRadio(markup, 'APRUEBA')).not.toContain('disabled')
    expect(text).not.toContain('Cambiar respuesta')
  })

  it('propuesta propia: no ofrece aprobar y explica por qué', async () => {
    const { text, markup } = await open(screen({ capabilities: { ...ADMIN, canRecord: false }, history: { ok: true, entries: [{ ...PROPOSAL, mine: true, participated: true }] } }))
    expect(text).toContain(OWN_PROPOSAL_MESSAGE)
    expect(text).toContain('Registrada por vos')
    expect(text).not.toContain('Tu respuesta a la propuesta')
    expect(markup).not.toContain('<form')
  })

  it('quien registró una versión anterior de la cadena tampoco puede aprobarla', async () => {
    const { text, markup } = await open(screen({ capabilities: { ...ADMIN, canRecord: false }, history: { ok: true, entries: [{ ...PROPOSAL, mine: false, participated: true }] } }))
    expect(text).toContain(PARTICIPATED_MESSAGE)
    expect(markup).not.toContain('<form')
  })

  it('con una carga en curso, Objetar sigue disponible y Aprobar queda deshabilitado', async () => {
    const { text, markup } = await open(screen({ snapshot: caseReviewFailure('CUTOFF_NOT_AVAILABLE'), history: { ok: true, entries: [PROPOSAL] } }))
    expect(text).toContain('Tu respuesta a la propuesta')
    expect(text).toContain('Hoy no hay una cartera vigente')
    expect(approveRadio(markup, 'APRUEBA')).toContain('disabled')
    expect(approveRadio(markup, 'OBJETA')).toBeTruthy()
    expect(approveRadio(markup, 'OBJETA')).not.toContain('disabled')
  })

  it('propuesta sobre datos anteriores: solo objetar, y explica por qué', async () => {
    const { text, markup } = await open(screen({ history: { ok: true, entries: [{ ...PROPOSAL, asOf: '2026-09-30', basisChanged: true }] } }))
    expect(text).toContain('Registrada sobre datos anteriores: se registró con la cartera al 30/9/2026 y la vigente es al 30/10/2026')
    expect(text).toContain('Ya no se puede aprobar. Objetar sigue disponible.')
    expect(approveRadio(markup, 'APRUEBA')).toContain('disabled')
    expect(approveRadio(markup, 'OBJETA')).not.toContain('disabled')
  })

  it('una propuesta reemplazada o de intensidad menor no se responde', async () => {
    expect((await open(screen({ history: { ok: true, entries: [{ ...PROPOSAL, isCurrent: false }] } }))).text).not.toContain('Tu respuesta a la propuesta')
    expect((await open(screen({ history: { ok: true, entries: [entry()] } }))).text).not.toContain('Tu respuesta a la propuesta')
  })

  it('ya respondida: la respuesta queda en pasado y el formulario detrás de «Cambiar respuesta»', async () => {
    const { text, markup } = await open(screen({ history: { ok: true, entries: [answered('OBJETA')] } }))
    expect(text).toContain('Propuesta objetada')
    expect(text).toContain('Objetada por otra persona (Administrador) el 3/11/2026, 12:00; motivo: La lista de control no alcanza')
    expect(markup).toMatch(/<details[^>]*><summary[^>]*>\s*Cambiar respuesta\s*<\/summary>/)
    expect(text).toContain('Reemplaza la respuesta vigente')
    expect(text.indexOf('Cambiar respuesta')).toBeLessThan(text.indexOf('Tu respuesta a la propuesta'))
  })
})

describe('historial', () => {
  it('sin decisiones lo dice; una lectura fallida no es "sin decisiones"', async () => {
    expect((await open(screen())).text).toContain('Todavía no hay decisiones registradas')
    const failed = await open(screen({ history: { ok: false, message: 'No se pudo leer el historial de decisiones. Esto no significa que no haya decisiones.' } }))
    expect(failed.text).toContain('No se pudo leer el historial de decisiones')
    expect(failed.text).not.toContain('Todavía no hay decisiones')
  })

  it('muestra quién (por identidad y rol), cuándo, decisión, motivo, cartera, reglas y estado', async () => {
    const { text } = await open(screen({ history: { ok: true, entries: [entry()] } }))
    const history = text.slice(text.indexOf('Historial de decisiones'))
    // 01:30 UTC del 2/11 es 22:30 del 1/11 en Córdoba.
    expect(history).toContain('Registrada por otra persona (Administrador) el 1/11/2026, 22:30')
    expect(history).toContain('Recomendación rechazada')
    expect(history).toContain('Datos del caso incompletos o incorrectos')
    expect(history).toContain('Cartera al 30/10/2026 · reglas 1.1.0')
    expect(history).toContain('Decisión registrada')
  })

  it('un rol histórico se muestra como rol anterior', async () => {
    const { text } = await open(screen({ history: { ok: true, entries: [entry({ reviewerRole: 'operador', mine: true })] } }))
    expect(text).toContain('Registrada por vos (operador (rol anterior))')
  })

  it('una decisión reemplazada se conserva y se rotula', async () => {
    expect((await open(screen({ history: { ok: true, entries: [entry({ isCurrent: false })] } }))).text).toContain('Reemplazada por una decisión posterior')
  })

  it('≥3 pendiente: «Propuesta pendiente de aprobación», nunca aprobada, con su lista de control', async () => {
    const { text } = await open(screen({ capabilities: USER, history: { ok: true, entries: [PROPOSAL] } }))
    const history = text.slice(text.indexOf('Historial de decisiones'))
    expect(history).toContain('Propuesta pendiente de aprobación')
    expect(history).not.toContain('Aprobada')
    expect(history).toContain('Intimación administrativa formal')
    expect(history).toContain('Situación del hogar: no disponible')
    expect(history).toContain('Estado jurídico y posible prescripción verificados')
  })

  it('aprobada: en pasado, por identidad y rol', async () => {
    const { text } = await open(screen({ capabilities: USER, history: { ok: true, entries: [answered('APRUEBA', { mine: true })] } }))
    expect(text).toContain('Propuesta aprobada')
    expect(text).toContain('Aprobada por vos (Administrador) el 3/11/2026, 12:00')
  })

  it('si los datos cambiaron desde la decisión, avisa', async () => {
    const { text } = await open(screen({ history: { ok: true, entries: [{ ...entry(), basisChanged: true }] } }))
    expect(text).toContain('Los datos del caso cambiaron desde esta decisión')
  })

  it('el texto libre se escapa y se muestra literal', async () => {
    const { markup, text } = await open(screen({ history: { ok: true, entries: [entry({ reasonText: { state: 'VISIBLE', text: '<img src=x onerror=alert(1)>' } })] } }))
    expect(markup).not.toContain('<img src=x')
    expect(text).toContain('<img src=x onerror=alert(1)>')
  })

  it('un código fuera de la lista provisional se muestra, sin ocultarse', async () => {
    expect((await open(screen({ history: { ok: true, entries: [entry({ reasonCode: 'MOTIVO_SINTETICO' })] } }))).text).toContain('MOTIVO_SINTETICO')
  })

  it('texto oculto o no disponible: lo dice sin afirmar que exista', async () => {
    const hidden = await open(screen({ capabilities: USER, history: { ok: true, entries: [entry({ reasonText: { state: 'HIDDEN' } })] } }))
    expect(hidden.text).toContain('El detalle escrito, si lo hay, solo lo ven las cuentas con rol ADMIN')
    const unavailable = await open(screen({ history: { ok: true, entries: [entry({ reasonText: { state: 'UNAVAILABLE' } })] } }))
    expect(unavailable.text).toContain('Detalle no disponible')
  })
})

describe('accesibilidad del marcado', () => {
  const controls = (markup: string) => [...markup.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map(match => match[0])
  const attribute = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]

  it('cada lista, texto y casilla tiene un nombre, y cada referencia existe', async () => {
    for (const review of [screen(), screen({ history: { ok: true, entries: [PROPOSAL] } }), screen({ history: { ok: true, entries: [answered('APRUEBA')] } })]) {
      const { markup } = await open(review)
      expect(controls(markup).length).toBeGreaterThan(0)
      for (const tag of controls(markup)) {
        const id = attribute(tag, 'id')
        const named = (id && markup.includes(`for="${id}"`)) || attribute(tag, 'aria-label') || /<label[^>]*>\s*<input/.test(markup)
        expect(named, tag).toBeTruthy()
      }
      for (const [, ids] of markup.matchAll(/aria-(?:describedby|labelledby)="([^"]*)"/g)) {
        for (const id of ids.split(' ')) expect(markup, id).toContain(`id="${id}"`)
      }
    }
  })

  it('los grupos de opciones tienen leyenda y rol de grupo de radio', async () => {
    const { markup } = await open(screen())
    expect(markup).toMatch(/<fieldset[^>]*role="radiogroup"[^>]*aria-labelledby="rv-decision-legend"/)
    expect(markup).toMatch(/<legend id="rv-decision-legend"/)
    expect(markup).toContain('method="post"')
    expect(markup).toContain('noValidate')
  })

  it('la lista de control de la propuesta se lee en el historial', async () => {
    const { text } = await open(screen({ history: { ok: true, entries: [{ ...PROPOSAL, checklist: CHECKLIST }] } }))
    expect(text).toContain('Canal válido')
  })
})

describe('componente de pestañas', () => {
  it('declara roles y relaciona cada pestaña con su panel', () => {
    const markup = markupOf(createElement(Tabs, { defaultValue: 'b' } as ComponentProps<typeof Tabs>,
      createElement(TabsTrigger, { value: 'a' }, 'A'),
      createElement(TabsTrigger, { value: 'b' }, 'B'),
      createElement(TabsContent, { value: 'a' }, 'panel a'),
      createElement(TabsContent, { value: 'b' }, 'panel b'),
    ))
    expect(markup).toMatch(/<button[^>]*role="tab"[^>]*aria-selected="false"[^>]*tabindex="-1"/i)
    expect(markup).toMatch(/<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*tabindex="0"/i)
    const tabId = /aria-selected="true"[^>]*id="([^"]+)"/.exec(markup)?.[1] ?? /id="([^"]+)"[^>]*aria-selected="true"/.exec(markup)?.[1]
    const panel = /<div[^>]*role="tabpanel"[^>]*>/.exec(markup)?.[0] ?? ''
    expect(panel).toContain(`aria-labelledby="${tabId}"`)
    expect(markup).toContain('panel b')
    expect(markup).not.toContain('panel a')
  })

  it('un panel que conserva su estado queda oculto, no se desmonta', () => {
    const markup = markupOf(createElement(Tabs, { defaultValue: 'b' } as ComponentProps<typeof Tabs>,
      createElement(TabsContent, { value: 'a', keepMounted: true }, 'panel a'),
      createElement(TabsContent, { value: 'b', keepMounted: true }, 'panel b'),
    ))
    expect(markup).toMatch(/<div[^>]*hidden=""[^>]*>panel a/)
    expect(markup).toMatch(/<div(?![^>]*hidden)[^>]*>panel b/)
  })
})
