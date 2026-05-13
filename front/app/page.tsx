import { supabase, hasSupabaseCredentials } from '@/lib/supabase'

export default async function Home() {
  if (!hasSupabaseCredentials || !supabase) {
    return (
      <main className="min-h-screen bg-black p-8 text-white">
        <h1 className="text-2xl font-bold">EQUITAS MVP</h1>
        <p>Faltan credenciales de Supabase.</p>
      </main>
    )
  }

  const { data, error } = await supabase
    .from('tenant')
    .select('*')
    .limit(5)

  return (
    <main className="min-h-screen bg-black p-8 text-white">
      <h1 className="text-2xl font-bold">EQUITAS MVP</h1>

      {error && (
        <pre className="mt-4 rounded bg-red-950 p-4 text-red-300">
          {error.message}
        </pre>
      )}

      <pre className="mt-4 rounded bg-zinc-900 p-4 text-green-300">
        {JSON.stringify(data, null, 2)}
      </pre>
    </main>
  )
}