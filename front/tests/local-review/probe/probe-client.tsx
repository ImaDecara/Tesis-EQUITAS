'use client'

import { approveCaseDecision, recordCaseDecision } from '@/app/debtors/[debtorId]/actions'

export function ProbeClient() {
  return (
    <div>
      <button onClick={() => void recordCaseDecision({})}>registrar</button>
      <button onClick={() => void approveCaseDecision({})}>aprobar</button>
    </div>
  )
}
