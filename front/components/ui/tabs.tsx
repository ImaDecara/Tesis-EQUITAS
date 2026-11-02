'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

type TabsContextValue = {
  baseId: string
  value: string
  setValue: (value: string) => void
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabsContext() {
  const context = React.useContext(TabsContext)

  if (!context) {
    throw new Error('Tabs components must be used inside <Tabs />')
  }

  return context
}

type TabsProps = {
  value?: string
  defaultValue: string
  onValueChange?: (value: string) => void
  className?: string
  children: React.ReactNode
}

function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  children,
}: TabsProps) {
  // Soporta uso controlado y no controlado.
  const [internalValue, setInternalValue] = React.useState(defaultValue)
  const selectedValue = value ?? internalValue
  const baseId = React.useId()

  const handleValueChange = React.useCallback(
    (nextValue: string) => {
      if (!value) {
        setInternalValue(nextValue)
      }

      onValueChange?.(nextValue)
    },
    [onValueChange, value]
  )

  return (
    <TabsContext.Provider value={{ baseId, value: selectedValue, setValue: handleValueChange }}>
      <div className={cn('w-full', className)}>{children}</div>
    </TabsContext.Provider>
  )
}

// Patron de pestañas de ARIA: flechas, Inicio y Fin. La pestaña elegida se activa al llegar.
export function moveTabFocus(event: React.KeyboardEvent<HTMLDivElement>) {
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const current = tabs.indexOf(event.target as HTMLButtonElement)
  if (current < 0) return
  const destinations: Record<string, number> = {
    ArrowRight: (current + 1) % tabs.length,
    ArrowLeft: (current - 1 + tabs.length) % tabs.length,
    Home: 0,
    End: tabs.length - 1,
  }
  if (!(event.key in destinations)) return
  event.preventDefault()
  tabs[destinations[event.key]].focus()
  tabs[destinations[event.key]].click()
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      role="tablist"
      onKeyDown={moveTabFocus}
      className={cn(
        'inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg bg-[#edf2f8] p-1 text-slate-600',
        className
      )}
      {...props}
    />
  )
}

type TabsTriggerProps = React.ComponentProps<'button'> & {
  value: string
}

function TabsTrigger({ className, value, children, ...props }: TabsTriggerProps) {
  const context = useTabsContext()
  const isActive = context.value === value

  return (
    <button
      type="button"
      role="tab"
      id={`${context.baseId}-tab-${value}`}
      aria-selected={isActive}
      aria-controls={isActive ? `${context.baseId}-panel-${value}` : undefined}
      tabIndex={isActive ? 0 : -1}
      data-state={isActive ? 'active' : 'inactive'}
      onClick={() => context.setValue(value)}
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#163a63]',
        'data-[state=active]:bg-white data-[state=active]:text-[#163a63] data-[state=active]:shadow-sm',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

type TabsContentProps = React.ComponentProps<'div'> & {
  value: string
}

function TabsContent({ className, value, ...props }: TabsContentProps) {
  const context = useTabsContext()

  // Mantiene simple la interfaz: solo renderiza el contenido activo.
  if (context.value !== value) {
    return null
  }

  return (
    <div
      role="tabpanel"
      id={`${context.baseId}-panel-${value}`}
      aria-labelledby={`${context.baseId}-tab-${value}`}
      className={cn('mt-4', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
