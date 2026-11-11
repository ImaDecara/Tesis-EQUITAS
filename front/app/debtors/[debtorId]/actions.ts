'use server'

import { revalidatePath } from 'next/cache'

import type { ApproveCaseDecisionResult, RecordCaseDecisionResult } from '@/lib/domain/case-review-contract'
import { approveCaseDecisionInSession, recordCaseDecisionInSession } from '@/lib/server/case-review-service'

// ALIGN-020. Cada función exportada acá es un POST público: la autorización, la validación
// y el recálculo ocurren adentro, en cada llamada. La entrada es `unknown` a propósito.
// Contrato para la pantalla: `front/lib/domain/case-review-contract.ts`.

export async function recordCaseDecision(input: unknown): Promise<RecordCaseDecisionResult> {
  const result = await recordCaseDecisionInSession(input)
  if (result.ok) revalidatePath(`/debtors/${result.debtorId}`)
  return result
}

export async function approveCaseDecision(input: unknown): Promise<ApproveCaseDecisionResult> {
  const result = await approveCaseDecisionInSession(input)
  if (result.ok) revalidatePath(`/debtors/${result.debtorId}`)
  return result
}
