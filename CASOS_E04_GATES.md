# E04 — Criterios de aceptación de los quality gates

Fecha: 21/10/2026. Responsable: Axel Azcune. Entrada: E03, `085c4759b03812451616cfc5cbf8d3507b4b1b2f`. Requisitos R07–R10/R17. Estos criterios se fijan antes de ejecutar la verificación final.

Base fija del producto: **531996f51243dc3d4c5a607338e2f35e32313f6b**. Alcance sin recortes: frontend `app`, `components`, `lib` (TypeScript/TSX salvo declaraciones); backend `ETL`, `api`, `services` (Python). Pruebas y scripts de infraestructura se informan separados del producto.

| ID | Entrada / condición | Resultado esperado |
| --- | --- | --- |
| GATE-01 | Sentencias 59,99 % / 60 %, por módulo. | Rechazar / aprobar ese control, con numeradores y denominadores válidos. |
| GATE-02 | Líneas ejecutables nuevas 79,99 % / 80 %. | Rechazar / aprobar ese control, usando diff contra la base fija e intersección con cobertura. |
| GATE-03 | Duplicación por líneas 5 % / 5,01 %. | Aprobar / rechazar. No comparar porcentajes redondeados ni tokens. |
| GATE-04 | Hallazgo de regla crítica / hallazgo de estilo. | El crítico bloquea y aparece clasificado; estilo bloquea análisis sin inventar severidad crítica nativa. |
| GATE-05 | Reporte ausente, JSON roto, tipos inválidos, archivo de cobertura ausente o denominador incongruente. | Rechazar y conservar explicación/reporte. |
| GATE-06 | Base irresoluble o cambiada a HEAD; reportes de otro SHA/run/intento. | Rechazar. No vaciar el diff para aprobar. |
| GATE-07 | No hay líneas nuevas ejecutables en un módulo. | «No aplica», 0 líneas nuevas, porcentaje nulo; los reportes válidos siguen siendo obligatorios. |
| GATE-08 | Archivo nuevo, archivo eliminado/renombrado, separadores Windows/Linux. | Incluir archivos nuevos; eliminados no suman. Renombre tratado como eliminación y alta completa (`--no-renames`). Rutas equivalentes mapean al mismo archivo. |
| GATE-09 | Control requerido ausente o salida distinta de cero. | Bloquear el resultado global aunque otras métricas aprueben. |
| GATE-10 | CI normal / ensayo manual con hallazgo crítico sintético en el reporte. | CI normal aprobado; ensayo fallido en el job resumen, con gate y artefactos conservados. El ensayo se declara controlado y no sustituye el defecto real E03. |
| COB-01 | Ampliación de pruebas de autenticación y recomendaciones. | Casos significativos aprobados, mínimo frontend 60 %, mismo alcance y método Vitest 4. |

Clasificador versionado en `quality/gate-policy.json`: ESLint `constructor-super`, `no-unreachable`, `no-unsafe-finally`, y errores de parsing; Ruff `F821`, `F822`, `F823`, `invalid-syntax`. Son reglas elegidas por el proyecto para detectar fallos estructurales/de ejecución. No garantizan detectar todos los defectos ni certificar autorización RLS. Los demás errores/advertencias no aceptados también bloquean análisis. Dependencias se evalúan aparte con la política de E02 y su vencimiento, manteniendo las salidas originales.

Las nuevas pruebas Auth son aisladas con dobles; no prueban RLS remoto ni completan E06. Las recomendaciones cubren precedencia y límites 59/60 días y 349.999/350.000. Los resultados y enlaces de CI se incorporarán al registro de ejecución E04 después de verificarlos.
