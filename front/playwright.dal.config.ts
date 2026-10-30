import { defineConfig } from '@playwright/test'
import { readLocalDalConfig } from './tests/local-dal/config'

const config = readLocalDalConfig() // Guardia antes de arrancar Next o abrir conexiones.
export default defineConfig({
  testDir: './tests/local-dal',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 120_000,
  outputDir: '/tmp/equitas-align019-http-results',
  reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:31019', trace: 'off', screenshot: 'off', video: 'off' },
  webServer: {
    command: 'npm run build && npm run start -- --hostname 127.0.0.1 --port 31019',
    url: 'http://127.0.0.1:31019/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishableKey, NEXT_TELEMETRY_DISABLED: '1' },
  },
})
