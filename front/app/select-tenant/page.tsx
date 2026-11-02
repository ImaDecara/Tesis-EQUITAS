import { TenantSelectionForm } from '@/components/auth/tenant-selection-form'

export default function SelectTenantPage() {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Seleccionar municipio</h1>
      <p>Elegí el municipio con el que vas a trabajar.</p>
      <TenantSelectionForm />
    </main>
  )
}
