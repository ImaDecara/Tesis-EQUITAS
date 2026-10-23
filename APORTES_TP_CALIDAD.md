# Aportes trazables del TP — EQUITAS

Corte: `930f807e3d6c8d12c6e8a25f84e4d21a4c105755`, anterior a la formalización E05. Fuente: autores, mensajes y archivos del historial Git local del repositorio publicado. Se registran ejemplos verificables; no se atribuye trabajo a partir de una asignación futura.

| Autor registrado en Git | Commit | Mensaje real | Archivos/cambio observable |
| --- | --- | --- | --- |
| Ignacio Magoia | [531996f](https://github.com/ImaDecara/Tesis-EQUITAS/commit/531996f51243dc3d4c5a607338e2f35e32313f6b) | subo | `.gitignore`, `CALIDAD_SOFTWARE_INTEGRACION.md`, `CALIDAD_SOFTWARE_PRUEBAS.md`, `INFORME_TP_CALIDAD_SOFTWARE.md`; 32 archivos en el commit. |
| Ignacio Magoia | [21c7f5e](https://github.com/ImaDecara/Tesis-EQUITAS/commit/21c7f5e46d79f3f117c929edf2b6aab4bbdf7160) | cambie el front | `front/app/debt-aging/page.tsx`, `front/app/debtors/page.tsx`, `front/app/login/page.tsx`, `front/app/no-contact/page.tsx`; 16 archivos en el commit. |
| Imanol Decara | [ed074f5](https://github.com/ImaDecara/Tesis-EQUITAS/commit/ed074f570bc50d5297053c6a65b02c4c47148556) | Back Final para MVP | `back/ETL/transform.py`, `back/api/main.py`, `back/requirements.txt`, `back/services/scoring_service.py`. |
| Imanol Decara | [12c52e4](https://github.com/ImaDecara/Tesis-EQUITAS/commit/12c52e4a5da7da2c77b4e228e9a29b838c13bdcc) | ETL Final | `back/ETL/export_preview.py`, `back/ETL/extract.py`, `back/ETL/load.py`, `back/ETL/run_etl.py`; 5 archivos en el commit. |
| Axel | [d4e6164](https://github.com/ImaDecara/Tesis-EQUITAS/commit/d4e61644298b18f790a9effb3b8a38472f988698) | docs(calidad): registrar diagnostico, evidencias y roadmap del TP | `.gitignore`, `CALIDAD_SOFTWARE_INTEGRACION.md`, `DIAGNOSTICO_CIERRE_CALIDAD.md`, `INFORME_TP_CALIDAD_SOFTWARE.md`; 13 archivos en el commit. |
| Axel | [c95a9ab](https://github.com/ImaDecara/Tesis-EQUITAS/commit/c95a9ab4adcd0d342fc30ca9fe7c4d75109bca44) | feat(calidad): aplicar gates de cobertura duplicacion y criticos | `.github/workflows/quality-ci.yml`, `CASOS_E04_GATES.md`, `ROADMAP_TP_CALIDAD_SOFTWARE.md`, `front/eslint.config.mjs`; 13 archivos en el commit. |
| Axel | [3bfe156](https://github.com/ImaDecara/Tesis-EQUITAS/commit/3bfe15688a72360b336b7d8732867c6991a1d42e) | fix: recuperar la cartera completa con paginacion por id | `front/lib/data/paginated-table-reader.ts`, `front/lib/data/raw-debtor-loader.ts`, `front/lib/services/person-data-service.ts`, `front/tests/fixtures/paginated-supabase.ts`; 7 archivos en el commit. |

Ignacio Magoia figura como autor de cambios de frontend y de las suites/documentación del checkpoint de producto recibido; Imanol Decara, de cambios ETL/backend; Axel, de los checkpoints y controles de calidad E00–E04 mostrados. El responsable nominal de continuidad es Axel Azcune (`AxAzc`), según el plan y la identidad de GitHub consultada. Los nombres de autor se conservan tal como figuran en Git.

La [evidencia de historial](evidencias/e05/aportes-historial.json) guarda SHA completo, fecha de autor, mensaje y lista completa de archivos. Los merges y el número de commits no se usan para medir esfuerzo, calidad o reparto porcentual. Los datos académicos personales pendientes y la defensa individual se completan en E10/E11.

## Continuidad E07, 23/10/2026

Axel: `c7256da` implementa el smoke y workflow; `4906c9b` verifica rama/destino; `348f446` exige URL/título de personas; `0e4e84a` acota la validación a la tabla operativa e importe. Configuración del Preview aislado, ejecución automática y evidencias en la ficha E07. Son cambios comprobables en Git y Actions; no una estimación de porcentajes de aporte.

`a6497a7` (Axel): corrige DEF-UI-001, restableciendo el formulario al cambiar filtros y agregando la aserción de campo vacío al smoke.

## Continuidad E08, 23/10/2026

Axel: `09f040b` fija criterios antes de ejecutar; `f52c5ac` implementa entorno sintético y generador; `de29fd0` corrige arranque del proceso Windows; `fee7a71` agrega workflow/adopción y `f6f83f9` ajusta el análisis previo de imports. Campañas y reportes nuevos vinculados al SHA en la ficha E08.
