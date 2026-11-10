import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

import { LOCAL_API_URL } from '../local-review/config'
import { actionIds, approvals, config, post, READY_CHECKLIST, reviews, sql } from '../local-review/http-support'
import {
  ACCOUNTS, api, approvalBody, AS_OF, batchBody, createdId, DECISION_TABLES, expectCode, expectRejected, INTENSE, INTERVENTION, MISSING_ID, OBJECT, proposalBody,
  publishCutoff, readBuildInfo, readReason, recordApproval, recordBatch, recordReview, reviewBody, rowCounts, sessionCookie as cookie, signIn, signJwt, sqlError, tamperRole, TENANT, TP_OPERATOR, USER,
  withoutWrites, type Account,
} from './support'

// ALIGN-022. Cada `it` es un caso del inventario de database/testing/review_integration.py: el validador rechaza faltantes,
// omitidos y casos ajenos. Un caso rojo es un hallazgo: se documenta y se reporta, no se ajusta para dar verde.
// Noche 7: matriz ADMIN/USER (migracion 20261110100000_admin_user_access). Los nombres de cuenta se conservan: consulta = USER;
// operador, supervisor, importador-real, proponente y los actores inactivos = ADMIN; otro-operador = ADMIN en B y USER en A;
// otro-supervisor = ADMIN en B; la cuenta `importador` sigue con tp_operator. Registrar, aprobar (otra persona), leer el motivo e
// importar requieren ADMIN. Cada caso traducido lo dice con «N7:»; donde la distincion de rol ya no existe se prueba la regla vigente
// y, ademas, que el nombre de rol anterior ya no otorga nada (withHistoricRole).
const tokens = {} as Record<Account, string>
const cutoff = { A: 0, B: 0 }
const base = { review: 0, proposal: 0, approvedProposal: 0, approval: 0, reviewB: 0, proposalB: 0, approvalB: 0, batchA: 0, batchB: 0 }
let initialCounts = ''
let ids: ReturnType<typeof actionIds>

const CLIENTS: ReadonlyArray<readonly [string, () => string | undefined]> = [
  ['anon', () => undefined],
  ['operador', () => tokens.operador],
  ['supervisor', () => tokens.supervisor],
  ['service_role', () => signJwt({ role: 'service_role' })],
]

const forgedRow = (overrides: Record<string, unknown> = {}) => ({
  tenant: TENANT.A, debtor: OBJECT.A, rules_version: '1.0.0', as_of: AS_OF, inputs_hash: 'a'.repeat(64), suggested_intervention: INTERVENTION, suggested_intensity: 1,
  explanation: { factores: [] }, decision: 'ACEPTA', decided_intervention: INTERVENTION, decided_intensity: 1, reviewer: USER.operador, reviewer_role: 'ADMIN',
  idempotency_key: randomUUID(), ...overrides,
})

const forgedApproval = (overrides: Record<string, unknown> = {}) => ({
  tenant: TENANT.A, case_review: base.proposal, decision: 'APRUEBA', checklist: READY_CHECKLIST, approver: USER.supervisor, approver_role: 'ADMIN', idempotency_key: randomUUID(), ...overrides,
})

const forgedBatch = (overrides: Record<string, unknown> = {}) => ({
  tenant: TENANT.A, source: 'ETL_CLI', file_hashes: { cabecera: 'b'.repeat(64) }, as_of: AS_OF, rules_version: '1.0.0', status: 'PUBLICADO', created_by: USER.sistema, created_by_role: 'importador_sistema',
  idempotency_key: randomUUID(), ...overrides,
})

// Sin `return=representation`: RETURNING pide reason_text, que nadie lee, y daria 42501 aunque el INSERT o el UPDATE tuvieran privilegio.
const insertRow = (table: string, token: string | undefined, body: unknown) => api('POST', `/rest/v1/${table}`, { token, body })
const validRow = { case_review: () => forgedRow(), case_review_approval: () => forgedApproval(), import_batch: () => forgedBatch() }

async function insertDenied(token: string, row: Record<string, unknown>, marker: string) {
  await withoutWrites(async () => {
    const reply = await insertRow('case_review', token, row)
    expectCode(reply, '42501', 'insercion directa')
    expect(String(reply.message), 'el rechazo es por privilegio, no por una regla de datos').toContain('permission denied')
  })
  expect(sql(`select count(*) from public.case_review where ${marker}`), 'la fila falsificada no existe').toBe('0')
}

const blind = (debtorId: number, overrides: Record<string, unknown> = {}) => ({
  debtorId: String(debtorId), decision: 'ACEPTA', expected: { asOf: AS_OF, rulesVersion: '1.0.0', inputsHash: 'a'.repeat(64) }, ...overrides,
})

async function serverShown(debtor: number, cookie: string) {
  const reply = await post(ids.record, blind(debtor), { cookie })
  expect(reply.result, 'la accion responde con lo vigente').toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED' })
  const current = reply.result!.current as { asOf: string; rulesVersion: string; inputsHash: string; suggestedIntervention: string; suggestedIntensity: number }
  return { current, expected: { asOf: current.asOf, rulesVersion: current.rulesVersion, inputsHash: current.inputsHash } }
}

// N7: la membresia del proponente (920015) pasa un momento a un rol con nombre anterior; se restituye ADMIN al terminar.
async function withHistoricRole(name: 'consulta' | 'operador' | 'supervisor' | 'importador', check: () => Promise<void>) {
  sql(`insert into public.role(id, name, description) select (select max(id) + 1 from public.role), '${name}', 'N7: nombre anterior, no reconocido' where not exists(select 1 from public.role where name = '${name}')`)
  sql(`update public.tenant_user set role = (select id from public.role where name = '${name}') where id = 920015`)
  try {
    await check()
  } finally {
    sql('update public.tenant_user set role = 920002 where id = 920015')
  }
}

beforeAll(async () => {
  initialCounts = rowCounts()
  ids = actionIds()
  for (const label of ACCOUNTS) tokens[label] = await signIn(label)
  cutoff.A = await publishCutoff(TENANT.A)
  cutoff.B = await publishCutoff(TENANT.B)
  base.batchA = cutoff.A
  base.batchB = cutoff.B
  base.review = createdId(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
  base.proposal = createdId(await recordReview(proposalBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
  base.approvedProposal = createdId(await recordReview(proposalBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
  base.approval = createdId(await recordApproval(approvalBody(USER.supervisor, TENANT.A, base.approvedProposal, cutoff.A)), 'approval_id')
  base.reviewB = createdId(await recordReview(reviewBody(USER.otroOperador, TENANT.B, OBJECT.B, cutoff.B)), 'review_id')
  base.proposalB = createdId(await recordReview(proposalBody(USER.otroOperador, TENANT.B, OBJECT.B, cutoff.B)), 'review_id')
  base.approvalB = createdId(await recordApproval(approvalBody(USER.otroSupervisor, TENANT.B, base.proposalB, cutoff.B)), 'approval_id')
})

describe('precondiciones', () => {
  it('REV-ENV-01: destino local, migraciones aplicadas, cuentas sinteticas y base recien sembrada', async () => {
    expect(config.supabaseUrl).toBe(LOCAL_API_URL)
    expect(initialCounts, 'sin revisiones, aprobaciones ni lotes anteriores').toBe('0|0|0')
    expect(sql(`select count(*) from supabase_migrations.schema_migrations where version in ('20261030100000', '20261102120000', '20261110100000')`)).toBe('3')
    expect(sql(`select string_agg(distinct r.name collate "C", ',' order by r.name collate "C") from public.tenant_user tu join public.role r on r.id = tu.role where tu.tenant in (${TENANT.A}, ${TENANT.B})`), 'roles vigentes de las cuentas').toBe('ADMIN,USER,importador_sistema,tp_operator')
    expect(sql(`select count(*) from auth.users where email not like '%@example.test'`), 'solo cuentas sinteticas').toBe('0')
    expect(sql(`select count(*) from public.tenant where id in (${TENANT.A}, ${TENANT.B}, ${TENANT.INACTIVE})`)).toBe('3')
    expect((await readBuildInfo()).supabaseProjectRef, 'el servidor probado no apunta a un proyecto remoto').toBeNull()
  })
})

describe('registro por la funcion, con la credencial de servidor', () => {
  it('REV-FN-01: operador inserta en su municipio; rol y revisor los fija la base', async () => {
    const id = createdId(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
    expect(sql(`select tenant, debtor, reviewer, reviewer_role, rules_version, as_of, inputs_hash from public.case_review where id = ${id}`))
      .toBe(`${TENANT.A}|${OBJECT.A}|${USER.operador}|ADMIN|1.0.0|${AS_OF}|${'a'.repeat(64)}`)
  })

  it('REV-FN-02: objeto de otro municipio, denegado', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.B, cutoff.A)), 'OBJECT_NOT_IN_TENANT')
    })
  })

  it('REV-FN-03: operador que actua en otro municipio, denegado', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.operador, TENANT.B, OBJECT.B, cutoff.B)), 'ACTOR_NOT_ACTIVE_MEMBER')
    })
  })

  it('REV-FN-04: sin membresia, denegado', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.sinMembresia, TENANT.A, OBJECT.A, cutoff.A)), 'ACTOR_NOT_ACTIVE_MEMBER')
    })
  })

  it('REV-FN-05: membresia inactiva, denegado', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.inactivo, TENANT.A, OBJECT.A, cutoff.A)), 'ACTOR_NOT_ACTIVE_MEMBER')
    })
  })

  it('REV-FN-06: membresia activa de un usuario o municipio inactivo, denegado', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.usuarioInactivo, TENANT.A, OBJECT.A, cutoff.A)), 'ACTOR_NOT_ACTIVE_MEMBER', 'usuario inactivo')
      expectRejected(await recordReview(reviewBody(USER.municipioInactivo, TENANT.INACTIVE, OBJECT.INACTIVE, cutoff.A)), 'ACTOR_NOT_ACTIVE_MEMBER', 'municipio inactivo')
    })
  })

  it('REV-FN-07: rol USER (cuenta consulta), denegado', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.consulta, TENANT.A, OBJECT.A, cutoff.A)), 'ROLE_NOT_ALLOWED')
    })
  })

  it('REV-FN-08: N7: otra cuenta ADMIN (supervisor) registra; los nombres de rol anteriores no registran', async () => {
    // Antes «supervisor no registra decisiones»: hoy registra todo ADMIN (encargo 4.2). Lo que no registra es un rol que no es ADMIN.
    createdId(await recordReview(reviewBody(USER.supervisor, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
    for (const name of ['operador', 'supervisor'] as const) {
      await withHistoricRole(name, async () => {
        await withoutWrites(async () => {
          expectRejected(await recordReview(reviewBody(USER.proponente, TENANT.A, OBJECT.A, cutoff.A)), 'ROLE_NOT_ALLOWED', name)
        })
      })
    }
  })

  it('REV-FN-09: ADMIN en B y USER en A: en A no registra, en B si', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.otroOperador, TENANT.A, OBJECT.A, cutoff.A)), 'ROLE_NOT_ALLOWED')
    })
    createdId(await recordReview(reviewBody(USER.otroOperador, TENANT.B, OBJECT.B, cutoff.B)), 'review_id')
  })

  it('REV-FN-11: la clave de idempotencia no deja reescribir ni responder por otro', async () => {
    const body = reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)
    const first = createdId(await recordReview(body), 'review_id')
    await withoutWrites(async () => {
      const repeated = await recordReview(body)
      expect([repeated.status, repeated.body]).toEqual([200, { review_id: first, created: false, pending_supervisor: false }])
      expectRejected(await recordReview({ ...body, p_inputs_hash: 'f'.repeat(64) }), 'IDEMPOTENCY_KEY_CONFLICT', 'otro hash')
      expectRejected(await recordReview({ ...body, p_rules_version: '9.9.9' }), 'IDEMPOTENCY_KEY_CONFLICT', 'otra version')
      expectRejected(await recordReview({ ...body, p_reviewer_user: USER.proponente }), 'IDEMPOTENCY_KEY_CONFLICT', 'otro operador')
    })
  })

  it('REV-FN-12: la base no acepta una sugerencia de intensidad 3 o una decision intensa sin lista de control', async () => {
    await withoutWrites(async () => {
      for (const intensity of [3, 4]) {
        expectRejected(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A, { p_suggested_intensity: intensity, p_decided_intensity: intensity, p_checklist: READY_CHECKLIST })), 'INVALID_CASE_REVIEW:case_review_suggested_intensity_range', `sugerencia ${intensity}`)
      }
      expectRejected(await recordReview(proposalBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A, { p_checklist: {} })), 'INVALID_CASE_REVIEW:case_review_intense_requires_checklist', 'sin lista')
    })
  })

  it('REV-FN-10: rol, fecha y municipio de la fila no son parametros que se puedan enviar', async () => {
    await withoutWrites(async () => {
      for (const extra of [{ p_reviewer_role: 'supervisor' }, { p_created_at: '2020-01-01' }, { tenant: TENANT.B }]) {
        expectCode(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A, extra)), 'PGRST202', Object.keys(extra)[0])
      }
    })
  })
})

describe('cliente directo por la Data API', () => {
  it('REV-API-01: anon no inserta ni ejecuta', async () => {
    await withoutWrites(async () => {
      for (const table of DECISION_TABLES) expectCode(await insertRow(table, undefined, validRow[table]()), '42501', `insertar ${table}`)
      expectCode(await api('POST', '/rest/v1/rpc/record_case_review', { body: reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A) }), '42501', 'decision')
      expectCode(await api('POST', '/rest/v1/rpc/record_case_review_approval', { body: approvalBody(USER.supervisor, TENANT.A, base.proposal, cutoff.A) }), '42501', 'aprobacion')
      expectCode(await api('POST', '/rest/v1/rpc/record_import_batch', { body: batchBody(USER.sistema, TENANT.A) }), '42501', 'lote')
    })
  })

  it('REV-API-02: update denegado sobre filas reales, a todo cliente y a la credencial de servidor', async () => {
    const targets = [['case_review', base.review, { decision: 'RECHAZA' }], ['case_review_approval', base.approval, { decision: 'OBJETA' }], ['import_batch', base.batchA, { status: 'FALLIDO' }]] as const
    const before = sql(`select md5(string_agg(r::text, ',' order by id)) from public.case_review r`)
    for (const [table, id, body] of targets) {
      for (const [name, token] of [...CLIENTS, ['servidor de revision', () => config.reviewJwt] as const]) {
        expectCode(await api('PATCH', `/rest/v1/${table}?id=eq.${id}`, { token: token(), body }), '42501', `${name} ${table}`)
      }
    }
    expect(sql(`select md5(string_agg(r::text, ',' order by id)) from public.case_review r`), 'filas intactas').toBe(before)
    expect(sql(`select status from public.import_batch where id = ${base.batchA}`)).toBe('PUBLICADO')
    expect(sql(`select decision from public.case_review_approval where id = ${base.approval}`)).toBe('APRUEBA')
  })

  it('REV-API-03: delete denegado sobre filas reales, a todo cliente y a la credencial de servidor', async () => {
    await withoutWrites(async () => {
      const targets = [['case_review', base.review], ['case_review_approval', base.approval], ['import_batch', base.batchA]] as const
      for (const [table, id] of targets) {
        for (const [name, token] of [...CLIENTS, ['servidor de revision', () => config.reviewJwt] as const]) {
          expectCode(await api('DELETE', `/rest/v1/${table}?id=eq.${id}`, { token: token() }), '42501', `${name} ${table}`)
        }
      }
    })
  })

  it('REV-API-04: operador legitimo con sugerencia falsificada: sin privilegio', async () => {
    await insertDenied(tokens.operador, forgedRow({ suggested_intervention: 'SUGERENCIA_FALSIFICADA', suggested_intensity: 0, decided_intervention: 'SUGERENCIA_FALSIFICADA', decided_intensity: 0 }), `suggested_intervention = 'SUGERENCIA_FALSIFICADA'`)
  })

  it('REV-API-05: operador legitimo con hash de insumos falsificado: sin privilegio', async () => {
    await insertDenied(tokens.operador, forgedRow({ inputs_hash: 'f'.repeat(64) }), `inputs_hash = '${'f'.repeat(64)}'`)
  })

  it('REV-API-06: operador legitimo con version de reglas falsificada: sin privilegio', async () => {
    await insertDenied(tokens.operador, forgedRow({ rules_version: '9.9.9' }), `rules_version = '9.9.9'`)
  })

  it('REV-API-07: operador legitimo tampoco por upsert, lote de filas ni la funcion con su sesion', async () => {
    await withoutWrites(async () => {
      expectCode(await api('POST', '/rest/v1/case_review?on_conflict=tenant,idempotency_key', { token: tokens.operador, body: forgedRow({ inputs_hash: 'f'.repeat(64) }), prefer: 'resolution=merge-duplicates' }), '42501', 'upsert')
      expectCode(await api('POST', '/rest/v1/case_review', { token: tokens.operador, body: [forgedRow({ rules_version: '9.9.9' }), forgedRow({ rules_version: '9.9.8' })] }), '42501', 'lote de filas')
      expectCode(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A), tokens.operador), '42501', 'funcion con la sesion')
    })
  })

  it('REV-API-08: operador y supervisor no se aprueban directo', async () => {
    await withoutWrites(async () => {
      expectCode(await insertRow('case_review_approval', tokens.operador, forgedApproval({ approver: USER.operador, approver_role: 'operador' })), '42501', 'operador directo')
      expectCode(await insertRow('case_review_approval', tokens.supervisor, forgedApproval()), '42501', 'supervisor directo')
      expectCode(await recordApproval(approvalBody(USER.supervisor, TENANT.A, base.proposal, cutoff.A), tokens.supervisor), '42501', 'funcion con la sesion del supervisor')
    })
    expect(approvals(base.proposal)).toBe(0)
  })

  it('REV-API-09: nadie falsifica un corte ni un lote directo', async () => {
    await withoutWrites(async () => {
      for (const label of ['operador', 'supervisor', 'importador-real'] as const) {
        expectCode(await insertRow('import_batch', tokens[label], forgedBatch()), '42501', label)
      }
      expectCode(await recordBatch(batchBody(USER.importador, TENANT.A), tokens['importador-real']), '42501', 'funcion con la sesion del importador')
    })
  })

  it('REV-API-10: tampoco el dueno de las tablas modifica ni borra: append-only', () => {
    for (const statement of [
      `update public.case_review set decision = 'RECHAZA' where id = ${base.review}`,
      `delete from public.case_review where id = ${base.review}`,
      `update public.case_review_approval set decision = 'OBJETA' where id = ${base.approval}`,
      `delete from public.case_review_approval where id = ${base.approval}`,
      `update public.import_batch set status = 'FALLIDO' where id = ${base.batchA}`,
      `delete from public.import_batch where id = ${base.batchA}`,
      'truncate public.case_review_approval',
      'truncate public.import_batch',
      'truncate public.case_review, public.case_review_approval',
    ]) {
      expect(sqlError(statement), statement).toContain('APPEND_ONLY')
    }
  })

  it('REV-API-11: service_role no escribe ni ejecuta', async () => {
    const token = signJwt({ role: 'service_role' })
    await withoutWrites(async () => {
      expectCode(await insertRow('case_review', token, forgedRow()), '42501', 'decision')
      expectCode(await insertRow('case_review_approval', token, forgedApproval()), '42501', 'aprobacion')
      expectCode(await insertRow('import_batch', token, forgedBatch()), '42501', 'lote')
      expectCode(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A), token), '42501', 'funcion de decision')
      expectCode(await recordBatch(batchBody(USER.sistema, TENANT.A), token), '42501', 'funcion de lote')
    })
  })

  it('REV-API-12: otro municipio, sin membresia, membresia inactiva y consulta: sin privilegio directo', async () => {
    await withoutWrites(async () => {
      for (const label of ['otro-operador', 'otro-supervisor', 'sin-membresia', 'inactivo', 'consulta'] as const) {
        expectCode(await insertRow('case_review', tokens[label], forgedRow()), '42501', `${label} en A`)
        expectCode(await insertRow('case_review', tokens[label], forgedRow({ tenant: TENANT.B, debtor: OBJECT.B })), '42501', `${label} en B`)
      }
    })
  })
})

describe('aprobacion de intensidad 3 o mayor', () => {
  it('REV-APR-01: N7: quien propuso (operador, ADMIN) no aprueba ni objeta su propuesta', async () => {
    // Antes ROLE_NOT_ALLOWED por ser operador; hoy es ADMIN y lo frena la comprobacion por identidad.
    await withoutWrites(async () => {
      expectRejected(await recordApproval(approvalBody(USER.operador, TENANT.A, base.proposal, cutoff.A)), 'APPROVER_IS_PROPONENT', 'aprueba')
      expectRejected(await recordApproval(approvalBody(USER.operador, TENANT.A, base.proposal, null, { p_decision: 'OBJETA', p_reason_code: 'MOTIVO_SINTETICO', p_checklist: {} })), 'APPROVER_IS_PROPONENT', 'objeta')
    })
    expect(approvals(base.proposal)).toBe(0)
  })

  it('REV-APR-02: otra persona ADMIN (supervisor) aprueba; rol y aprobador los fija la base', async () => {
    const proposal = createdId(await recordReview(proposalBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
    const id = createdId(await recordApproval(approvalBody(USER.supervisor, TENANT.A, proposal, cutoff.A)), 'approval_id')
    expect(sql(`select tenant, case_review, decision, approver, approver_role from public.case_review_approval where id = ${id}`)).toBe(`${TENANT.A}|${proposal}|APRUEBA|${USER.supervisor}|ADMIN`)
  })

  it('REV-APR-03: N7: USER, importador_sistema, tp_operator y los nombres anteriores no aprueban; otra cuenta ADMIN si', async () => {
    // Antes la cuenta importador-real tampoco aprobaba; hoy es ADMIN y otra persona.
    await withoutWrites(async () => {
      for (const user of [USER.consulta, USER.sistema, USER.tpOperator]) {
        expectRejected(await recordApproval(approvalBody(user, TENANT.A, base.proposal, cutoff.A)), 'ROLE_NOT_ALLOWED', String(user))
      }
    })
    for (const name of ['supervisor', 'importador'] as const) {
      await withHistoricRole(name, async () => {
        await withoutWrites(async () => {
          expectRejected(await recordApproval(approvalBody(USER.proponente, TENANT.A, base.proposal, cutoff.A)), 'ROLE_NOT_ALLOWED', name)
        })
      })
    }
    const proposal = createdId(await recordReview(proposalBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
    createdId(await recordApproval(approvalBody(USER.importador, TENANT.A, proposal, cutoff.A)), 'approval_id')
    expect(approvals(base.proposal)).toBe(0)
  })

  it('REV-APR-04: ADMIN de otro municipio no aprueba ni desde el suyo ni desde este', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordApproval(approvalBody(USER.otroSupervisor, TENANT.A, base.proposal, cutoff.A)), 'ACTOR_NOT_ACTIVE_MEMBER', 'nombrando el municipio ajeno')
      expectRejected(await recordApproval(approvalBody(USER.otroSupervisor, TENANT.B, base.proposal, cutoff.B)), 'REVIEW_NOT_IN_TENANT', 'nombrando el suyo')
    })
  })

  it('REV-APR-05: sin membresia y membresia inactiva no aprueban', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordApproval(approvalBody(USER.sinMembresia, TENANT.A, base.proposal, cutoff.A)), 'ACTOR_NOT_ACTIVE_MEMBER', 'sin membresia')
      expectRejected(await recordApproval(approvalBody(USER.inactivo, TENANT.A, base.proposal, cutoff.A)), 'ACTOR_NOT_ACTIVE_MEMBER', 'inactiva')
    })
  })

  it('REV-APR-06: intensidad menor a 3 no se aprueba', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordApproval(approvalBody(USER.supervisor, TENANT.A, base.review, cutoff.A)), 'APPROVAL_NOT_REQUIRED')
    })
  })

  it('REV-APR-07: quien propuso no aprueba aunque tenga el rol que aprueba, tampoco una version posterior de su propuesta', async () => {
    // N7: el proponente ya es ADMIN (antes se le daba el rol supervisor solo para este caso). Se agrega la cadena de reemplazos.
    const proposal = createdId(await recordReview(proposalBody(USER.proponente, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
    await withoutWrites(async () => {
      expectRejected(await recordApproval(approvalBody(USER.proponente, TENANT.A, proposal, cutoff.A)), 'APPROVER_IS_PROPONENT')
    })
    const replacement = createdId(await recordReview(proposalBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A, { p_supersedes: proposal })), 'review_id')
    await withoutWrites(async () => {
      expectRejected(await recordApproval(approvalBody(USER.proponente, TENANT.A, replacement, cutoff.A)), 'APPROVER_IS_PROPONENT', 'version anterior')
      expectRejected(await recordApproval(approvalBody(USER.operador, TENANT.A, replacement, cutoff.A)), 'APPROVER_IS_PROPONENT', 'version vigente')
    })
    createdId(await recordApproval(approvalBody(USER.supervisor, TENANT.A, replacement, cutoff.A)), 'approval_id')
  })
})

describe('aprobacion, reenvios', () => {
  it('REV-APR-08: la clave de idempotencia de una aprobacion no deja cambiar la decision', async () => {
    const proposal = createdId(await recordReview(proposalBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
    const body = approvalBody(USER.supervisor, TENANT.A, proposal, cutoff.A)
    const first = createdId(await recordApproval(body), 'approval_id')
    await withoutWrites(async () => {
      const repeated = await recordApproval(body)
      expect([repeated.status, repeated.body]).toEqual([200, { approval_id: first, created: false }])
      expectRejected(await recordApproval({ ...body, p_decision: 'OBJETA', p_reason_code: 'MOTIVO_SINTETICO', p_checklist: {} }), 'IDEMPOTENCY_KEY_CONFLICT')
    })
  })
})

describe('autorreferencia en supersedes', () => {
  it('REV-SUP-01: decision que se reemplaza a si misma, denegada', async () => {
    const last = createdId(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A, { p_supersedes: last + 1 })), 'SUPERSEDES_NOT_FOUND')
    })
  })

  it('REV-SUP-02: aprobacion que se reemplaza a si misma, denegada', async () => {
    const proposal = createdId(await recordReview(proposalBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
    const last = createdId(await recordApproval(approvalBody(USER.supervisor, TENANT.A, proposal, cutoff.A)), 'approval_id')
    await withoutWrites(async () => {
      expectRejected(await recordApproval(approvalBody(USER.supervisor, TENANT.A, proposal, cutoff.A, { p_supersedes: last + 1 })), 'SUPERSEDES_NOT_FOUND')
    })
  })

  it('REV-SUP-03: lote que se reemplaza a si mismo, denegado', async () => {
    const last = createdId(await recordBatch(batchBody(USER.sistema, TENANT.A)), 'batch_id')
    await withoutWrites(async () => {
      expectRejected(await recordBatch(batchBody(USER.sistema, TENANT.A, { p_supersedes: last + 1 })), 'SUPERSEDES_NOT_FOUND')
    })
  })

  it('REV-SUP-04: antecedente de otro municipio, denegado en las tres funciones', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A, { p_supersedes: base.reviewB })), 'SUPERSEDES_NOT_FOUND', 'decision')
      expectRejected(await recordApproval(approvalBody(USER.supervisor, TENANT.A, base.proposal, cutoff.A, { p_supersedes: base.approvalB })), 'SUPERSEDES_NOT_FOUND', 'aprobacion')
      expectRejected(await recordBatch(batchBody(USER.sistema, TENANT.A, { p_supersedes: base.batchB })), 'SUPERSEDES_NOT_FOUND', 'lote')
    })
  })
})

describe('corte', () => {
  it('REV-CUT-01: omitir p_cutoff_batch no llega a ninguna funcion', async () => {
    await withoutWrites(async () => {
      const { p_cutoff_batch: _review, ...review } = reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)
      const { p_cutoff_batch: _approval, ...approval } = approvalBody(USER.supervisor, TENANT.A, base.proposal, cutoff.A)
      expect([_review, _approval]).toEqual([cutoff.A, cutoff.A])
      expectCode(await recordReview(review), 'PGRST202', 'decision')
      expectCode(await recordApproval(approval), 'PGRST202', 'aprobacion')
    })
  })

  it('REV-CUT-02: corte viejo denegado en decision y aprobacion; con el vigente entra', async () => {
    const proposal = createdId(await recordReview(proposalBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
    const old = cutoff.A
    cutoff.A = await publishCutoff(TENANT.A)
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, old)), 'CUTOFF_CHANGED', 'decision')
      expectRejected(await recordApproval(approvalBody(USER.supervisor, TENANT.A, proposal, old)), 'CUTOFF_CHANGED', 'aprobacion')
    })
    createdId(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
    createdId(await recordApproval(approvalBody(USER.supervisor, TENANT.A, proposal, cutoff.A)), 'approval_id')
  })

  it('REV-CUT-03: corte nulo o inexistente, denegado', async () => {
    await withoutWrites(async () => {
      for (const value of [null, MISSING_ID]) {
        expectRejected(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, value)), 'CUTOFF_CHANGED', 'decision')
        expectRejected(await recordApproval(approvalBody(USER.supervisor, TENANT.A, base.proposal, value)), 'CUTOFF_CHANGED', 'aprobacion')
      }
    })
  })

  it('REV-CUT-04: corte de otro municipio, denegado', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.B)), 'CUTOFF_CHANGED', 'decision')
      expectRejected(await recordApproval(approvalBody(USER.supervisor, TENANT.A, base.proposal, cutoff.B)), 'CUTOFF_CHANGED', 'aprobacion')
    })
  })

  it('REV-CUT-05: fecha de corte falsificada, denegada', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A, { p_as_of: '2026-01-01' })), 'CUTOFF_CHANGED')
    })
  })

  it('REV-CUT-06: con una carga en curso no se decide ni se aprueba; se puede objetar', async () => {
    const proposal = createdId(await recordReview(proposalBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
    const loading = createdId(await recordBatch(batchBody(USER.sistema, TENANT.A, { p_status: 'VALIDADO' })), 'batch_id')
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A)), 'CUTOFF_CHANGED', 'decision')
      expectRejected(await recordApproval(approvalBody(USER.supervisor, TENANT.A, proposal, cutoff.A)), 'CUTOFF_CHANGED', 'aprobacion')
    })
    createdId(await recordApproval(approvalBody(USER.supervisor, TENANT.A, proposal, null, { p_decision: 'OBJETA', p_reason_code: 'MOTIVO_SINTETICO', p_checklist: {} })), 'approval_id')
    cutoff.A = createdId(await recordBatch(batchBody(USER.sistema, TENANT.A, { p_status: 'PUBLICADO', p_supersedes: loading })), 'batch_id')
  })
})

describe('credenciales', () => {
  it('REV-JWT-01: JWT con el rol definidor no asume el rol', async () => {
    const token = signJwt({ role: 'equitas_write_definer' })
    await withoutWrites(async () => {
      expectCode(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A), token), '42501', 'decision')
      expectCode(await recordApproval(approvalBody(USER.supervisor, TENANT.A, base.proposal, cutoff.A), token), '42501', 'aprobacion')
      expectCode(await recordBatch(batchBody(USER.sistema, TENANT.A), token), '42501', 'lote')
      expectCode(await insertRow('case_review', token, forgedRow()), '42501', 'insercion directa')
      expectCode(await api('GET', '/rest/v1/case_review?select=id', { token }), '42501', 'lectura')
    })
  })

  it('REV-JWT-02: credencial de servidor firmada con otro secreto, rechazada', async () => {
    const token = signJwt({ role: 'equitas_review_server' }, 'otro-secreto-sintetico-de-32-caracteres!')
    await withoutWrites(async () => {
      expectCode(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A), token), 'PGRST301')
    })
  })

  it('REV-JWT-03: credencial de servidor vencida, rechazada', async () => {
    const token = signJwt({ role: 'equitas_review_server' }, config.jwtSecret, -3600)
    await withoutWrites(async () => {
      expectCode(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A), token), 'PGRST303')
    })
  })

  it('REV-JWT-04: sesion editada para cambiar el rol, rechazada', async () => {
    await withoutWrites(async () => {
      for (const role of ['equitas_review_server', 'service_role', 'equitas_write_definer']) {
        expectCode(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A), tamperRole(tokens.operador, role)), 'PGRST301', role)
      }
    })
  })

  it('REV-JWT-05: la credencial de revision no toca tablas ni registra lotes', async () => {
    await withoutWrites(async () => {
      for (const table of DECISION_TABLES) {
        expectCode(await api('GET', `/rest/v1/${table}?select=id`, { token: config.reviewJwt }), '42501', `leer ${table}`)
        expectCode(await insertRow(table, config.reviewJwt, validRow[table]()), '42501', `insertar ${table}`)
      }
      expectCode(await recordBatch(batchBody(USER.importador, TENANT.A), config.reviewJwt), '42501', 'lote')
    })
  })

  it('REV-JWT-06: la credencial de importacion no registra decisiones ni aprobaciones ni toca tablas', async () => {
    await withoutWrites(async () => {
      expectCode(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A), config.importJwt), '42501', 'decision')
      expectCode(await recordApproval(approvalBody(USER.supervisor, TENANT.A, base.proposal, cutoff.A), config.importJwt), '42501', 'aprobacion')
      expectCode(await readReason(USER.operador, TENANT.A, base.review, config.importJwt), '42501', 'motivo')
      for (const table of DECISION_TABLES) expectCode(await api('GET', `/rest/v1/${table}?select=id`, { token: config.importJwt }), '42501', `leer ${table}`)
    })
  })

  it('REV-JWT-07: las funciones auxiliares no se ejecutan desde afuera', async () => {
    const callers = [...CLIENTS, ['servidor de revision', () => config.reviewJwt] as const]
    for (const [name, token] of callers) {
      expectCode(await api('POST', '/rest/v1/rpc/equitas_member_role', { token: token(), body: { p_user: USER.operador, p_tenant: TENANT.A } }), '42501', `${name} rol`)
      expectCode(await api('POST', '/rest/v1/rpc/equitas_current_cutoff', { token: token(), body: { p_tenant: TENANT.A } }), '42501', `${name} corte vigente`)
      expectCode(await api('POST', '/rest/v1/rpc/equitas_verify_cutoff', { token: token(), body: { p_tenant: TENANT.A, p_cutoff_batch: cutoff.A, p_as_of: AS_OF } }), '42501', `${name} verificar corte`)
    }
  })
})

describe('importacion: ADMIN e importador_sistema (antes ALIGN-003: importador e importador_sistema)', () => {
  it('REV-IMP-01: N7: USER importando, denegado en todo estado; otra cuenta ADMIN (supervisor) registra', async () => {
    // Antes «supervisor importando, denegado»: hoy importa todo ADMIN (encargo 4.2). El rechazo se prueba con USER y el rol anterior.
    await withoutWrites(async () => {
      for (const status of ['RECIBIDO', 'VALIDADO', 'CONFIRMADO', 'PUBLICADO']) {
        expectRejected(await recordBatch(batchBody(USER.consulta, TENANT.A, { p_status: status })), 'ROLE_NOT_ALLOWED', status)
      }
    })
    await withHistoricRole('supervisor', async () => {
      await withoutWrites(async () => {
        expectRejected(await recordBatch(batchBody(USER.proponente, TENANT.A)), 'ROLE_NOT_ALLOWED', 'supervisor anterior')
      })
    })
    const id = createdId(await recordBatch(batchBody(USER.supervisor, TENANT.A)), 'batch_id')
    expect(sql(`select created_by_role, status from public.import_batch where id = ${id}`)).toBe('ADMIN|RECIBIDO')
  })

  it('REV-IMP-02: ADMIN (cuenta importador-real) registra un lote de su municipio', async () => {
    const id = createdId(await recordBatch(batchBody(USER.importador, TENANT.A)), 'batch_id')
    expect(sql(`select tenant, created_by, created_by_role, status from public.import_batch where id = ${id}`)).toBe(`${TENANT.A}|${USER.importador}|ADMIN|RECIBIDO`)
  })

  it('REV-IMP-03: importador_sistema registra un lote de su municipio', async () => {
    const id = createdId(await recordBatch(batchBody(USER.sistema, TENANT.A)), 'batch_id')
    expect(sql(`select tenant, created_by, created_by_role, status from public.import_batch where id = ${id}`)).toBe(`${TENANT.A}|${USER.sistema}|importador_sistema|RECIBIDO`)
  })

  it('REV-IMP-04: N7: USER, tp_operator y los nombres anteriores no importan', async () => {
    // Antes tambien «operador no importa»; hoy el operador es ADMIN e importa (REV-IMP-01 lo prueba con otra cuenta ADMIN).
    await withoutWrites(async () => {
      for (const user of [USER.consulta, USER.tpOperator]) {
        expectRejected(await recordBatch(batchBody(user, TENANT.A)), 'ROLE_NOT_ALLOWED', String(user))
      }
    })
    for (const name of ['operador', 'importador'] as const) {
      await withHistoricRole(name, async () => {
        await withoutWrites(async () => {
          expectRejected(await recordBatch(batchBody(USER.proponente, TENANT.A)), 'ROLE_NOT_ALLOWED', name)
        })
      })
    }
  })

  it('REV-IMP-05: N7: importador_sistema y el rol anterior importador no registran decisiones; la cuenta importador-real (ADMIN) si', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.sistema, TENANT.A, OBJECT.A, cutoff.A)), 'ROLE_NOT_ALLOWED', 'importador_sistema')
    })
    await withHistoricRole('importador', async () => {
      await withoutWrites(async () => {
        expectRejected(await recordReview(reviewBody(USER.proponente, TENANT.A, OBJECT.A, cutoff.A)), 'ROLE_NOT_ALLOWED', 'importador anterior')
      })
    })
    createdId(await recordReview(reviewBody(USER.importador, TENANT.A, OBJECT.A, cutoff.A)), 'review_id')
  })

  it('REV-IMP-06: ADMIN de un municipio no importa en otro; sin membresia e inactivo tampoco', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordBatch(batchBody(USER.importador, TENANT.B)), 'ACTOR_NOT_ACTIVE_MEMBER', 'otro municipio')
      expectRejected(await recordBatch(batchBody(USER.sinMembresia, TENANT.A)), 'ACTOR_NOT_ACTIVE_MEMBER', 'sin membresia')
      expectRejected(await recordBatch(batchBody(USER.inactivo, TENANT.A)), 'ACTOR_NOT_ACTIVE_MEMBER', 'inactivo')
    })
  })

  it('REV-IMP-07: N7: USER con sesion no decide ni aprueba por las acciones; la cuenta importador-real (ADMIN) pasa el permiso', async () => {
    // Antes la cuenta importador-real recibia ROLE_FORBIDDEN; hoy es ADMIN. El rechazo por rol se prueba con USER.
    const user = await cookie('consulta')
    await withoutWrites(async () => {
      expect((await post(ids.record, blind(OBJECT.A), { cookie: user })).result).toMatchObject({ ok: false, code: 'ROLE_FORBIDDEN' })
      expect((await post(ids.approve, { caseReviewId: String(base.proposal), decision: 'APRUEBA', checklist: READY_CHECKLIST }, { cookie: user })).result).toMatchObject({ ok: false, code: 'ROLE_FORBIDDEN' })
      // ADMIN pasa la autorizacion y llega a la comprobacion de la sugerencia: sin escribir.
      expect((await post(ids.record, blind(OBJECT.A), { cookie: await cookie('importador-real') })).result).toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED' })
    })
  })

  it('REV-IMP-09: la clave de idempotencia de un lote no deja cambiar su estado ni su autor', async () => {
    const body = batchBody(USER.importador, TENANT.A)
    const first = createdId(await recordBatch(body), 'batch_id')
    await withoutWrites(async () => {
      const repeated = await recordBatch(body)
      expect([repeated.status, repeated.body]).toEqual([200, { batch_id: first, created: false }])
      expectRejected(await recordBatch({ ...body, p_status: 'PUBLICADO' }), 'IDEMPOTENCY_KEY_CONFLICT', 'otro estado')
      expectRejected(await recordBatch({ ...body, p_actor_user: USER.sistema }), 'IDEMPOTENCY_KEY_CONFLICT', 'otro autor')
    })
  })

  it('REV-IMP-08: importador_sistema es credencial de maquina: no tiene cuenta para iniciar sesion', () => {
    expect(sql(`select auth_user is null from public."user" where id = ${USER.sistema}`)).toBe('t')
    expect(sql(`select count(*) from auth.users where email = 'tp-a018-sistema@example.test'`)).toBe('0')
  })
})

describe('compatibilidad tp_operator de E06', () => {
  it('REV-TP-01: sin escritura directa, tampoco en identidad ni cartera', async () => {
    await withoutWrites(async () => {
      expectCode(await insertRow('case_review', tokens[TP_OPERATOR], forgedRow({ reviewer: USER.tpOperator, reviewer_role: 'tp_operator' })), '42501', 'decision')
      expectCode(await insertRow('case_review_approval', tokens[TP_OPERATOR], forgedApproval({ approver: USER.tpOperator, approver_role: 'tp_operator' })), '42501', 'aprobacion')
      expectCode(await insertRow('import_batch', tokens[TP_OPERATOR], forgedBatch({ created_by: USER.tpOperator, created_by_role: 'tp_operator' })), '42501', 'lote')
      expectCode(await api('PATCH', '/rest/v1/tenant_user?id=eq.920004', { token: tokens[TP_OPERATOR], body: { role: 920002 } }), '42501', 'membresia')
      expectCode(await insertRow('role', tokens[TP_OPERATOR], { id: 920099, name: 'operador' }), '42501', 'rol')
      expectCode(await api('PATCH', `/rest/v1/debtor?id=eq.${OBJECT.A}`, { token: tokens[TP_OPERATOR], body: { description: 'editado' } }), '42501', 'cartera')
    })
    expect(sql('select role from public.tenant_user where id = 920004')).toBe('920010')
    expect(sql(`select description from public.debtor where id = ${OBJECT.A}`)).toBe('Objeto sintetico del municipio')
  })

  it('REV-TP-02: las tres funciones lo rechazan por rol', async () => {
    await withoutWrites(async () => {
      expectRejected(await recordReview(reviewBody(USER.tpOperator, TENANT.A, OBJECT.A, cutoff.A)), 'ROLE_NOT_ALLOWED', 'decision')
      expectRejected(await recordApproval(approvalBody(USER.tpOperator, TENANT.A, base.proposal, cutoff.A)), 'ROLE_NOT_ALLOWED', 'aprobacion')
      expectRejected(await recordBatch(batchBody(USER.tpOperator, TENANT.A)), 'ROLE_NOT_ALLOWED', 'lote')
    })
  })

  it('REV-TP-03: las acciones lo rechazan por rol', async () => {
    const session = await cookie(TP_OPERATOR)
    await withoutWrites(async () => {
      expect((await post(ids.record, blind(OBJECT.A), { cookie: session })).result).toMatchObject({ ok: false, code: 'ROLE_FORBIDDEN' })
      expect((await post(ids.approve, { caseReviewId: String(base.proposal), decision: 'APRUEBA', checklist: READY_CHECKLIST }, { cookie: session })).result).toMatchObject({ ok: false, code: 'ROLE_FORBIDDEN' })
    })
  })
})

describe('lectura entre municipios', () => {
  const rows = async (table: string, token: string | undefined, query = '') => {
    const reply = await api('GET', `/rest/v1/${table}?select=id,tenant${query}`, { token })
    expect(reply.status, `leer ${table}`).toBe(200)
    return reply.body as Array<{ id: number; tenant: number }>
  }

  it('REV-READ-01: los miembros de A ven lo de A y nada de B', async () => {
    for (const label of ['consulta', 'operador', 'supervisor', TP_OPERATOR, 'importador-real'] as const) {
      for (const table of DECISION_TABLES) {
        const seen = await rows(table, tokens[label])
        expect(seen.length, `${label} ${table}: hay filas para ver`).toBeGreaterThan(0)
        expect([...new Set(seen.map(row => row.tenant))], `${label} ${table}`).toEqual([TENANT.A])
      }
    }
  })

  it('REV-READ-02: el ADMIN de B ve lo de B y nada de A', async () => {
    for (const table of DECISION_TABLES) {
      const seen = await rows(table, tokens['otro-supervisor'])
      expect(seen.length, `${table}: hay filas para ver`).toBeGreaterThan(0)
      expect([...new Set(seen.map(row => row.tenant))], table).toEqual([TENANT.B])
    }
  })

  it('REV-READ-03: pedir una fila ajena por ID o por municipio devuelve vacio', async () => {
    const targets = [['case_review', base.reviewB], ['case_review_approval', base.approvalB], ['import_batch', base.batchB]] as const
    for (const [table, id] of targets) {
      expect(sql(`select count(*) from public.${table} where id = ${id}`), `${table}: la fila existe`).toBe('1')
      expect(await rows(table, tokens.operador, `&id=eq.${id}`), `${table} por ID`).toEqual([])
      expect(await rows(table, tokens.operador, `&tenant=eq.${TENANT.B}`), `${table} por municipio`).toEqual([])
    }
  })

  it('REV-READ-04: sin membresia, membresia inactiva y anon no ven nada', async () => {
    for (const [name, token] of [['sin-membresia', tokens['sin-membresia']], ['inactivo', tokens.inactivo], ['anon', undefined]] as const) {
      for (const table of DECISION_TABLES) expect(await rows(table, token), `${name} ${table}`).toEqual([])
    }
  })

  it('REV-READ-05: el motivo libre no sale por la Data API ni a otro municipio', async () => {
    const id = createdId(await recordReview(reviewBody(USER.operador, TENANT.A, OBJECT.A, cutoff.A, { p_decision: 'RECHAZA', p_decided_intervention: null, p_decided_intensity: null, p_reason_code: 'MOTIVO_SINTETICO', p_reason_text: 'Texto sintetico' })), 'review_id')
    expectCode(await api('GET', `/rest/v1/case_review?select=*&id=eq.${id}`, { token: tokens.supervisor }), '42501', 'select=*')
    expectCode(await api('GET', `/rest/v1/case_review?select=reason_text&id=eq.${id}`, { token: tokens.supervisor }), '42501', 'select=reason_text')
    expectCode(await api('GET', `/rest/v1/case_review?select=id&reason_text=like.*sintetico*`, { token: tokens.supervisor }), '42501', 'filtrar por el motivo')
    expectCode(await api('GET', `/rest/v1/case_review?select=id&order=reason_text`, { token: tokens.supervisor }), '42501', 'ordenar por el motivo')
    expectCode(await api('GET', `/rest/v1/debtor?select=id,case_review(reason_text)&id=eq.${OBJECT.A}`, { token: tokens.supervisor }), '42501', 'embeber el motivo')
    expectCode(await readReason(USER.supervisor, TENANT.A, id, tokens.supervisor), '42501', 'funcion con la sesion')
    expectCode(await api('GET', `/rest/v1/rpc/read_case_review_reason_text?p_actor_user=${USER.supervisor}&p_tenant=${TENANT.A}&p_case_review=${id}`, { token: tokens.supervisor }), '42501', 'funcion por GET')
    expectRejected(await readReason(USER.consulta, TENANT.A, id), 'ROLE_NOT_ALLOWED', 'USER (consulta)')
    expectRejected(await readReason(USER.otroSupervisor, TENANT.A, id), 'ACTOR_NOT_ACTIVE_MEMBER', 'otro municipio')
    expectRejected(await readReason(USER.otroSupervisor, TENANT.B, id), 'REVIEW_NOT_IN_TENANT', 'nombrando el suyo')
    const allowed = await readReason(USER.supervisor, TENANT.A, id)
    expect([allowed.status, allowed.body]).toEqual([200, 'Texto sintetico'])
  })

  it('REV-READ-06: embeber tablas relacionadas tampoco cruza municipios', async () => {
    for (const path of ['debtor?select=id,tenant,case_review(id,tenant)', 'case_review_approval?select=id,tenant,case_review(id,tenant)', 'case_review?select=id,tenant,debtor(id,tenant)', 'tenant?select=id,import_batch(id,tenant)']) {
      const reply = await api('GET', `/rest/v1/${path}`, { token: tokens.operador })
      expect(reply.status, path).toBe(200)
      const text = JSON.stringify(reply.body)
      expect(text, `${path}: hay filas de A`).toContain(`"tenant":${TENANT.A}`)
      expect(text, `${path}: nada de B`).not.toContain(`"tenant":${TENANT.B}`)
    }
    const reply = await api('GET', `/rest/v1/debtor?select=id,case_review(id)&id=eq.${OBJECT.B}`, { token: tokens.operador })
    expect([reply.status, reply.body], 'objeto ajeno con sus decisiones').toEqual([200, []])
  })
})

describe('acciones de servidor, compiladas y por HTTP', () => {
  it('REV-ACT-01: recorrido autorizado: un ADMIN (operador) registra y la fila lleva lo calculado por el servidor', async () => {
    const session = await cookie('operador')
    const debtor = 920011
    const { current, expected } = await serverShown(debtor, session)
    expect(reviews(String(debtor)), 'mirar no escribe').toBe(0)
    const { status, result } = await post(ids.record, { debtorId: String(debtor), decision: 'ACEPTA', expected }, { cookie: session })
    expect(status).toBe(200)
    expect(result).toMatchObject({ ok: true, created: true, status: 'REGISTRADA' })
    expect(sql(`select tenant, debtor, reviewer, reviewer_role, inputs_hash, rules_version, as_of, suggested_intervention, suggested_intensity from public.case_review where id = ${result!.reviewId}`))
      .toBe(`${TENANT.A}|${debtor}|${USER.operador}|ADMIN|${current.inputsHash}|${current.rulesVersion}|${current.asOf}|${current.suggestedIntervention}|${current.suggestedIntensity}`)
  })

  it('REV-ACT-02: recorrido autorizado de intensidad 3: un ADMIN propone y no aprueba lo suyo; otro ADMIN aprueba', async () => {
    const operator = await cookie('operador')
    const debtor = 920012
    const { expected } = await serverShown(debtor, operator)
    const proposal = await post(ids.record, { debtorId: String(debtor), decision: 'MODIFICA', decidedIntervention: INTENSE.p_decided_intervention, decidedIntensity: INTENSE.p_decided_intensity, reasonCode: INTENSE.p_reason_code, checklist: READY_CHECKLIST, expected }, { cookie: operator })
    expect(proposal.result).toMatchObject({ ok: true, created: true, status: 'PENDIENTE_SUPERVISOR' })
    const reviewId = String(proposal.result!.reviewId)
    const approval = { caseReviewId: reviewId, decision: 'APRUEBA', checklist: READY_CHECKLIST }
    // N7: antes ROLE_FORBIDDEN por ser operador; hoy es ADMIN y la base lo rechaza por identidad.
    expect((await post(ids.approve, approval, { cookie: operator })).result).toMatchObject({ ok: false, code: 'APPROVER_IS_PROPONENT' })
    expect(approvals(reviewId)).toBe(0)
    const approved = await post(ids.approve, approval, { cookie: await cookie('supervisor') })
    expect(approved.result).toMatchObject({ ok: true, created: true, status: 'APROBADA' })
    expect(sql(`select approver, approver_role, decision from public.case_review_approval where case_review = ${reviewId}`)).toBe(`${USER.supervisor}|ADMIN|APRUEBA`)
  })

  it('REV-ACT-03: por la accion tampoco se falsifica: campo extra rechazado y hash ajeno sin escribir', async () => {
    const session = await cookie('operador')
    const debtor = 920016
    const { expected } = await serverShown(debtor, session)
    await withoutWrites(async () => {
      for (const forged of [{ tenant: String(TENANT.B) }, { reviewer: String(USER.supervisor) }, { inputsHash: 'f'.repeat(64) }, { suggestedIntensity: 0 }, { rulesVersion: '9.9.9' }, { cutoffBatchId: String(cutoff.A) }]) {
        expect((await post(ids.record, { debtorId: String(debtor), decision: 'ACEPTA', expected, ...forged }, { cookie: session })).result, Object.keys(forged)[0]).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
      }
      expect((await post(ids.record, { debtorId: String(debtor), decision: 'ACEPTA', expected: { ...expected, inputsHash: 'f'.repeat(64) } }, { cookie: session })).result).toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', changed: ['INSUMOS'] })
      expect((await post(ids.record, { debtorId: String(debtor), decision: 'ACEPTA', expected: { ...expected, rulesVersion: '9.9.9' } }, { cookie: session })).result).toMatchObject({ ok: false, code: 'SUGGESTION_OUTDATED', changed: ['VERSION'] })
    })
  })

  it('REV-ACT-04: N7: la accion deniega USER, sin membresia, inactivo y dos membresias sin elegir; otro ADMIN pasa el permiso', async () => {
    await withoutWrites(async () => {
      // Antes la cuenta supervisor recibia ROLE_FORBIDDEN; hoy es ADMIN y llega a la comprobacion de la sugerencia, sin escribir.
      for (const [label, code] of [['consulta', 'ROLE_FORBIDDEN'], ['supervisor', 'SUGGESTION_OUTDATED'], ['sin-membresia', 'TENANT_ACCESS_NOT_FOUND'], ['inactivo', 'TENANT_ACCESS_INACTIVE'], ['otro-operador', 'TENANT_SELECTION_REQUIRED']] as const) {
        expect((await post(ids.record, blind(OBJECT.A), { cookie: await cookie(label) })).result, label).toMatchObject({ ok: false, code })
      }
      expect((await post(ids.record, blind(OBJECT.A), { cookie: await cookie('otro-operador', String(TENANT.A)) })).result, 'ADMIN en B que elige A, donde es USER').toMatchObject({ ok: false, code: 'ROLE_FORBIDDEN' })
    })
  })

  it('REV-ACT-05: la accion no cruza municipios: cookie ajena, objeto ajeno y revision ajena', async () => {
    await withoutWrites(async () => {
      expect((await post(ids.record, blind(OBJECT.A), { cookie: await cookie('operador', String(TENANT.B)) })).result, 'cookie ajena').toMatchObject({ ok: false, code: 'TENANT_ACCESS_NOT_FOUND' })
      expect((await post(ids.record, blind(OBJECT.B), { cookie: await cookie('operador') })).result, 'objeto ajeno').toMatchObject({ ok: false, code: 'OBJECT_NOT_IN_TENANT' })
      expect((await post(ids.approve, { caseReviewId: String(base.proposal), decision: 'APRUEBA', checklist: READY_CHECKLIST }, { cookie: await cookie('otro-supervisor') })).result, 'revision ajena').toMatchObject({ ok: false, code: 'REVIEW_NOT_IN_TENANT' })
    })
    expect(approvals(base.proposal)).toBe(0)
  })

  it('REV-ACT-06: sin sesion la accion no se ejecuta', async () => {
    await withoutWrites(async () => {
      const { status, location, result } = await post(ids.record, blind(OBJECT.A))
      expect(status).toBe(307)
      expect(location).toBe('/login?next=%2Falign020-probe')
      expect(result).toBeNull()
      const approval = await post(ids.approve, { caseReviewId: String(base.proposal), decision: 'APRUEBA', checklist: READY_CHECKLIST })
      expect([approval.status, approval.result]).toEqual([307, null])
    })
  })

  it('REV-ACT-07: un origen ajeno con sesion valida no llega a la accion', async () => {
    const session = await cookie('operador')
    const debtor = 920018
    const { expected } = await serverShown(debtor, session)
    await withoutWrites(async () => {
      const { result } = await post(ids.record, { debtorId: String(debtor), decision: 'ACEPTA', expected }, { cookie: session, origin: 'https://otro.example' })
      expect(result?.ok).not.toBe(true)
    })
    expect(reviews(String(debtor))).toBe(0)
    // Control: lo mismo desde el origen propio entra. Lo que frena el caso anterior es el origen, no la entrada.
    expect((await post(ids.record, { debtorId: String(debtor), decision: 'ACEPTA', expected }, { cookie: session })).result).toMatchObject({ ok: true, created: true })
  })
})
