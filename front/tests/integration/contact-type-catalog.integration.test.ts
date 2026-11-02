import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPaginatedSupabase } from '../fixtures/paginated-supabase'

const { clientMock, loadRawDebtorData } = vi.hoisted(() => ({ clientMock: vi.fn(), loadRawDebtorData: vi.fn() }))
vi.mock('@/lib/supabase-config', () => ({ hasSupabaseCredentials: true }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: clientMock }))
// La lectura de la cartera se prueba aparte: aquí importa el catálogo que se suma en el detalle.
vi.mock('@/lib/data/raw-debtor-loader', () => ({ loadRawDebtorData }))

import { loadContactTypeCatalog } from '@/lib/server/contact-type-catalog'
import { getDebtorDetailDataFromService, getDebtorsDataFromService } from '@/lib/services/debtor-data-service'
import type { RawDebtorDataBundle } from '@/types/equitas-domain'

function portfolio(): RawDebtorDataBundle {
  return {
    batch: { as_of: '2026-09-30' },
    debtors: [{ id: 910001, external_id: 910001, type: 910001, identifier: 'TP-A', status: true }],
    debtorTypes: [{ id: 910001, key: 'TP', value: 'Objeto de prueba' }],
    debts: [{ id: 910001, debtor: 910001, current_amount: 1250, status: 910001, due_date: '2026-01-01' }],
    debtStatuses: [{ id: 910001, key: 'OVERDUE', value: 'Vencida' }],
    debtorPeople: [{ id: 910001, debtor: 910001, person: 910001, role: 'Titular', priority: 100, active: true }],
    people: [{ id: 910001, full_name: 'Persona sintetica A' }],
    debtorContacts: [{ id: 910001, person: 910001, type: 910001, value: 'persona-a@example.test', active: true }],
    debtorProfiles: [],
    warnings: [],
  }
}

describe('lectura del catálogo contact_type para el detalle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadRawDebtorData.mockImplementation(async () => portfolio())
  })

  it('resuelve el canal con el catálogo leído, con la sesión de la solicitud', async () => {
    const { client, requests } = createPaginatedSupabase({ contact_type: [{ id: 910001, key: 'EMAIL', value: 'Email' }] })
    clientMock.mockResolvedValue(client)
    const { detail, warnings } = await getDebtorDetailDataFromService('910001')
    expect(detail?.contacts.map(contact => contact.channel)).toEqual(['Email'])
    expect(warnings).toEqual([])
    expect(new Set(requests.map(request => request.table))).toEqual(new Set(['contact_type']))
  })

  it('una lectura fallida del catálogo queda como aviso y canal No disponible, sin tocar los conteos', async () => {
    const { client } = createPaginatedSupabase({}, { fail: () => ({ message: 'permission denied for table contact_type', code: '42501' }) })
    clientMock.mockResolvedValue(client)
    const { detail, warnings } = await getDebtorDetailDataFromService('910001')
    expect(detail?.contacts.map(contact => contact.channel)).toEqual(['No disponible'])
    expect(detail?.debtor.contactCount).toBe(1)
    expect(warnings).toEqual([expect.objectContaining({ table: 'contact_type', needsSelectPolicy: true })])
  })

  it('sin sesión configurable el catálogo avisa en vez de romper el detalle', async () => {
    clientMock.mockRejectedValue(new Error('cookies fuera de solicitud'))
    await expect(loadContactTypeCatalog()).resolves.toEqual({
      rows: [],
      warning: { table: 'contact_type', message: 'cookies fuera de solicitud', needsSelectPolicy: false },
    })
    clientMock.mockRejectedValue('sin mensaje')
    expect((await loadContactTypeCatalog()).warning?.message).toBe('Error desconocido al leer datos')
    clientMock.mockResolvedValue(null)
    expect((await loadContactTypeCatalog()).warning?.table).toBe('contact_type')
  })

  it('los listados no leen el catálogo: el canal solo se muestra en el detalle', async () => {
    const { client, requests } = createPaginatedSupabase({ contact_type: [{ id: 910001, value: 'Email' }] })
    clientMock.mockResolvedValue(client)
    const { warnings } = await getDebtorsDataFromService()
    expect(requests).toEqual([])
    expect(warnings).toEqual([])
  })
})
