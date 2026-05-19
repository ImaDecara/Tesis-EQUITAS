import { Landmark } from 'lucide-react'

import { LoginForm } from '@/components/auth/login-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const nextPath =
    resolvedSearchParams.next && resolvedSearchParams.next.startsWith('/')
      ? resolvedSearchParams.next
      : '/'

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#dff7ea_0,_#f8fbff_34%,_#f5f7fb_100%)] p-4">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center">
        <div className="grid w-full max-w-5xl grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-700 p-8 text-white shadow-xl">
            <div className="mb-8 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs">
              <Landmark className="size-3.5" />
              Plataforma municipal
            </div>
            <h1 className="text-4xl font-semibold tracking-tight">EQUITAS</h1>
            <p className="mt-3 max-w-md text-sm text-emerald-50/90">
              Sistema inteligente de recupero de deuda municipal
            </p>
          </section>

          <Card className="border-slate-200/80 bg-white/95 shadow-lg backdrop-blur">
            <CardHeader>
              <CardTitle className="text-2xl">Iniciar sesión</CardTitle>
            </CardHeader>
            <CardContent>
              <LoginForm nextPath={nextPath} />
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
