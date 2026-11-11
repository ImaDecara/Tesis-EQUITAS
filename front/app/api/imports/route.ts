import type { NextRequest } from 'next/server'

import { forwardImportRequest } from '@/lib/server/imports-forward'

export const dynamic = 'force-dynamic'

// `[...path]` no incluye la raiz, donde se crea el lote.
export function POST(request: NextRequest) {
  return forwardImportRequest(request, [])
}
