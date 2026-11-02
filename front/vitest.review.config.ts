import { defineConfig } from 'vitest/config'
import { readLocalReviewConfig } from './tests/local-review/config'

// ALIGN-022. Campaña real de autorización del registro de decisiones, solo contra la base local.
// Sin configuración falla acá, antes de crear clientes: la campaña no se omite.
// Procedimiento y runner: tests/external-review/README.md.
readLocalReviewConfig()

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/external-review/**/*.integration.test.ts'],
    allowOnly: false,
    retry: 0,
    fileParallelism: false,
    sequence: { concurrent: false, shuffle: false },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
