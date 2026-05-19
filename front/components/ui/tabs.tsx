'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

type TabsContextValue = {
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
    <TabsContext.Provider value={{ value: selectedValue, setValue: handleValueChange }}>
      <div className={cn('w-full', className)}>{children}</div>
    </TabsContext.Provider>
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'inline-flex h-10 items-center rounded-lg bg-slate-100 p-1 text-slate-600',
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
      data-state={isActive ? 'active' : 'inactive'}
      onClick={() => context.setValue(value)}
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium transition',
        'data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm',
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

  return <div className={cn('mt-4', className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
