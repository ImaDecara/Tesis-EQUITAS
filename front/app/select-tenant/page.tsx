import { TenantSelectionForm } from '@/components/auth/tenant-selection-form'

export default function SelectTenantPage() {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-[#163a63]">Elegir municipio</h1>
      <p className="text-sm text-slate-700">Tu cuenta tiene acceso a más de un municipio. Elegí con cuál vas a trabajar; podés cambiarlo cerrando la sesión.</p>
      <TenantSelectionForm />
    </main>
  )
}
