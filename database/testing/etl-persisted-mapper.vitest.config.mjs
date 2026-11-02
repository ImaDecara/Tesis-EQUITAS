// ALIGN-026. Solo para etl_semantic_local.py. Sin imports: vitest se ejecuta desde front/ y esta carpeta no tiene dependencias.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export default {
  root: resolve(here, '../..'),
  resolve: { alias: { '@': resolve(here, '../../front') } },
  test: {
    globals: true,
    environment: 'node',
    dir: here,
    include: ['etl-persisted-mapper.test.ts'],
  },
}
