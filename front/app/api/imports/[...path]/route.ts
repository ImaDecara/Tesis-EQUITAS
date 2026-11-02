import type { NextRequest } from 'next/server'

import { forwardImportRequest } from '@/lib/server/imports-forward'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ path: string[] }> }

export async function GET(request: NextRequest, { params }: Context) {
  return forwardImportRequest(request, (await params).path)
}

export async function POST(request: NextRequest, { params }: Context) {
  return forwardImportRequest(request, (await params).path)
}
