import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const testingUrl = process.env.SUPABASE_TEST_URL
const testingPublishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY
const testingEmail = process.env.SUPABASE_TEST_EMAIL
const testingPassword = process.env.SUPABASE_TEST_PASSWORD
const isTestingEnabled = process.env.SUPABASE_TEST_ENABLED === 'true'
const hasTestingCredentials = Boolean(
  isTestingEnabled &&
    testingUrl &&
    testingPublishableKey &&
    testingEmail &&
    testingPassword
)

const readOnlyTestingProject = hasTestingCredentials ? it : it.skip
const testingProjectTestName = hasTestingCredentials
  ? 'consulta debtor en modo solo lectura con un usuario de testing autenticado'
  : 'omitida: requiere SUPABASE_TEST_ENABLED=true y credenciales exclusivas del proyecto de testing'

describe('integracion real opcional con Supabase de testing', () => {
  readOnlyTestingProject(
    testingProjectTestName,
    async () => {
      const supabase = createClient(testingUrl!, testingPublishableKey!, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      })

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: testingEmail!,
        password: testingPassword!,
      })

      expect(authError).toBeNull()
      expect(authData.user).not.toBeNull()

      try {
        const { data, error } = await supabase.from('debtor').select('id').limit(1)

        expect(error).toBeNull()
        expect(Array.isArray(data)).toBe(true)
      } finally {
        await supabase.auth.signOut()
      }
    },
    20_000
  )

})
