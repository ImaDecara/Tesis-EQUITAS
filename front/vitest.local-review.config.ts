import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { readLocalReviewConfig } from './tests/local-review/config'

// ALIGN-020. Prueba real contra la base local: fuera de las suites aisladas y de los gates,
// porque necesita el stack y un turno. Procedimiento en tests/local-review/README.md.
const config = readLocalReviewConfig()

export default defineConfig({
  resolve: { alias: { 'server-only': fileURLToPath(new URL('./node_modules/next/dist/compiled/server-only/empty.js', import.meta.url)) } },
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    // `http` necesita un `next start` con la sonda: ver el README.
    include: [process.env.EQUITAS_REVIEW_SUITE === 'http' ? 'tests/local-review/**/*.http.ts' : 'tests/local-review/**/*.local.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
      EQUITAS_REVIEW_SERVER_JWT: config.reviewJwt,
    },
  },
})
