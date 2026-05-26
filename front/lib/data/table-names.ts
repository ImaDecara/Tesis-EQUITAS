export const EQUITAS_TABLE_NAMES = {
  debtor: 'debtor',
  debtorType: 'debtor_type',
  debt: 'debt',
  debtStatus: 'debt_status',
  debtorPerson: 'debtor_person',
  person: 'person',
  debtorContact: 'debtor_contact',
  debtorProfile: 'debtor_profile',
  debtorProfileDetail: 'debtor_profile_detail',
} as const

// Fuente unica de verdad para el orden de carga cruda de objetos de deuda.
export const RAW_DEBTOR_TABLE_LOAD_ORDER = [
  EQUITAS_TABLE_NAMES.debtor,
  EQUITAS_TABLE_NAMES.debtorType,
  EQUITAS_TABLE_NAMES.debt,
  EQUITAS_TABLE_NAMES.debtStatus,
  EQUITAS_TABLE_NAMES.debtorPerson,
  EQUITAS_TABLE_NAMES.person,
  EQUITAS_TABLE_NAMES.debtorContact,
  EQUITAS_TABLE_NAMES.debtorProfile,
] as const

export type RawDebtorTableName = (typeof RAW_DEBTOR_TABLE_LOAD_ORDER)[number]
