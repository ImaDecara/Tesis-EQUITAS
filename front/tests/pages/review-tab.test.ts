import { createElement, Fragment, isValidElement, type ComponentProps, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDebtorDetailData, loadCaseReviewScreen } = vi.hoisted(() => ({ getDebtorDetailData: vi.fn(), loadCaseReviewScreen: vi.fn() }))
vi.mock('@/lib/equitas-data', () => ({ getDebtorDetailData }))
vi.mock('@/lib/server/case-review-screen', () => ({ loadCaseReviewScreen }))
vi.mock('@/app/debtors/[debtorId]/actions', () => ({ recordCaseDecision: vi.fn(), approveCaseDecision: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => '/debtors/99', notFound: () => { throw new Error('notFound') } }))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))

import DebtorDetailPage from '@/app/debtors/[debtorId]/page'
import { Tabs, TabsContent, TabsTrigger } from '@/components/ui/tabs'
import { caseReviewFailure, type CaseReviewSnapshot } from '@/lib/domain/case-review-contract'
import type { CaseReviewHistoryEntry, CaseReviewScreen } from '@/lib/domain/case-review-history'
import { buildDebtorDetail } from '@/tests/helpers/equitas-fixtures'

type NodeProps = { children?: ReactNode; value?: string; defaultValue?: string; keepMounted?: boolean }
function nodesOfType(node: ReactNode, type: unknown): React.ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(child => nodesOfType(child, type))
  if (!isValidElement<NodeProps>(node)) return []
  return [...(node.type === type ? [node] : []), ...nodesOfType(node.props.children, type)]
}
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" }
const markupOf = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node))
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|#x27);/g, entity => ENTITIES[entity]).replace(/\s+/g, ' ').trim()

const EXPLANATION = {
  regla: 'R4', modificador: null, banderas: ['PERIODO_NO_INFORMADO', 'TIPO_PERSONA_DESCONOCIDO'],
  severidad: { valor: 80, banda: 'ALTA', estado: 'COMPLETA', obligaciones_no_evaluables: 0 },
  revision: { requiere_revision_humana: false, motivos: [] },
  factores: [
    { factor: 'monto_actualizado_ars', insumo: 815000, puntos: 40, maximo: 50 },
    { factor: 'dias_atraso_maximo', insumo: 271, puntos: 20, maximo: 30 },
    { factor: 'cantidad_vencidas', insumo: 1, puntos: 5, maximo: 20 },
  ],
  frase_contrastiva: 'Se sugiere contacto personal con ofrecimiento de plan o asistencia y no un recordatorio informativo.',
}
const SNAPSHOT: CaseReviewSnapshot = {
  debtorId: '99', asOf: '2026-10-30', rulesVersion: '1.0.0', inputsHash: 'a'.repeat(64),
  suggestedIntervention: 'CONTACTO_PERSONAL_Y_PLAN', suggestedIntensity: 2, explanation: EXPLANATION, currentReviewId: null,
}
const entry = (patch: Partial<CaseReviewHistoryEntry> = {}): CaseReviewHistoryEntry => ({
  id: '5', decision: 'RECHAZA', suggestedIntervention: 'SEGUIMIENTO', suggestedIntensity: 0, decidedIntervention: null, decidedIntensity: null,
  reasonCode: 'DATOS_INCOMPLETOS', reasonText: { state: 'NONE' }, checklist: {}, reviewerRole: 'operador', createdAt: '2026-11-02T01:30:00+00:00',
  asOf: '2026-10-30', rulesVersion: '1.0.0', isCurrent: true, status: 'REGISTRADA', approvals: [], currentApprovalId: null, basisChanged: false,
  ...patch,
})
const screen = (patch: Partial<Extract<CaseReviewScreen, { kind: 'ready' }>> = {}): CaseReviewScreen => ({
  kind: 'ready', capabilities: { canRecord: true, canApprove: false, canReadReasonText: true },
  snapshot: { ok: true, snapshot: SNAPSHOT }, history: { ok: true, entries: [] }, ...patch,
})
const SUPERVISOR = { canRecord: false, canApprove: true, canReadReasonText: true }
const CONSULTA = { canRecord: false, canApprove: false, canReadReasonText: false }
const PROPOSAL = entry({ decision: 'MODIFICA', decidedIntervention: 'INTIMACION_ADMINISTRATIVA', decidedIntensity: 3, status: 'PENDIENTE_SUPERVISOR', reasonCode: 'CRITERIO_DEL_SERVICIO', checklist: { situacion_hogar: 'NO_DISPONIBLE', estado_juridico_verificado: true, canal_valido: true, alternativa_asistida_ofrecida: true } })

async function open(review: CaseReviewScreen, detail = buildDebtorDetail(), search?: { tab?: string }) {
  loadCaseReviewScreen.mockResolvedValue(review)
  getDebtorDetailData.mockResolvedValue({ detail, warnings: [] })
  const page = await DebtorDetailPage({ params: Promise.resolve({ debtorId: '99' }), searchParams: Promise.resolve(search ?? {}) })
  const panel = nodesOfType(page, TabsContent).find(node => node.props.value === 'review')
  const markup = markupOf(panel?.props.children)
  return { page, markup, text: textOf(markup), whole: textOf(markupOf(page)) }
}

beforeEach(() => vi.clearAllMocks())

describe('la pestaña en la página', () => {
  it('agrega "Revisión" sin quitar las pestañas existentes', async () => {
    const { page } = await open(screen())
    expect(nodesOfType(page, TabsTrigger).map(node => node.props.value)).toEqual(['summary', 'people', 'contacts', 'debts', 'risk', 'recommendation', 'review'])
  })

  it('por defecto abre Resumen; desde una cola abre Revisión', async () => {
    expect(nodesOfType((await open(screen())).page, Tabs)[0].props.defaultValue).toBe('summary')
    expect(nodesOfType((await open(screen(), undefined, { tab: 'revision' })).page, Tabs)[0].props.defaultValue).toBe('review')
    expect(nodesOfType((await open(screen(), undefined, { tab: 'otra' })).page, Tabs)[0].props.defaultValue).toBe('summary')
  })

  it('funciona sin searchParams, como las llamadas existentes', async () => {
    loadCaseReviewScreen.mockResolvedValue(screen())
    getDebtorDetailData.mockResolvedValue({ detail: buildDebtorDetail(), warnings: [] })
    await expect(DebtorDetailPage({ params: Promise.resolve({ debtorId: '99' }) })).resolves.toBeTruthy()
  })

  it('un objeto inexistente no consulta la revisión', async () => {
    getDebtorDetailData.mockResolvedValue({ detail: null, warnings: [] })
    await expect(DebtorDetailPage({ params: Promise.resolve({ debtorId: '99' }), searchParams: Promise.resolve({}) })).rejects.toThrow('notFound')
    expect(loadCaseReviewScreen).not.toHaveBeenCalled()
  })

  it('la pestaña Recomendación apunta a Revisión para decidir', async () => {
    const { page } = await open(screen())
    const panel = nodesOfType(page, TabsContent).find(node => node.props.value === 'recommendation')
    expect(textOf(markupOf(panel?.props.children))).toContain('pestaña Revisión')
  })
})

describe('hechos primero, sugerencia después', () => {
  it('el orden es hechos, sugerencia, decisión e historial', async () => {
    const { text } = await open(screen())
    const positions = ['Hechos del caso', 'Sugerencia del sistema', 'Tu decisión', 'Historial de decisiones'].map(title => text.indexOf(title))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('los hechos traen corte, vulnerabilidad, importes, atraso al corte, banderas y faltantes, antes de nombrar la intervención', async () => {
    const { text } = await open(screen())
    const facts = text.slice(0, text.indexOf('Sugerencia del sistema'))
    expect(facts).toContain('Corte: 30/10/2026')
    expect(facts).toContain('Vulnerabilidad: no informada')
    expect(facts).toMatch(/Monto actualizado al corte\s*\$\s*815\.000/)
    expect(facts).toMatch(/Atraso máximo al corte\s*271 dias/)
    expect(facts).toMatch(/Obligaciones vencidas al corte\s*1/)
    expect(facts).toContain('Período fiscal no informado')
    expect(facts).toContain('Tipo de persona desconocido')
    expect(facts).toMatch(/Obligaciones no evaluables\s*0/)
    expect(facts).toContain('Vencimiento')
    expect(facts).not.toContain('Contacto y plan')
    expect(facts).not.toContain('Se sugiere')
  })

  it('la sugerencia trae explicación, versión e intensidad', async () => {
    const { text } = await open(screen())
    const suggestion = text.slice(text.indexOf('Sugerencia del sistema'), text.indexOf('Tu decisión'))
    expect(suggestion).toContain('Contacto y plan')
    expect(suggestion).toContain('Intensidad 2')
    expect(suggestion).toContain('Reglas v1.0.0')
    expect(suggestion).toContain('Corte: 30/10/2026')
    expect(suggestion).toContain(EXPLANATION.frase_contrastiva)
    expect(suggestion).toMatch(/Severidad del objeto \(v1\)\s*80 puntos de 0 a 100/)
    expect(suggestion).toMatch(/Monto actualizado\s*40 de 50 puntos/)
  })

  it('una severidad parcial es un mínimo y lo dice; también pide revisión humana', async () => {
    const { text } = await open(screen({ snapshot: { ok: true, snapshot: { ...SNAPSHOT, explanation: { ...EXPLANATION, severidad: { valor: 40, banda: 'MEDIA', estado: 'PARCIAL', obligaciones_no_evaluables: 2 }, revision: { requiere_revision_humana: true, motivos: ['SEVERIDAD_PARCIAL'] } } } } }))
    expect(text).toContain('al menos 40 puntos de 0 a 100')
    expect(text).toMatch(/Obligaciones no evaluables\s*2/)
    expect(text).toContain('Requiere revisión caso por caso')
  })

  it('la sugerencia es la de la instantánea aunque la ficha calcule otra, y la página entera avisa', async () => {
    const detail = buildDebtorDetail()
    detail.debtor.recommendationType = 'Seguimiento'
    detail.debtor.decision = { intervencion: { codigo: 'SEGUIMIENTO', intensidad: 0 } } as never
    detail.debtor.decisionAsOf = { estado: 'OBSERVADO', valor: '2026-11-02' }
    detail.debtor.decisionAsOfSource = 'FECHA_CALCULO'
    const { text, whole } = await open(screen(), detail)
    const suggestion = text.slice(text.indexOf('Sugerencia del sistema'), text.indexOf('Tu decisión'))
    expect(suggestion).toContain('Contacto y plan')
    expect(text).toContain('Las demás pestañas usan la fecha de cálculo del 2/11/2026')
    expect(whole).toContain('La sugerencia a revisar usa el corte publicado del 30/10/2026 y difiere de la recomendación de esta ficha (Seguimiento)')
  })

  it('si coinciden no avisa de una diferencia', async () => {
    const detail = buildDebtorDetail()
    detail.debtor.decision = { intervencion: { codigo: 'CONTACTO_PERSONAL_Y_PLAN', intensidad: 2 } } as never
    const { whole } = await open(screen(), detail)
    expect(whole).not.toContain('difiere de la recomendación')
  })

  describe('valores faltantes', () => {
    const missing = (factores: unknown[], severidad: unknown = EXPLANATION.severidad) =>
      screen({ snapshot: { ok: true, snapshot: { ...SNAPSHOT, explanation: { ...EXPLANATION, severidad, factores } } } })

    it('nunca "No disponible días" ni monedas o puntos sobre un faltante', async () => {
      const { text } = await open(missing(
        [{ factor: 'monto_actualizado_ars', insumo: null, puntos: null, maximo: 50 }, { factor: 'dias_atraso_maximo', insumo: null, puntos: null, maximo: 30 }, { factor: 'cantidad_vencidas', insumo: null, puntos: null, maximo: 20 }],
        { valor: null, banda: 'NO_DISPONIBLE', estado: 'NO_DISPONIBLE', obligaciones_no_evaluables: 1 },
      ))
      expect(text).not.toMatch(/No disponible (?:dias|días|puntos|obligaciones|de \d+)/)
      expect(text).toMatch(/Monto actualizado al corte\s*No disponible/)
      expect(text).toMatch(/Atraso máximo al corte\s*No disponible/)
      expect(text).toMatch(/Severidad del objeto \(v1\)\s*No disponible/)
    })

    it('sin obligaciones vencidas el atraso no aplica, no es cero', async () => {
      const { text } = await open(missing([{ factor: 'dias_atraso_maximo', insumo: 0, puntos: 0, maximo: 30 }, { factor: 'cantidad_vencidas', insumo: 0, puntos: 0, maximo: 20 }]))
      expect(text).toMatch(/Atraso máximo al corte\s*No aplica/)
      expect(text).toMatch(/Obligaciones vencidas al corte\s*0/)
    })

    it('sin banderas lo dice, y sin vencimiento la obligación dice "Sin fecha"', async () => {
      const detail = buildDebtorDetail()
      detail.debts = detail.debts.map(debt => ({ ...debt, dueDate: null }))
      const { text } = await open(screen({ snapshot: { ok: true, snapshot: { ...SNAPSHOT, explanation: { ...EXPLANATION, banderas: [] } } } }), detail)
      expect(text).toContain('Sin banderas')
      expect(text).toContain('Sin fecha')
    })

    it('una lista de deudas ilegible no parece vacía', async () => {
      const detail = buildDebtorDetail()
      detail.debts = []
      loadCaseReviewScreen.mockResolvedValue(screen())
      getDebtorDetailData.mockResolvedValue({ detail, warnings: [{ table: 'debt', message: 'x', needsSelectPolicy: false }] })
      const page = await DebtorDetailPage({ params: Promise.resolve({ debtorId: '99' }), searchParams: Promise.resolve({}) })
      const panel = nodesOfType(page, TabsContent).find(node => node.props.value === 'review')
      expect(textOf(markupOf(panel?.props.children))).toContain('No disponible: no se pudo leer la lista de obligaciones.')
    })
  })

  it('la fecha del corte no cambia con la zona horaria', async () => {
    const zone = process.env.TZ
    try {
      for (const value of ['America/Argentina/Cordoba', 'UTC', 'Asia/Tokyo']) {
        process.env.TZ = value
        expect((await open(screen())).text).toContain('Corte: 30/10/2026')
      }
    } finally {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
    }
  })
})

describe('qué se ofrece según el rol y el estado', () => {
  const FORM = 'Tu decisión'
  const SUBMIT = 'Registrar decisión'

  it('operador: formulario, sin respuesta de supervisor', async () => {
    const { text } = await open(screen({ history: { ok: true, entries: [PROPOSAL] } }))
    expect(text).toContain(FORM)
    expect(text).toContain(SUBMIT)
    expect(text).not.toContain('Respuesta del supervisor')
  })

  it.each([['consulta', CONSULTA], ['supervisor', SUPERVISOR]])('%s: hechos, sugerencia e historial, sin formulario de decisión', async (_, capabilities) => {
    const { text, markup } = await open(screen({ capabilities }))
    expect(text).toContain('Hechos del caso')
    expect(text).toContain('Sugerencia del sistema')
    expect(text).toContain('Historial de decisiones')
    expect(text).not.toContain(FORM)
    expect(text).not.toContain(SUBMIT)
    expect(markup).not.toContain('<form')
  })

  it('rol sin acceso a revisiones: ni hechos ni formulario ni historial', async () => {
    const { text, markup } = await open({ kind: 'restricted', message: 'Tu rol permite leer la cartera, pero no las revisiones de este caso.' })
    expect(text).toBe('Tu rol permite leer la cartera, pero no las revisiones de este caso.')
    expect(markup).not.toContain('<form')
  })

  it('acceso no disponible: mensaje, sin formulario', async () => {
    const { text, markup } = await open({ kind: 'unavailable', message: 'No disponible: no se pudo verificar la sesión.' })
    expect(text).toContain('No disponible: no se pudo verificar la sesión.')
    expect(markup).not.toContain('<form')
  })

  it.each(['CUTOFF_NOT_AVAILABLE', 'SUGGESTION_UNAVAILABLE'] as const)('%s al abrir: aviso, hechos sin cifras al corte y sin formulario', async code => {
    const { text, markup } = await open(screen({ snapshot: caseReviewFailure(code) }))
    expect(text).toContain(caseReviewFailure(code).message)
    expect(text).toContain('Corte: no disponible')
    expect(text).toContain('Vulnerabilidad: no informada')
    expect(text).not.toContain('Monto actualizado al corte')
    expect(text).not.toContain('Sugerencia del sistema')
    expect(markup).not.toContain('<form')
  })

  it('supervisor con una propuesta pendiente: la responde', async () => {
    const { text, markup } = await open(screen({ capabilities: SUPERVISOR, history: { ok: true, entries: [PROPOSAL] } }))
    expect(text).toContain('Respuesta del supervisor')
    expect(markup).toContain('<form')
  })

  it('con una carga en curso, el supervisor conserva Objetar y Aprobar queda deshabilitado', async () => {
    const { text, markup } = await open(screen({ capabilities: SUPERVISOR, snapshot: caseReviewFailure('CUTOFF_NOT_AVAILABLE'), history: { ok: true, entries: [PROPOSAL] } }))
    expect(text).toContain('Respuesta del supervisor')
    const radio = (value: string) => [...markup.matchAll(/<input\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes(`value="${value}"`))
    expect(radio('APRUEBA')).toContain('disabled')
    expect(radio('OBJETA')).toBeTruthy()
    expect(radio('OBJETA')).not.toContain('disabled')
  })

  it('una propuesta reemplazada o de intensidad menor no se responde', async () => {
    const superseded = await open(screen({ capabilities: SUPERVISOR, history: { ok: true, entries: [{ ...PROPOSAL, isCurrent: false }] } }))
    expect(superseded.text).not.toContain('Respuesta del supervisor')
    const low = await open(screen({ capabilities: SUPERVISOR, history: { ok: true, entries: [entry()] } }))
    expect(low.text).not.toContain('Respuesta del supervisor')
  })

  it('ya respondida: permite reemplazar la respuesta y lo dice', async () => {
    const answered = { ...PROPOSAL, status: 'OBJETADA' as const, currentApprovalId: '11', approvals: [{ id: '11', decision: 'OBJETA' as const, reasonCode: 'LISTA_DE_CONTROL_INSUFICIENTE', approverRole: 'supervisor', createdAt: '2026-11-03T15:00:00+00:00', isCurrent: true }] }
    const { text } = await open(screen({ capabilities: SUPERVISOR, history: { ok: true, entries: [answered] } }))
    expect(text).toContain('Reemplaza la respuesta vigente')
    expect(text).toContain('Objetada por un supervisor')
  })
})

describe('historial', () => {
  it('sin decisiones lo dice; una lectura fallida no es "sin decisiones"', async () => {
    expect((await open(screen())).text).toContain('Todavía no hay decisiones registradas')
    const failed = await open(screen({ history: { ok: false, message: 'Historial no disponible: no se pudo leer. Esto no significa que no haya decisiones.' } }))
    expect(failed.text).toContain('Historial no disponible')
    expect(failed.text).not.toContain('Todavía no hay decisiones')
  })

  it('muestra fecha, rol, decisión, motivo, corte, versión y vigencia', async () => {
    const { text } = await open(screen({ history: { ok: true, entries: [entry()] } }))
    const history = text.slice(text.indexOf('Historial de decisiones'))
    // 01:30 UTC del 2/11 es 22:30 del 1/11 en Córdoba.
    expect(history).toContain('1/11/2026, 22:30')
    expect(history).toContain('Operador')
    expect(history).toContain('Rechazar la sugerencia')
    expect(history).toContain('Datos del caso incompletos o incorrectos')
    expect(history).toContain('Corte: 30/10/2026')
    expect(history).toContain('Reglas v1.0.0')
    expect(history).toContain('Vigente')
    expect(history).toContain('Decisión registrada')
  })

  it('una decisión reemplazada se conserva y se rotula', async () => {
    const { text } = await open(screen({ history: { ok: true, entries: [entry({ isCurrent: false })] } }))
    expect(text).toContain('Reemplazada por una decisión posterior')
  })

  it('≥3 pendiente: "Requiere aprobación de un supervisor", nunca aprobada, con su lista de control', async () => {
    const { text } = await open(screen({ history: { ok: true, entries: [PROPOSAL] } }))
    const history = text.slice(text.indexOf('Historial de decisiones'))
    expect(history).toContain('Requiere aprobación de un supervisor')
    expect(history).not.toContain('Aprobada')
    expect(history).toContain('Intimación administrativa formal')
    expect(history).toContain('Situación del hogar: no disponible')
    expect(history).toContain('Estado jurídico y posible prescripción verificados')
  })

  it('aprobada y objetada muestran quién respondió, por rol', async () => {
    const answered = { ...PROPOSAL, status: 'APROBADA' as const, currentApprovalId: '11', approvals: [{ id: '11', decision: 'APRUEBA' as const, reasonCode: null, approverRole: 'supervisor', createdAt: '2026-11-03T15:00:00+00:00', isCurrent: true }] }
    const { text } = await open(screen({ capabilities: CONSULTA, history: { ok: true, entries: [answered] } }))
    expect(text).toContain('Aprobada por un supervisor')
    expect(text).toContain('Supervisor')
    expect(text).toContain('3/11/2026, 12:00')
  })

  it('si los datos cambiaron desde la propuesta, avisa', async () => {
    const { text } = await open(screen({ capabilities: SUPERVISOR, history: { ok: true, entries: [{ ...PROPOSAL, basisChanged: true }] } }))
    expect(text).toContain('Los datos o las reglas cambiaron desde esta decisión')
  })

  it('el texto libre se escapa y se muestra literal', async () => {
    const { markup, text } = await open(screen({ history: { ok: true, entries: [entry({ reasonText: { state: 'VISIBLE', text: '<img src=x onerror=alert(1)>' } })] } }))
    expect(markup).not.toContain('<img src=x')
    expect(text).toContain('<img src=x onerror=alert(1)>')
  })

  it('un código fuera de la lista provisional se muestra, sin ocultarse', async () => {
    const { text } = await open(screen({ history: { ok: true, entries: [entry({ reasonCode: 'MOTIVO_SINTETICO' })] } }))
    expect(text).toContain('MOTIVO_SINTETICO')
  })

  it('texto oculto o no disponible: lo dice sin afirmar que exista', async () => {
    const hidden = await open(screen({ capabilities: CONSULTA, history: { ok: true, entries: [entry({ reasonText: { state: 'HIDDEN' } })] } }))
    expect(hidden.text).toContain('El detalle, si lo hay, solo lo ven quien decide y quien supervisa')
    const unavailable = await open(screen({ history: { ok: true, entries: [entry({ reasonText: { state: 'UNAVAILABLE' } })] } }))
    expect(unavailable.text).toContain('Detalle no disponible')
  })
})

describe('accesibilidad del marcado', () => {
  const controls = (markup: string) => [...markup.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map(match => match[0])
  const attribute = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]

  it('cada lista, texto y casilla tiene un nombre, y cada referencia existe', async () => {
    const answered = screen({ capabilities: SUPERVISOR, history: { ok: true, entries: [PROPOSAL] } })
    for (const review of [screen(), answered]) {
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
})

describe('pestañas', () => {
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

  it('la pestaña Revisión conserva lo escrito al mirar otra', async () => {
    const { page } = await open(screen())
    expect(nodesOfType(page, TabsContent).find(node => node.props.value === 'review')?.props).toMatchObject({ keepMounted: true })
  })
})
