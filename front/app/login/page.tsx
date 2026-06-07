import Image from 'next/image'
import { AlertCircle, CheckCircle2, CircleDollarSign, PhoneOff } from 'lucide-react'

import { LoginForm } from '@/components/auth/login-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const PREVIEW_METRICS = [
  {
    label: 'Casos criticos',
    value: '186',
    icon: AlertCircle,
    tone: 'border-[#e8b7b7] bg-[#f8e7e7] text-[#8f3434]',
  },
  {
    label: 'Sin contacto',
    value: '176',
    icon: PhoneOff,
    tone: 'border-[#d8c28a] bg-[#f6efdc] text-[#6f561e]',
  },
  {
    label: 'Deuda gestionada',
    value: '$99M',
    icon: CircleDollarSign,
    tone: 'border-[#b8c8dd] bg-[#e6edf6] text-[#123459]',
  },
] as const

const RISK_PREVIEW = [
  { label: 'Alto', width: 72, color: 'bg-[#9d3d3d]' },
  { label: 'Medio', width: 48, color: 'bg-[#8a6f2a]' },
  { label: 'Bajo', width: 35, color: 'bg-[#2d6a4f]' },
] as const

const PRODUCT_MODULES = [
  'Dashboard Ejecutivo',
  'Objetos de Deuda',
  'Personas / Deudores',
  'Priorizacion Inteligente',
] as const

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
    <main className="min-h-screen bg-[linear-gradient(180deg,_#F8F7F3_0%,_#EEF2F7_100%)] p-4">
      <div className="mx-auto flex min-h-screen max-w-[1240px] items-center justify-center py-6">
        <div className="grid w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[1.35fr_0.95fr]">
          <section className="rounded-2xl border border-[#274b76]/70 bg-gradient-to-br from-[#0f2f57] via-[#163a63] to-[#274b76] p-6 text-white shadow-[0_28px_70px_rgba(13,34,63,0.35)] ring-1 ring-white/10 lg:p-8">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-xs">
              <Image
                src="/icono.png"
                alt="EQUITAS"
                width={16}
                height={16}
                className="size-3.5 object-contain"
                priority
              />
              Preview institucional
            </div>

            <div className="flex items-center gap-3">
              <span className="inline-flex rounded-xl border border-white/20 bg-white/15 p-2.5">
                <Image
                  src="/icono.png"
                  alt="EQUITAS"
                  width={28}
                  height={28}
                  className="size-7 object-contain"
                  priority
                />
              </span>
              <h1 className="text-4xl font-semibold tracking-tight lg:text-[42px]">EQUITAS</h1>
            </div>
            <p className="mt-2 max-w-lg text-sm text-slate-200/95">
              Centralizacion de deudas, perfiles de riesgo y acciones recomendadas.
            </p>

            <div className="mt-6 rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
              <p className="text-xs font-semibold tracking-wide text-slate-100/90 uppercase">
                Centro operativo
              </p>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {PREVIEW_METRICS.map((metric) => {
                  const Icon = metric.icon

                  return (
                    <div
                      key={metric.label}
                      className="rounded-lg border border-white/20 bg-white/90 p-3 text-slate-900"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold tracking-wide text-slate-600 uppercase">
                          {metric.label}
                        </p>
                        <span className={`rounded-md border p-1.5 ${metric.tone}`}>
                          <Icon className="size-3.5" />
                        </span>
                      </div>
                      <p className="mt-1 text-lg font-semibold text-[#163a63]">{metric.value}</p>
                    </div>
                  )
                })}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-white/20 bg-white/90 p-3 text-slate-900">
                  <p className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
                    Distribucion de riesgo
                  </p>
                  <div className="mt-3 space-y-2.5">
                    {RISK_PREVIEW.map((item) => (
                      <div key={item.label}>
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-700">
                          <span>{item.label}</span>
                          <span>{item.width}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                          <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.width}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-white/20 bg-white/90 p-3 text-slate-900">
                  <p className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
                    Modulos disponibles
                  </p>
                  <ul className="mt-3 space-y-2 text-sm">
                    {PRODUCT_MODULES.map((module) => (
                      <li key={module} className="flex items-start gap-2 text-slate-800">
                        <CheckCircle2 className="mt-0.5 size-4 text-[#2d6a4f]" />
                        <span>{module}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <Card className="border-slate-200/80 bg-white/95 shadow-[0_16px_45px_rgba(15,39,68,0.14)] backdrop-blur">
            <CardHeader>
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#d8c28a] bg-[#f6efdc] px-3 py-1 text-xs font-medium text-[#6f561e]">
                Acceso institucional
              </div>
              <CardTitle className="pt-1 text-2xl text-[#163a63]">Iniciar sesion</CardTitle>
              <p className="text-sm text-slate-600">
                Ingrese con su cuenta institucional.
              </p>
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
