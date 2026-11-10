import Image from 'next/image'
import { CheckCircle2 } from 'lucide-react'

import { LoginForm } from '@/components/auth/login-form'
import { safeNextPath } from '@/lib/auth/session-routing'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Lo que hace la aplicación, en palabras. Sin cifras de ejemplo: la primera impresión no muestra datos que no existen.
const WHAT_YOU_CAN_DO = [
  'Ver la cartera del municipio a una fecha, con su total registrado, deuda pendiente y deuda vencida.',
  'Encontrar cada caso en su grupo de trabajo, ordenado por su puntaje de prioridad.',
  'Leer la recomendación automática y registrar la decisión sobre cada caso.',
  'Cargar la cartera desde un archivo CSV y descargar reportes.',
] as const

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const nextPath = safeNextPath(resolvedSearchParams.next) ?? '/'

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#F8F7F3_0%,_#EEF2F7_100%)] p-4">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center py-6">
        <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl bg-[#163a63] p-6 text-white shadow-lg lg:p-8">
            <div className="flex items-center gap-3">
              <span className="inline-flex rounded-xl border border-white/20 bg-white/15 p-2.5">
                <Image src="/icono.png" alt="" width={28} height={28} className="size-7 object-contain" priority />
              </span>
              <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">EQUITAS</h1>
            </div>
            <p className="mt-3 max-w-lg text-sm text-slate-100">
              Gestión de la deuda municipal por casos: qué casos trabajar primero y por qué, con reglas a la vista.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {WHAT_YOU_CAN_DO.map(item => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#d8c28a]" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <Card className="border-slate-200/80 bg-white shadow-md">
            <CardHeader>
              <CardTitle className="text-2xl text-[#163a63]">Iniciar sesión</CardTitle>
              <p className="text-sm text-slate-600">Ingresá con el correo y la contraseña de tu cuenta del municipio.</p>
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
