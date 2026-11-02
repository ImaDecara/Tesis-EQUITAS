import type { RawRow } from '@/types/equitas-domain'

// ALIGN-028. Cartera sintetica de dos municipios, con filas evaluables (lote "VALIDADO")
// y celdas hostiles. Los marcadores permiten buscar fugas en el texto del CSV.
export const FOREIGN_MARKER = 'AJENO-TENANT-8'
export const PERSONAL_MARKERS = [
  'Persona Sintetica Uno', 'Persona Sintetica Dos', 'SINTETICO-DOC-1', 'SINTETICO-DOC-2',
  'uno@example.test', 'SINTETICO-DOMICILIO', 'SINTETICA-DESCRIPCION',
]
export const FREE_TEXT_MARKER = 'TEXTO-LIBRE-SINTETICO-HOGAR'
export const REVIEWER_MARKER = 777001
export const HOSTILE_IDENTIFIERS = ['=HYPERLINK("http://x.example","y")', '  =1+1', '\t+1+1', '-2+3', '@SUM(A1)']

const debtScope = (tenant: number) => ({ __scope: { tenant } })
const links = (tenant: number) => [{ active: true, debtor: tenant, __debtor: { tenant } }]

const evaluable = { estado_origen: 'VENCIDA', periodo_fiscal: '2026-01' }

function debtor(id: number, tenant: number, identifier: string, type = 6) {
  return { id, tenant, type, identifier, description: `SINTETICA-DESCRIPCION ${id}`, address: 'SINTETICO-DOMICILIO' }
}

function debt(id: number, debtorId: number, tenant: number, amount: unknown, status = 2, dueDate: string | null = '2026-01-10') {
  return { id, debtor: debtorId, current_amount: amount, original_amount: 1, due_date: dueDate, status, ...evaluable, ...debtScope(tenant) }
}

function relation(id: number, debtorId: number, person: number, tenant: number) {
  return { id, debtor: debtorId, person, active: true, priority: 100, role: 'TITULAR', ...debtScope(tenant) }
}

// Siete objetos del municipio 7: con mora y contacto, sin contacto, hostiles, sin obligaciones,
// importe negativo, importe ilegible y uno que solo se ve filtrando por persona.
export function portfolioTables(): Record<string, RawRow[]> {
  return {
    debtor_type: [{ id: 6, value: 'AGUA' }, { id: 7, value: 'INMUEBLE; "tasa"' }],
    debt_status: [{ id: 2, key: 'OVERDUE', value: 'Vencida' }, { id: 3, key: 'PAID', value: 'Pagada' }],
    debtor: [
      debtor(101, 7, 'OBJ-CONTACTO'),
      debtor(102, 7, 'OBJ-SIN-CONTACTO', 7),
      debtor(103, 7, HOSTILE_IDENTIFIERS[0]),
      debtor(104, 7, HOSTILE_IDENTIFIERS[1]),
      debtor(105, 7, HOSTILE_IDENTIFIERS[2]),
      debtor(106, 7, HOSTILE_IDENTIFIERS[3]),
      debtor(107, 7, HOSTILE_IDENTIFIERS[4]),
      debtor(108, 7, 'OBJ-SIN-OBLIGACIONES'),
      debtor(109, 7, 'OBJ-NEGATIVO'),
      debtor(110, 7, 'OBJ-ILEGIBLE'),
      debtor(801, 8, FOREIGN_MARKER),
    ],
    debt: [
      debt(1, 101, 7, 950000.5), debt(2, 101, 7, 1250.25),
      debt(3, 102, 7, 815000),
      debt(4, 103, 7, 120000.75), debt(5, 104, 7, 80000), debt(6, 105, 7, 310000),
      debt(7, 106, 7, 42000), debt(8, 107, 7, 1500),
      debt(9, 109, 7, -50),
      debt(10, 110, 7, 'abc'), debt(11, 110, 7, 300),
      debt(99, 801, 8, 123456789),
    ],
    person: [
      { id: 501, full_name: 'Persona Sintetica Uno', document_number: 'SINTETICO-DOC-1', type: 'FISICA', __links: links(7) },
      { id: 502, full_name: 'Persona Sintetica Dos', document_number: 'SINTETICO-DOC-2', type: 'FISICA', __links: links(7) },
      { id: 599, full_name: `Persona ${FOREIGN_MARKER}`, document_number: FOREIGN_MARKER, type: 'FISICA', __links: links(8) },
    ],
    debtor_person: [
      relation(201, 101, 501, 7), relation(202, 102, 502, 7), relation(203, 103, 501, 7),
      relation(204, 104, 501, 7), relation(205, 105, 501, 7), relation(206, 106, 501, 7),
      relation(207, 107, 501, 7), relation(208, 108, 501, 7), relation(209, 109, 501, 7),
      relation(210, 110, 501, 7), relation(299, 801, 599, 8),
    ],
    debtor_contact: [
      { id: 301, person: 501, value: 'uno@example.test', type: 1, active: true, __person: { __links: links(7) } },
      { id: 399, person: 599, value: `${FOREIGN_MARKER}@example.test`, type: 1, active: true, __person: { __links: links(8) } },
    ],
    debtor_profile: [],
  }
}

// Fecha de corte fija: nunca coincide con el reloj de la prueba.
export const REVIEW_CUTOFF = '2026-09-30'
export const OTHER_CUTOFF = '2026-10-15'

function review(id: number, overrides: RawRow = {}): RawRow {
  return {
    id, tenant: 7, debtor: 101, rules_version: '1.0.0', as_of: REVIEW_CUTOFF,
    suggested_intervention: 'CONTACTO_PERSONAL_Y_PLAN', suggested_intensity: 2,
    decision: 'ACEPTA', decided_intervention: 'CONTACTO_PERSONAL_Y_PLAN', decided_intensity: 2,
    reason_code: null, reviewer_role: 'operador', created_at: `2026-10-0${id % 9 + 1}T15:30:00+00:00`, supersedes: null,
    // El transporte simulado devuelve la fila completa: si el reporte no filtra, se detecta.
    reason_text: FREE_TEXT_MARKER, reviewer: REVIEWER_MARKER, explanation: { texto: FREE_TEXT_MARKER },
    inputs_hash: 'f'.repeat(64), idempotency_key: 'sintetica', checklist: {},
    ...overrides,
  }
}

function approval(id: number, caseReview: number, overrides: RawRow = {}): RawRow {
  return {
    id, tenant: 7, case_review: caseReview, decision: 'APRUEBA', reason_code: null, approver_role: 'supervisor',
    created_at: '2026-10-20T10:00:00+00:00', supersedes: null,
    approver: REVIEWER_MARKER, checklist: {}, idempotency_key: 'sintetica',
    ...overrides,
  }
}

// 1 ACEPTA vigente; 2 MODIFICA reemplazada por 3 RECHAZA; 4 ≥3 pendiente; 5 ≥3 aprobada;
// 6 ≥3 objetada con antecedente; 7 POSPONE de otro corte; 8 DERIVA sin intervencion decidida.
export function reviewTables(): Record<string, RawRow[]> {
  return {
    case_review: [
      review(1),
      review(2, { debtor: 102, decision: 'MODIFICA', decided_intervention: 'RECORDATORIO_INFORMATIVO', decided_intensity: 1, reason_code: 'DATOS_INCOMPLETOS' }),
      review(3, { debtor: 102, decision: 'RECHAZA', decided_intervention: null, decided_intensity: null, reason_code: 'GESTION_EN_CURSO', supersedes: 2 }),
      review(4, { debtor: 103, decision: 'MODIFICA', decided_intervention: 'INTIMACION_ADMINISTRATIVA', decided_intensity: 3, reason_code: 'CRITERIO_DEL_SERVICIO' }),
      review(5, { debtor: 104, decision: 'MODIFICA', decided_intervention: 'INTIMACION_ADMINISTRATIVA', decided_intensity: 3, reason_code: 'CRITERIO_DEL_SERVICIO' }),
      review(6, { debtor: 105, decision: 'MODIFICA', decided_intervention: 'DERIVACION_PROCURACION', decided_intensity: 4, reason_code: '=FORMULA_EN_CODIGO' }),
      review(7, { debtor: 106, decision: 'POSPONE', decided_intervention: null, decided_intensity: null, reason_code: 'ESPERA_DE_INFORMACION', as_of: OTHER_CUTOFF, rules_version: '1.1.0' }),
      review(8, { debtor: 107, decision: 'DERIVA', decided_intervention: null, decided_intensity: null, reason_code: 'CORRESPONDE_A_OTRA_AREA', created_at: '2026-10-25T02:00:00+00:00' }),
      review(9, { tenant: 8, debtor: 801, reviewer_role: FOREIGN_MARKER, reason_code: FOREIGN_MARKER }),
    ],
    case_review_approval: [
      approval(1, 5),
      approval(2, 6, { decision: 'APRUEBA' }),
      approval(3, 6, { decision: 'OBJETA', reason_code: 'ALTERNATIVA_NO_OFRECIDA', supersedes: 2 }),
      approval(9, 9, { tenant: 8, reason_code: FOREIGN_MARKER }),
    ],
  }
}
