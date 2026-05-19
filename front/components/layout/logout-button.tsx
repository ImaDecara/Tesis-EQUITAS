'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { signOutCurrentSession } from '@/lib/services/auth-service'

export function LogoutButton() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  async function handleLogout() {
    setIsLoading(true)
    await signOutCurrentSession()
    router.replace('/login')
    router.refresh()
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleLogout}
      disabled={isLoading}
      className="h-8"
    >
      <LogOut className="size-3.5" />
      {isLoading ? 'Saliendo...' : 'Cerrar sesión'}
    </Button>
  )
}
