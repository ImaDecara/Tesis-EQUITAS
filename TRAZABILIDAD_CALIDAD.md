# Trazabilidad de requisitos, casos y defectos — EQUITAS

**Actualización E07, 23/10/2026:** etapa cerrada en Preview de `quality/tp-testing`, SHA `a6497a73b226f9d27abb4e9080d5540503d95539`. [CI](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955381596) aprobado y [smoke automático](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955572523) aprobado sobre el mismo commit y Supabase testing: **168 pruebas aisladas + 12 HTTP reales + 1 recorrido de navegador = 181 de producto**, cero fallidas/omitidas; **55 controles de infraestructura aparte**. El recorrido contiene cinco comprobaciones y valida realmente `/people`, su título y el listado operativo. [Ficha y límites](REGISTRO_EJECUCION_E07.md), [deployment](evidencias/e07/deployment.json), [reporte](evidencias/e07/smoke.json) y [CAS-SMOKE #10](https://github.com/ImaDecara/Tesis-EQUITAS/issues/10). E00–E07 completadas en sus alcances; sigue E08. DEF-SUP-001 permanece abierto en el original y OBS-DEP-001 conserva su vencimiento 26/10/2026. Esta actualización prevalece sobre los estados históricos de despliegue pendiente.

**Corte E06:** 21/10/2026. Responsable: Axel Azcune (`AxAzc`). GitHub Issues y registros versionados. La historia de E05 se conserva separada de los nuevos resultados.

## Seguimiento real por alcance

| Registro | Estado | Alcance |
| --- | --- | --- |
| [DEF-SUP-001 #1](https://github.com/ImaDecara/Tesis-EQUITAS/issues/1) | open | Corregido en testing y con regresión HTTP; original mantiene políticas permisivas y sigue pendiente. |
| [DEF-DAT-001 #2](https://github.com/ImaDecara/Tesis-EQUITAS/issues/2) | closed | Corregido E03 en código/regresión aislada de gran volumen. E06 lee fixtures mínimas con RLS real; E07 sigue pendiente. |
| [OBS-DEP-001 #3](https://github.com/ImaDecara/Tesis-EQUITAS/issues/3) | open | Excepción exacta a cinco altos dev, vence 26/10/2026, no prorrogada. |
| [OBS-COB-001 #4](https://github.com/ImaDecara/Tesis-EQUITAS/issues/4) | closed | Cobertura y gates aprobados E04; regresión E06 mantiene cumplimiento. |
| [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | closed | 42 variantes aisladas preservadas; rojo/verde E03. |
| [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | closed | 20 variantes aisladas, incluida conservación de cliente E06. |
| [CAS-REC #7](https://github.com/ImaDecara/Tesis-EQUITAS/issues/7) | closed | Siete decisiones aisladas preservadas. |
| [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | closed | Controles/gates y nuevas comprobaciones de E06; infraestructura completa 48/48. |
| [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | closed | Campaña HTTP real 12/12 sin omisiones, cerrada en testing; no cierra el original ni despliegue/cargas. |

**Balance:** nueve tickets, siete cerrados y dos abiertos (#1 y #3), todos asignados a `AxAzc`. [Snapshot E06](evidencias/e06/seguimiento-2026-10-21.json).

## Cadenas de evidencia

- R16: SUP-AUTH/DATA/RLS → CAS-EXT #9 → [CI real](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481) → [12 variantes](evidencias/e06/supabase-ci.json).
- R13/R14: SUP-RLS-02 → DEF-SUP-001 #1 → [rojo/verde HTTP](evidencias/e06/red-green.json) → migración de membresía → regresión real. Original conserva estado abierto.
- R-DAT-01: DAT-06 → DEF-DAT-001 #2 → rojo/verde E03 → 42 variantes aisladas. E06 agrega lectura real mínima; no prueba capacidad de gran volumen remoto.
- R07/R08/R09/R17: gates → [base fija y mediciones E06](evidencias/e06/gate-ci.json) → controles de resumen y ejecución CI. OBS-DEP-001 sigue abierto.

## Matriz de los 50 IDs/familias

| ID | Requisitos | Issue | Estado/entorno | Evidencia |
| --- | --- | --- | --- | --- |
| [DAT-01](CASOS_PRUEBA_CALIDAD.md#dat-01) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [DAT-02](CASOS_PRUEBA_CALIDAD.md#dat-02) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [DAT-03](CASOS_PRUEBA_CALIDAD.md#dat-03) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [DAT-04](CASOS_PRUEBA_CALIDAD.md#dat-04) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [DAT-05](CASOS_PRUEBA_CALIDAD.md#dat-05) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [DAT-06](CASOS_PRUEBA_CALIDAD.md#dat-06) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [DAT-07](CASOS_PRUEBA_CALIDAD.md#dat-07) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [DAT-08](CASOS_PRUEBA_CALIDAD.md#dat-08) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [DAT-09](CASOS_PRUEBA_CALIDAD.md#dat-09) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [DAT-10](CASOS_PRUEBA_CALIDAD.md#dat-10) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [DAT-11](CASOS_PRUEBA_CALIDAD.md#dat-11) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [DAT-12](CASOS_PRUEBA_CALIDAD.md#dat-12) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [DAT-13](CASOS_PRUEBA_CALIDAD.md#dat-13) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [DAT-14](CASOS_PRUEBA_CALIDAD.md#dat-14) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [FIXTURE-01](CASOS_PRUEBA_CALIDAD.md#fixture-01) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [comparacion-dat-06.json](evidencias/e03/comparacion-dat-06.json) |
| [AUTH-01](CASOS_PRUEBA_CALIDAD.md#auth-01) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json) |
| [AUTH-02](CASOS_PRUEBA_CALIDAD.md#auth-02) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json) |
| [AUTH-03](CASOS_PRUEBA_CALIDAD.md#auth-03) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json) |
| [AUTH-04](CASOS_PRUEBA_CALIDAD.md#auth-04) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json) |
| [AUTH-05](CASOS_PRUEBA_CALIDAD.md#auth-05) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json) |
| [AUTH-06](CASOS_PRUEBA_CALIDAD.md#auth-06) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json) |
| [AUTH-07](CASOS_PRUEBA_CALIDAD.md#auth-07) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json) |
| [AUTH-08](CASOS_PRUEBA_CALIDAD.md#auth-08) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json) |
| [AUTH-09](CASOS_PRUEBA_CALIDAD.md#auth-09) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json) |
| [REC-01](CASOS_PRUEBA_CALIDAD.md#rec-01) | R-FUN-01, R05, R06 | [CAS-REC #7](https://github.com/ImaDecara/Tesis-EQUITAS/issues/7) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json) |
| [GATE-01](CASOS_PRUEBA_CALIDAD.md#gate-01) | R07 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [gate-normal.json](evidencias/e04/gate-normal.json) |
| [GATE-02](CASOS_PRUEBA_CALIDAD.md#gate-02) | R08 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [gate-normal.json](evidencias/e04/gate-normal.json) |
| [GATE-03](CASOS_PRUEBA_CALIDAD.md#gate-03) | R10 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [gate-normal.json](evidencias/e04/gate-normal.json) |
| [GATE-04](CASOS_PRUEBA_CALIDAD.md#gate-04) | R09 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [gate-normal.json](evidencias/e04/gate-normal.json) |
| [GATE-05](CASOS_PRUEBA_CALIDAD.md#gate-05) | R17 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [gate-normal.json](evidencias/e04/gate-normal.json) |
| [GATE-06](CASOS_PRUEBA_CALIDAD.md#gate-06) | R08, R17 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [gate-normal.json](evidencias/e04/gate-normal.json) |
| [GATE-07](CASOS_PRUEBA_CALIDAD.md#gate-07) | R08 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [gate-normal.json](evidencias/e04/gate-normal.json) |
| [GATE-08](CASOS_PRUEBA_CALIDAD.md#gate-08) | R08 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [gate-normal.json](evidencias/e04/gate-normal.json) |
| [GATE-09](CASOS_PRUEBA_CALIDAD.md#gate-09) | R17 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [gate-normal.json](evidencias/e04/gate-normal.json) |
| [GATE-10](CASOS_PRUEBA_CALIDAD.md#gate-10) | R09, R17 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [gate-normal.json](evidencias/e04/gate-normal.json) |
| [COB-01](CASOS_PRUEBA_CALIDAD.md#cob-01) | R07, R08 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [gate-normal.json](evidencias/e04/gate-normal.json) |
| [AUD-01](CASOS_PRUEBA_CALIDAD.md#aud-01) | R09, R17 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json) |
| [AUD-PROD-01](CASOS_PRUEBA_CALIDAD.md#aud-prod-01) | R09, R17 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [resumen-ci-normal.json](evidencias/e04/resumen-ci-normal.json) |
| [SUP-RLS-01](CASOS_PRUEBA_CALIDAD.md#sup-rls-01) | R06, R13, R14, R16, R17, R-SEG-01, R-SEG-02 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | aprobado HTTP en testing; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo | [supabase-ci.json](evidencias/e06/supabase-ci.json) |
| [SUP-RLS-02](CASOS_PRUEBA_CALIDAD.md#sup-rls-02) | R06, R13, R14, R16, R17, R-SEG-01, R-SEG-02 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | aprobado HTTP en testing; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo | [supabase-ci.json](evidencias/e06/supabase-ci.json) |
| [SUP-DATA-01](CASOS_PRUEBA_CALIDAD.md#sup-data-01) | R-DAT-01, R13 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | detección histórica; corregido en regresión aislada; Supabase conectado, transacción SQL administrativa READ ONLY con ROLLBACK | [supabase-2026-10-21.json](evidencias/supabase-2026-10-21.json) |
| [SUP-INT-01](CASOS_PRUEBA_CALIDAD.md#sup-int-01) | R-INT-01 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | aprobado en alcance SQL; Supabase conectado, transacción SQL administrativa READ ONLY con ROLLBACK | [supabase-2026-10-21.json](evidencias/supabase-2026-10-21.json) |
| [SUP-AUTH-01](CASOS_PRUEBA_CALIDAD.md#sup-auth-01) | R06, R13, R14, R16, R17, R-SEG-01, R-SEG-02 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | aprobado HTTP en testing; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo | [supabase-ci.json](evidencias/e06/supabase-ci.json) |
| [SUP-AUTH-02](CASOS_PRUEBA_CALIDAD.md#sup-auth-02) | R06, R13, R14, R16, R17, R-SEG-01, R-SEG-02 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | aprobado HTTP en testing; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo | [supabase-ci.json](evidencias/e06/supabase-ci.json) |
| [SUP-AUTH-03](CASOS_PRUEBA_CALIDAD.md#sup-auth-03) | R06, R13, R14, R16, R17, R-SEG-01, R-SEG-02 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | aprobado HTTP en testing; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo | [supabase-ci.json](evidencias/e06/supabase-ci.json) |
| [SUP-DATA-02](CASOS_PRUEBA_CALIDAD.md#sup-data-02) | R06, R13, R14, R16, R17, R-SEG-01, R-SEG-02 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | aprobado HTTP en testing; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo | [supabase-ci.json](evidencias/e06/supabase-ci.json) |
| [SUP-RLS-03](CASOS_PRUEBA_CALIDAD.md#sup-rls-03) | R06, R13, R14, R16, R17, R-SEG-01, R-SEG-02 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | aprobado HTTP en testing; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo | [supabase-ci.json](evidencias/e06/supabase-ci.json) |
| [SUP-RLS-04](CASOS_PRUEBA_CALIDAD.md#sup-rls-04) | R06, R13, R14, R16, R17, R-SEG-01, R-SEG-02 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | aprobado HTTP en testing; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo | [supabase-ci.json](evidencias/e06/supabase-ci.json) |
| [SUP-RLS-05](CASOS_PRUEBA_CALIDAD.md#sup-rls-05) | R06, R13, R14, R16, R17, R-SEG-01, R-SEG-02 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | aprobado HTTP en testing; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo | [supabase-ci.json](evidencias/e06/supabase-ci.json) |
| [SUP-WRITE-01](CASOS_PRUEBA_CALIDAD.md#sup-write-01) | R06, R13, R14, R16, R17, R-SEG-01, R-SEG-02 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | aprobado HTTP en testing; GitHub Actions Ubuntu 24.04 → Supabase cloud iylwghgvtydpmwidojdo | [supabase-ci.json](evidencias/e06/supabase-ci.json) |

## Recorrido de revisión

1. Abrir la ficha y su contexto: precondiciones, entrada, pasos, esperado/obtenido y selector.
2. Abrir el Issue y comprobar su estado por entorno; un cierre en testing no cierra el proyecto original.
3. Abrir el SHA/run y el inventario del reporte; comparar el mismo caso rojo/verde cuando corresponda.
4. Separar SQL histórico, pruebas aisladas, HTTP real y tareas futuras E07/E08.

El [inventario actual](calidad/inventario-pruebas.json) conserva 175 resultados de producto aprobados (163 aislados y 12 reales) y 48 de infraestructura. El [corte E05](evidencias/e05/inventario-pruebas-corte-e05.json) conserva 162 aprobados/1 omitido y 41 controles; los paths de ese corte se interpretan en su SHA histórico. Los 50 IDs del catálogo agrupan variantes y no son 50 pruebas nuevas.

## Trazabilidad E07

| Requisitos | Caso | Evidencia | Alcance |
| --- | --- | --- | --- |
| R17, R19, R24, R25 | [DEP-01](CASOS_PRUEBA_CALIDAD.md#dep-01) / [#10](https://github.com/ImaDecara/Tesis-EQUITAS/issues/10) | [Reporte](evidencias/e07/resumen-ci.json), [CI](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955381596) | Unidad; 5 variante(s) |
| R17, R19, R24, R25 | [DEP-02](CASOS_PRUEBA_CALIDAD.md#dep-02) / [#10](https://github.com/ImaDecara/Tesis-EQUITAS/issues/10) | [Reporte](evidencias/e07/resumen-ci.json), [CI](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955381596) | Infraestructura; 7 variante(s) |
| R17, R19, R24, R25 | [SMOKE-01](CASOS_PRUEBA_CALIDAD.md#smoke-01) / [#10](https://github.com/ImaDecara/Tesis-EQUITAS/issues/10) | [Reporte](evidencias/e07/smoke.json), [CI](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955572523) | Sistema / navegador / integración real; 1 variante(s) |

El smoke valida fixtures mínimas A/B y navegación desplegada; la regresión de gran volumen de DEF-DAT-001 permanece en E03. No demuestra carga ni autorización del proyecto original.

R19 / interacción de filtro → SMOKE-01 / CAS-SMOKE #10 → DEF-UI-001 #11 → rojo manual en `0e4e84a` → corrección `a6497a7` → verde automático 39955572523 y regresión conservada.
