import Link from 'next/link'

import { AppShell } from '@/components/layout/app-shell'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Pantalla amigable cuando falta el id del objeto de deuda o no es visible para el rol actual.
export default function NotFound() {
  return (
    <AppShell>
      <div className="mx-auto mt-8 max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Objeto de deuda no encontrado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              El registro solicitado no existe o no está visible con el rol actual.
            </p>
            <Link href="/debtors" className={buttonVariants()}>
              Volver al listado
            </Link>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
