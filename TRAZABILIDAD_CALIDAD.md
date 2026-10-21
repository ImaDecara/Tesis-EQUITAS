# Trazabilidad de requisitos, casos y defectos — EQUITAS

**Corte E05:** 21/10/2026. Responsable: Axel Azcune (`AxAzc`). Soporte: GitHub Issues y archivos versionados. Las fechas de alta de los tickets son de formalización; los casos conservan sus criterios y ejecuciones E03/E04 o la inspección SQL original.

## Requisitos de comportamiento

Los R01–R25 corresponden a la matriz de la consigna del roadmap. Se conservan los identificadores de comportamiento usados en las pruebas: **R-DAT-01**, cartera autorizada completa; **R-SEG-01**, pertenencia activa para acceso de negocio; **R-SEG-02**, lectura anónima denegada; **R-FUN-01**, recomendaciones según reglas de riesgo/mora/contacto; **R-INT-01**, integridad de los controles de carga seleccionados. Un caso aislado contribuye al contrato que indica su entorno y no aprueba por sí solo la integración remota.

## Seguimiento real en GitHub

| Registro | Tipo | Estado comprobado | Alcance / siguiente acción |
| --- | --- | --- | --- |
| [DEF-SUP-001 #1](https://github.com/ImaDecara/Tesis-EQUITAS/issues/1) | Defecto autorización | open | Reproducido SQL; corregir y validar por cliente normal en testing E06. |
| [DEF-DAT-001 #2](https://github.com/ImaDecara/Tesis-EQUITAS/issues/2) | Defecto datos | closed | Cerrado en código/regresión aislada de ambas rutas. Validación de aplicación/despliegue sigue en E06/E07. |
| [OBS-DEP-001 #3](https://github.com/ImaDecara/Tesis-EQUITAS/issues/3) | Observación dependencias | open | Abierta, excepción temporal exacta; revisar antes del 26/10/2026. No se prorrogó. |
| [OBS-COB-001 #4](https://github.com/ImaDecara/Tesis-EQUITAS/issues/4) | Observación cumplimiento | closed | Mínimo y gates satisfechos E04; reabrir ante regresión real. |
| [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | Grupo de casos | closed | DAT-01–14 y FIXTURE-01: 42 variantes aprobadas; mantiene rojo/verde E03. |
| [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | Grupo de casos | closed | AUTH-01–09: 19 variantes con dobles; no certifica RLS remoto. |
| [CAS-REC #7](https://github.com/ImaDecara/Tesis-EQUITAS/issues/7) | Grupo de casos | closed | REC-01: siete filas de decisión aprobadas. |
| [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | Grupo de casos | closed | Contratos/mediciones aprobados; el riesgo OBS-DEP-001 conserva su issue abierto. |
| [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | Campaña externa | open | SQL histórico separado; Auth/HTTP omitido o pendiente; cerrar solo con testing y datos conocidos E06. |

**Balance:** nueve tickets reales, seis cerrados en su alcance y tres abiertos. Todos asignados a `AxAzc`. [Snapshot con cuerpos, estados, timestamps y hashes](evidencias/e05/seguimiento-2026-10-21.json). El inventario previo no contenía issues. No se presentan tickets de Jira.

## Cadenas de trazabilidad principales

| Requisito | Caso y ticket de gestión | Esperado / obtenido y evidencia | Defecto / tratamiento | Corrección y regresión |
| --- | --- | --- | --- | --- |
| R-DAT-01; R13/R14 | [DAT-06](CASOS_PRUEBA_CALIDAD.md#dat-06), [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | 3.507 esperadas; rojo recupera 1.000/3.000, verde 3.507 sin omisiones/duplicados. [Comparación](evidencias/e03/comparacion-dat-06.json). | [DEF-DAT-001 #2](https://github.com/ImaDecara/Tesis-EQUITAS/issues/2), cerrado en código/aislado. | `3bfe156…`; [rojo](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39672114249) / [verde](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642). Regresión mantenida [E04](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195). |
| R-SEG-01; R13/R16 | [SUP-RLS-02](CASOS_PRUEBA_CALIDAD.md#sup-rls-02), [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | Esperado 0; SQL devolvió 2.933 objetos, 56.286 deudas, 2.493 personas sin pertenencia. [Snapshot](evidencias/supabase-2026-10-21.json). | [DEF-SUP-001 #1](https://github.com/ImaDecara/Tesis-EQUITAS/issues/1), abierto/reproducido. | Corrección y regresión HTTP pendientes E06; el SQL no produjo JWT ni cuenta nueva. |
| R07/R08 | [COB-01](CASOS_PRUEBA_CALIDAD.md#cob-01), [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | Frontend 791/1.280 (Vitest 61,79 %), nuevo frontend 28/28 y backend 15/17. [Gate](evidencias/e04/gate-normal.json). | [OBS-COB-001 #4](https://github.com/ImaDecara/Tesis-EQUITAS/issues/4), cerrado E04. | `c95a9ab…`, pruebas Auth/REC y suite del gate; [CI aprobado](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195). |
| R09/R17, dependencias | [AUD-01](CASOS_PRUEBA_CALIDAD.md#aud-01) y [AUD-PROD-01](CASOS_PRUEBA_CALIDAD.md#aud-prod-01), [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | Cinco altos dev, cero críticos/productivos, salidas crudas 1/0; política temporal aceptada. [E04](evidencias/e04/resumen-ci-normal.json). | [OBS-DEP-001 #3](https://github.com/ImaDecara/Tesis-EQUITAS/issues/3), abierto. | Mantener contratos de la política; corregir cadena y verificar lint/regresión antes del cierre. |
| R-FUN-01; R05/R06 | [REC-01](CASOS_PRUEBA_CALIDAD.md#rec-01), [CAS-REC #7](https://github.com/ImaDecara/Tesis-EQUITAS/issues/7) | Siete decisiones con resultados exactos, límites 59/60 y 349.999/350.000. | Sin defecto nuevo por este caso. | [Prueba](front/tests/unit/recommendation-decisions.test.ts), `c95a9ab…`; [E04](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39677574195). |
| R-SEG-01 (contrato aislado) | [AUTH-05–09](CASOS_PRUEBA_CALIDAD.md#auth-05), [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | Rechazo ante sesión/ID/pertenencia inválidos; contexto exacto para pertenencia activa. | No corrige ni valida DEF-SUP-001 remoto. | [Prueba](front/tests/unit/auth-service.test.ts), 19 variantes aprobadas E04. |

## Matriz por caso seleccionado

| Caso | Requisito(s) | Seguimiento | Resultado y entorno | Código / siguiente implementación |
| --- | --- | --- | --- | --- |
| [DAT-01](CASOS_PRUEBA_CALIDAD.md#dat-01) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [DAT-02](CASOS_PRUEBA_CALIDAD.md#dat-02) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [DAT-03](CASOS_PRUEBA_CALIDAD.md#dat-03) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [DAT-04](CASOS_PRUEBA_CALIDAD.md#dat-04) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [DAT-05](CASOS_PRUEBA_CALIDAD.md#dat-05) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [DAT-06](CASOS_PRUEBA_CALIDAD.md#dat-06) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [DAT-07](CASOS_PRUEBA_CALIDAD.md#dat-07) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [DAT-08](CASOS_PRUEBA_CALIDAD.md#dat-08) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [DAT-09](CASOS_PRUEBA_CALIDAD.md#dat-09) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [DAT-10](CASOS_PRUEBA_CALIDAD.md#dat-10) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [DAT-11](CASOS_PRUEBA_CALIDAD.md#dat-11) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [DAT-12](CASOS_PRUEBA_CALIDAD.md#dat-12) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [DAT-13](CASOS_PRUEBA_CALIDAD.md#dat-13) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [DAT-14](CASOS_PRUEBA_CALIDAD.md#dat-14) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [FIXTURE-01](CASOS_PRUEBA_CALIDAD.md#fixture-01) | R-DAT-01, R05, R06, R13, R14 | [CAS-DAT #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [complete-data.integration.test.ts](front/tests/integration/complete-data.integration.test.ts) |
| [AUTH-01](CASOS_PRUEBA_CALIDAD.md#auth-01) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [auth-service.test.ts](front/tests/unit/auth-service.test.ts) |
| [AUTH-02](CASOS_PRUEBA_CALIDAD.md#auth-02) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [auth-service.test.ts](front/tests/unit/auth-service.test.ts) |
| [AUTH-03](CASOS_PRUEBA_CALIDAD.md#auth-03) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [auth-service.test.ts](front/tests/unit/auth-service.test.ts) |
| [AUTH-04](CASOS_PRUEBA_CALIDAD.md#auth-04) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [auth-service.test.ts](front/tests/unit/auth-service.test.ts) |
| [AUTH-05](CASOS_PRUEBA_CALIDAD.md#auth-05) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [auth-service.test.ts](front/tests/unit/auth-service.test.ts) |
| [AUTH-06](CASOS_PRUEBA_CALIDAD.md#auth-06) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [auth-service.test.ts](front/tests/unit/auth-service.test.ts) |
| [AUTH-07](CASOS_PRUEBA_CALIDAD.md#auth-07) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [auth-service.test.ts](front/tests/unit/auth-service.test.ts) |
| [AUTH-08](CASOS_PRUEBA_CALIDAD.md#auth-08) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [auth-service.test.ts](front/tests/unit/auth-service.test.ts) |
| [AUTH-09](CASOS_PRUEBA_CALIDAD.md#auth-09) | R-SEG-01, R05, R06 | [CAS-AUTH #6](https://github.com/ImaDecara/Tesis-EQUITAS/issues/6) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [auth-service.test.ts](front/tests/unit/auth-service.test.ts) |
| [REC-01](CASOS_PRUEBA_CALIDAD.md#rec-01) | R-FUN-01, R05, R06 | [CAS-REC #7](https://github.com/ImaDecara/Tesis-EQUITAS/issues/7) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [recommendation-decisions.test.ts](front/tests/unit/recommendation-decisions.test.ts) |
| [GATE-01](CASOS_PRUEBA_CALIDAD.md#gate-01) | R07 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [test_gates.py](quality/tests/test_gates.py) |
| [GATE-02](CASOS_PRUEBA_CALIDAD.md#gate-02) | R08 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [test_gates.py](quality/tests/test_gates.py) |
| [GATE-03](CASOS_PRUEBA_CALIDAD.md#gate-03) | R10 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [test_gates.py](quality/tests/test_gates.py) |
| [GATE-04](CASOS_PRUEBA_CALIDAD.md#gate-04) | R09 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [test_gates.py](quality/tests/test_gates.py) |
| [GATE-05](CASOS_PRUEBA_CALIDAD.md#gate-05) | R17 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [test_gates.py](quality/tests/test_gates.py) |
| [GATE-06](CASOS_PRUEBA_CALIDAD.md#gate-06) | R08, R17 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [test_gates.py](quality/tests/test_gates.py) |
| [GATE-07](CASOS_PRUEBA_CALIDAD.md#gate-07) | R08 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [test_gates.py](quality/tests/test_gates.py) |
| [GATE-08](CASOS_PRUEBA_CALIDAD.md#gate-08) | R08 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [test_gates.py](quality/tests/test_gates.py) |
| [GATE-09](CASOS_PRUEBA_CALIDAD.md#gate-09) | R17 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [test_gates.py](quality/tests/test_gates.py) |
| [GATE-10](CASOS_PRUEBA_CALIDAD.md#gate-10) | R09, R17 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [test_gates.py](quality/tests/test_gates.py) |
| [COB-01](CASOS_PRUEBA_CALIDAD.md#cob-01) | R07, R08 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [gates.py](quality/gates.py) |
| [AUD-01](CASOS_PRUEBA_CALIDAD.md#aud-01) | R09, R17 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [audit_policy.py](quality/audit_policy.py) |
| [AUD-PROD-01](CASOS_PRUEBA_CALIDAD.md#aud-prod-01) | R09, R17 | [CAS-GATE #8](https://github.com/ImaDecara/Tesis-EQUITAS/issues/8) | aprobado; GitHub Actions Ubuntu 24.04, aislado | [audit_policy.py](quality/audit_policy.py) |
| [SUP-RLS-01](CASOS_PRUEBA_CALIDAD.md#sup-rls-01) | R-SEG-02 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | aprobado en alcance SQL; Supabase conectado, transacción SQL administrativa READ ONLY con ROLLBACK | [verificacion_supabase_solo_lectura.sql](database/verificacion_supabase_solo_lectura.sql) |
| [SUP-RLS-02](CASOS_PRUEBA_CALIDAD.md#sup-rls-02) | R-SEG-01, R13 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | fallido en alcance SQL; HTTP pendiente E06; Supabase conectado, transacción SQL administrativa READ ONLY con ROLLBACK | [verificacion_supabase_solo_lectura.sql](database/verificacion_supabase_solo_lectura.sql) |
| [SUP-DATA-01](CASOS_PRUEBA_CALIDAD.md#sup-data-01) | R-DAT-01, R13 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | detección histórica; corregido en regresión aislada; Supabase conectado, transacción SQL administrativa READ ONLY con ROLLBACK | [verificacion_supabase_solo_lectura.sql](database/verificacion_supabase_solo_lectura.sql) |
| [SUP-INT-01](CASOS_PRUEBA_CALIDAD.md#sup-int-01) | R-INT-01 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | aprobado en alcance SQL; Supabase conectado, transacción SQL administrativa READ ONLY con ROLLBACK | [verificacion_supabase_solo_lectura.sql](database/verificacion_supabase_solo_lectura.sql) |
| [SUP-AUTH-01](CASOS_PRUEBA_CALIDAD.md#sup-auth-01) | R16, R-SEG-01 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | omitido; implementación E06 parcial; GitHub Actions Ubuntu 24.04, aislado | [supabase-testing.integration.test.ts](front/tests/integration/supabase-testing.integration.test.ts) |
| [SUP-AUTH-02](CASOS_PRUEBA_CALIDAD.md#sup-auth-02) | R16, R-SEG-01 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | pendiente; testing sin ejecutar | Pendiente E06 |
| [SUP-AUTH-03](CASOS_PRUEBA_CALIDAD.md#sup-auth-03) | R16, R-SEG-01 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | pendiente; testing sin ejecutar | Pendiente E06 |
| [SUP-DATA-02](CASOS_PRUEBA_CALIDAD.md#sup-data-02) | R16, R-SEG-01 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | pendiente; testing sin ejecutar | Pendiente E06 |
| [SUP-RLS-03](CASOS_PRUEBA_CALIDAD.md#sup-rls-03) | R16, R-SEG-01 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | pendiente; testing sin ejecutar | Pendiente E06 |
| [SUP-RLS-04](CASOS_PRUEBA_CALIDAD.md#sup-rls-04) | R16, R-SEG-01 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | pendiente; testing sin ejecutar | Pendiente E06 |
| [SUP-RLS-05](CASOS_PRUEBA_CALIDAD.md#sup-rls-05) | R16, R-SEG-01 | [CAS-EXT #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9) | pendiente; testing sin ejecutar | Pendiente E06 |

## Cómo recorrer una evidencia

1. Abrir el requisito/caso de la matriz y consultar su entrada, esperado/obtenido y selector.
2. Abrir su issue y el defecto relacionado, comprobando estado y alcance.
3. Abrir el SHA y el run enlazados; verificar el caso en el reporte original o en el inventario extraído de ese reporte.
4. Para DEF-DAT-001, comparar las mismas aserciones del rojo y del verde. Para cobertura, revisar numeradores/denominadores y base fija en gate.json.
5. Para un pendiente, seguir la acción de E06 o la corrección de dependencias; no usar el estado cerrado de otro grupo como aprobación de ese trabajo.

Los 49 IDs de caso/familia no son el total de pruebas. El [inventario](calidad/inventario-pruebas.json) conserva 163 resultados de producto (162 aprobados y uno omitido) y 41 de infraestructura. Los criterios de cada caso apuntan al contexto ejecutado; las ampliaciones futuras conservan estado pendiente.
