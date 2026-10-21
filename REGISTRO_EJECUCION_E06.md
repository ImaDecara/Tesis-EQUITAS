# E06 — Supabase aislado, Auth y autorización real

**Fecha:** 21/10/2026. **Responsable:** Axel Azcune (`AxAzc`). **Estado:** implementación y validación local aprobadas; cierre pendiente de la ejecución obligatoria de CI en `main`.

Entrada: E05 publicada en `f93f1648cef29d4d8d71720c98a3971827fc3c91`. Rama: `quality/e06-supabase-testing`. Requisitos R06, R13, R14, R16 y R17. [Procedimiento reproducible](SUPABASE_TESTING_CALIDAD.md).

## Entorno preparado

Se creó **EQUITAS-TP-TESTING**, referencia `iylwghgvtydpmwidojdo`, en la organización Ignacio Magoia elegida por el usuario. Cotización: **USD 0 mensuales**. PostgreSQL 17.11.0.003, us-east-2. Se aplicaron dos migraciones versionadas y se prepararon dos tenants, cuatro cuentas Auth y datos completamente sintéticos.

Las 23 tablas observadas se reconstruyeron con sus 146 columnas y restricciones. Se conservaron inicialmente las políticas permisivas para reproducir el defecto; después se aplicaron políticas por membresía activa, con reglas específicas para relaciones y catálogos. No se agregaron funciones privilegiadas. Se revocó la ejecución pública del event trigger de plataforma, cuando existe. [Historial](evidencias/e06/migrations.json), [catálogo comprobado](evidencias/e06/catalog.json).

La limpieza y recreación se ensayaron exclusivamente sobre las fixtures reservadas. La limpieza dejó Auth, tenants, deudores, personas y moneda en cero; después se reconstruyeron los datos y se renovó el secreto de CI. [Ciclo](evidencias/e06/fixtures-lifecycle.json).

## Defecto real y regresión

| Ejecución | Criterio | Resultado |
| --- | --- | --- |
| Rojo, SUP-RLS-02 con políticas originales | Un usuario Auth normal, con usuario de aplicación pero sin membresía, recibe cero deudores. | **Falló:** devolvió IDs 910001 y 910002, pertenecientes a ambos tenants. Un caso seleccionado; otras 11 variantes no seleccionadas. |
| Verde con políticas corregidas | El mismo criterio y fuente de prueba, con login HTTP real. | **Aprobó:** cero negocio sin membresía; campaña completa 12/12, cero fallidas/omitidas. |

[Comparación y hash de fuente](evidencias/e06/red-green.json), [reporte rojo](evidencias/e06/rls-red.json), [reporte verde](evidencias/e06/real-green.json) y [JUnit](evidencias/e06/real-green.xml). La fuente local estaba en el árbol de implementación E06 basado en E05; la ejecución de CI identifica el SHA publicado exacto. No se presenta el SHA base como si contuviera esos archivos nuevos.

Las 12 variantes cubren diez IDs: Auth válido A/B, credencial inválida, lectura positiva A/B con filas y valores conocidos, anónimo, usuario sin membresía, A→B, B→A, membresía inactiva, logout y escrituras prohibidas. Incluyen nueve tablas de negocio, acceso limitado a usuario/membresía y once catálogos.

Se utiliza la clave `sb_publishable_` y JWT obtenido por el login real. El ensayo ejecuta `validateAuthUserTenantAccess` con ese mismo cliente y el lector productivo `loadAllTableRows`, sin reemplazar módulos o HTTP. Las preparaciones administrativas no se cuentan como integración de aplicación.

## CI, secretos y regresión existente

El comando reproducible es `python quality/supabase_integration.py --config-file .quality/e06/credentials.json --output .quality/e06/nueva-ejecucion`. En CI se usa el secreto `SUPABASE_TEST_CONFIG`, ya configurado. Las suites aisladas se ejecutan sin ese secreto.

El job real se exige en `main`. El resumen rechaza job omitido/fallido, reporte ausente o duplicado, SHA/run/attempt ajenos, variantes incompletas y skips. El comando sin secreto devolvió **1** y conservó el [reporte fallido](evidencias/e06/missing-secret.json). No se degrada a una omisión exitosa.

Validación local: **102 frontend + 61 backend = 163 pruebas aisladas aprobadas**, cero fallidas/omitidas; **48 pruebas de infraestructura** aparte; integración real **12/12**. Build, ESLint, Ruff, actionlint y gates 60/80/5 aprobados. La primera pasada del backend tuvo siete errores de preparación por permisos del temporal de Windows; al fijar `--basetemp` dentro de `.quality/e06/` aprobó 61/61. No fue un fallo de las aserciones de producto. CI usa un runner nuevo.

Cobertura local frontend 788/1.277 sentencias = 61,70 %; backend 1.254/1.471 = 85,25 %. La base fija de código nuevo sigue siendo `531996f51243dc3d4c5a607338e2f35e32313f6b`. OBS-DEP-001 conserva su excepción exacta y vencimiento 26/10/2026; no se corrigió ni prorrogó en E06.

## Alcance por entorno y avisos

**Testing:** DEF-SUP-001 corregido y con regresión real automatizada. **Proyecto original:** conserva las 23 políticas SELECT `USING(true)`; no se modificó. [Revisión actual del original](evidencias/e06/original-policies.json). Por eso **DEF-SUP-001 #1 permanece abierto para el original**. El cierre E06 corresponde a preparar y verificar el entorno aislado, tal como exige el roadmap; no acredita una migración de la cartera real.

Security Advisors de testing conserva un aviso de protección de contraseñas filtradas, función de plan pago; Performance Advisors informa 14 índices todavía sin uso en el dataset pequeño. [Seguridad](evidencias/e06/security.json), [performance](evidencias/e06/performance.json) y tratamiento en el procedimiento. No se infiere capacidad de carga a partir de estos avisos.

Logout prueba la sesión y las siguientes consultas del cliente; no certifica revocación instantánea de JWT previamente copiados. La lectura real de E06 usa una cartera mínima; el volumen/paginación exhaustiva conserva sus regresiones aisladas E03. Navegador y despliegue corresponden a E07; cargas a E08.
