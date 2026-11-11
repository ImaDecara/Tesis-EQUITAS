import Link from 'next/link'

import { AppShell } from '@/components/layout/app-shell'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Cuando el caso pedido no existe o no es de tu municipio. No distingue entre ambos: no revela casos ajenos.
export default function NotFound() {
  return (
    <AppShell>
      <div className="mx-auto mt-8 max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>No encontramos ese caso</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              El caso no existe en la cartera de tu municipio o el enlace está incompleto. Buscalo en el listado.
            </p>
            <Link href="/debtors" className={buttonVariants()}>
              Ir a Casos
            </Link>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
