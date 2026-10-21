# E06 — Supabase de testing y autorización

Fecha: 21/10/2026. Responsable: Axel Azcune. Entorno independiente de la cartera original.

## Entorno y costo

| Concepto | Valor comprobado |
| --- | --- |
| Organización autorizada | Ignacio Magoia (`tazvigmxmkorigrornib`) |
| Proyecto de testing | EQUITAS-TP-TESTING |
| Referencia | `iylwghgvtydpmwidojdo` |
| API | `https://iylwghgvtydpmwidojdo.supabase.co` |
| Región / PostgreSQL | us-east-2 / 17.11.0.003 |
| Cotización de alta | USD 0 mensuales; no se contrató un plan pago |
| Proyecto original | `folyslqzqvnpolexcxjo`, sin cambios de esquema, políticas, cuentas o cartera en E06 |

La cotización corresponde al alta consultada. Los límites/cuotas del plan siguen aplicando. No se habilitaron ramas pagas. Conservar el proyecto mientras CI/E07 lo utilicen; pausarlo o borrar sus fixtures provoca que la integración obligatoria falle.

## Contrato de autorización

El vínculo de identidad es `auth.users.id → public.user.auth_user → tenant_user.user`. La lectura de negocio requiere usuario de aplicación `ACTIVE`, membresía `status=true` y tenant `ACTIVE`. No depende de metadata editable del JWT.

| Tablas | Regla de lectura para authenticated |
| --- | --- |
| `user` | Únicamente la fila propia por `auth.uid()`. Permite el diagnóstico de la aplicación. |
| `tenant_user` | Únicamente las membresías del usuario propio, incluidas las inactivas para poder explicar el rechazo. |
| `tenant` | Únicamente tenants activos con membresía activa y usuario activo. |
| `debtor`, `data_source` | Tenant visible según la regla anterior. |
| `debt`, `debtor_person`, `debtor_profile` | Deudor visible. |
| `person` | Persona vinculada mediante relación activa a un deudor visible. |
| `debtor_contact`, `address` | Persona visible. |
| `debtor_profile_detail` | Perfil y persona visibles. |
| 11 catálogos (`role`, moneda, tipos/estados, ciudad/provincia) | Compartidos entre usuarios con al menos un tenant autorizado. Sin membresía no hay lectura. |

Las políticas forman dependencias sin ciclos. No se agregaron funciones `SECURITY DEFINER`. El modelo observado tiene personas globales: una persona vinculada activamente a ambos tenants es compartida por diseño; no se afirma separación por tenant de campos que el modelo almacena globalmente.

Las 23 tablas tienen RLS. `anon` y `authenticated` tienen únicamente `SELECT` explícito; anon no tiene políticas de lectura. No hay políticas ni grants de escritura para esos clientes. La carga/administración requiere un canal privilegiado independiente. El ensayo HTTP prueba también rechazo de INSERT/UPDATE/DELETE, código `42501`.

## Migraciones aplicadas

1. `supabase/migrations/20261021220156_equitas_testing_schema.sql`: reconstruye las 23 tablas, 146 columnas y las restricciones observadas, sin copiar cartera. Conserva las SELECT permisivas originales para el ensayo rojo. **No dejar un entorno en este paso**.
2. `supabase/migrations/20261021221030_active_membership_rls.sql`: reemplaza esas políticas por las reglas anteriores, incorpora 14 índices de FK/lookup y revoca la ejecución pública del event trigger `rls_auto_enable`, si existe.

Los archivos se crearon con `supabase migration new` (CLI 2.108.0) y se alinearon con las versiones realmente registradas por la aplicación remota de cada migración. [Historial remoto](evidencias/e06/migrations.json). El primer archivo exige `public` vacío; no debe aplicarse al proyecto original. Para un entorno nuevo aplicar ambos, en orden, antes de exponerlo. Para migrar un proyecto existente es necesaria una revisión específica; este documento no certifica esa migración.

`supabase/config.toml` describe únicamente el stack local opcional con PostgreSQL 17 y límite API 1.000. No se aplicó esa configuración a la nube. El Docker local estaba detenido; toda la campaña E06 se ejecutó contra Supabase cloud real.

## Alta de fixtures y secretos

El entorno queda preparado para usarlo: no volver a ejecutar el alta sobre datos existentes.

Para reconstruir exclusivamente este entorno después de una limpieza:

1. Confirmar en el selector del SQL Editor o en la herramienta de administración la referencia **`iylwghgvtydpmwidojdo`**. No usar el proyecto original.
2. Ejecutar `database/testing/create-auth-fixtures.sql` con Auth vacío. Genera cuatro cuentas confirmadas con contraseña aleatoria de 52 caracteres, bcrypt y su identidad email. No envía correos ni crea JWT/sesiones ficticias. Es una preparación administrativa controlada de fixtures, no una prueba de registro público.
3. Guardar el resultado secreto únicamente en `.quality/e06/credentials.json`. No guardar la salida en un informe, captura, issue o commit. Las contraseñas no están en los SQL versionados.
4. Ejecutar `database/testing/fixtures.sql` una sola vez. Los conflictos de PK/unique fallan: no actualiza silenciosamente registros anteriores.
5. Usar la clave **publicable** del proyecto. No usar `service_role` ni `sb_secret_` para las pruebas de aplicación.
6. Crear el JSON secreto con esta estructura y valores reales exclusivamente en el archivo ignorado:

```json
{
  "url": "https://iylwghgvtydpmwidojdo.supabase.co",
  "publishableKey": "<clave sb_publishable_ del testing>",
  "accounts": {
    "a": {"email": "tp-e06-a@example.test", "password": "<aleatoria>"},
    "b": {"email": "tp-e06-b@example.test", "password": "<aleatoria>"},
    "none": {"email": "tp-e06-none@example.test", "password": "<aleatoria>"},
    "inactive": {"email": "tp-e06-inactive@example.test", "password": "<aleatoria>"}
  }
}
```

7. Actualizar el secreto de repositorio `SUPABASE_TEST_CONFIG` desde ese archivo. En PowerShell:

```powershell
Get-Content .quality/e06/credentials.json -Raw | gh secret set SUPABASE_TEST_CONFIG --repo ImaDecara/Tesis-EQUITAS
```

Se reemplazó la antigua configuración opcional de cinco variables por este único JSON que incluye las cuatro identidades. `SUPABASE_TEST_ENABLED` ya no controla el ensayo. Las suites aisladas excluyen `tests/external`; el comando real falla si falta el secreto. El validador rechaza otra URL y claves administrativas antes de hacer solicitudes.

## Dataset y resultados esperados

El manifiesto no secreto está en `quality/supabase-testing.json` y es la fuente compartida por el ensayo y el runner.

| Identidad | Usuario app | Membresía | Datos de negocio |
| --- | ---: | --- | --- |
| A | 910001 | A/910001, activa | Una fila por cada una de las nueve tablas de negocio; deuda ARS 1.250, riesgo 20. |
| B | 910002 | B/910002, activa | Una fila por cada tabla de negocio; deuda ARS 2.500, riesgo 80. |
| Sin membresía | 910003 | Ninguna | Cero filas de negocio, tenant y catálogos; ve solo su usuario propio. |
| Inactiva | 910004 | A, `status=false` | Cero negocio/tenant/catálogos; conserva su usuario/membresía para diagnóstico. |
| Anónimo | — | Ninguna | Cero filas de las 23 tablas. |

Los IDs de Auth son UUID generados. No se utilizan UUID inventados como sustituto de un login. Los IDs de filas sintéticas de A/B son 910001/910002; las pruebas exigen esos valores exactos y también los montos/riesgos. Un array vacío no aprueba un caso positivo.

## Ejecutar y revisar

Con Node 22.23.2, npm 11.21.1 y dependencias `npm ci` en `front`:

```powershell
back/.venv/Scripts/python.exe -X utf8 quality/supabase_integration.py --config-file .quality/e06/credentials.json --output .quality/e06/nueva-ejecucion
```

El directorio de salida debe ser nuevo/vacío. En Linux o con Python preparado puede usarse `python` en lugar de la ruta de la venv. Con el secreto ya presente en el entorno:

```text
python quality/supabase_integration.py --output .quality/e06/nueva-ejecucion
```

El runner conserva JUnit, JSON, log, resumen legible y `supabase.json` con SHA, run/attempt, fecha, proyecto, fixtures y hash del código de la prueba. Exige **12 variantes aprobadas, cero fallidas y cero omitidas**, con los diez IDs requeridos. Las variantes ejecutan Auth/Data API reales y las funciones productivas `validateAuthUserTenantAccess` y `loadAllTableRows`, sin reemplazar módulos ni transporte HTTP.

`validateAuthUserTenantAccess` admite recibir el mismo cliente ya autenticado; la llamada habitual sigue usando el cliente browser. Esta inyección explícita evita perder la sesión entre clientes en el ensayo y tiene regresión unitaria propia.

Para aislar el caso de autorización, con `SUPABASE_TEST_CONFIG` cargado, desde `front`: `npm run test:supabase -- -t SUP-RLS-02`. Ese filtro ejecuta un caso; las otras 11 variantes quedan no seleccionadas. No sirve como validación completa de entrega.

## CI obligatorio y fallos externos

El workflow `Calidad - CI y gates` ejecuta el job **Supabase - integracion real Auth y RLS** en pushes y ejecuciones manuales de `main`. El secreto solo se entrega al paso de prueba. PRs y ramas de trabajo conservan las suites aisladas sin credenciales externas; la integración real se exige después en `main`.

El resumen final requiere éxito del job, un solo reporte, los 12 resultados sin skips y procedencia SHA/run/attempt coincidente. Un job omitido, secreto ausente, timeout, error de Auth/Data API o reporte incompleto bloquea el workflow; no se convierte en éxito. La prueba usa timeout HTTP de 15 s y de caso de 30 s; no hay reintentos que oculten una caída externa. Conservar el fallo, comprobar estado/credenciales y volver a ejecutar después de recuperar el servicio. Los artefactos de CI duran 30 días: se versionan resúmenes portables para la entrega.

Logout comprueba que el cliente elimina su sesión y vuelve a leer como anónimo. No demuestra la revocación inmediata de un access token previamente copiado; ese token puede seguir siendo válido hasta expirar según el comportamiento documentado de Supabase.

## Limpieza comprobada

`database/testing/cleanup.sql` borra únicamente los tenants/filas reservadas, las cuatro cuentas sintéticas, sus sesiones y catálogos de fixture, dentro de una transacción. Comprueba colisiones básicas y las FK hacen fallar referencias incompatibles. No elimina tablas ni políticas. No ejecutar limpieza simultáneamente con CI/E07.

En E06 se ejecutó la limpieza: Auth, tenants, deudores, personas y moneda quedaron en cero. Después se recrearon cuentas y datos, se actualizaron las credenciales de CI y se validó nuevamente el entorno. [Evidencia de ciclo](evidencias/e06/fixtures-lifecycle.json). No es un ensayo de restauración de backups ni de idempotencia del ETL.

## Advisors y alcance pendiente del proyecto original

Después de la corrección, Security Advisors informa un aviso de protección de contraseñas filtradas deshabilitada. La [documentación de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) la sitúa en Pro o superior. Se conserva como limitación del testing gratuito; las cuentas tienen contraseñas aleatorias fuertes. No se contrataron servicios para eliminar el aviso.

Performance Advisors informa 14 índices aún sin uso registrado en una base diminuta; [guía del aviso](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). No se interpreta como defecto de carga ni se borran índices de autorización/FK por falta de uso en estas fixtures. No hay aviso de FK sin índice en esta revisión de testing.

**DEF-SUP-001 queda corregido y con regresión en testing. El proyecto original conserva las 23 políticas `USING(true)` y el issue #1 sigue abierto para ese entorno.** Esta distinción permite cerrar el alcance E06 sin afirmar una corrección de la cartera real. E07 debe desplegar usando el testing registrado. Una eventual migración del proyecto original exige revisar consumidores y hacer su validación independiente.

Referencias utilizadas: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [cambio de grants Data API](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), [PostgreSQL 17.11](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes). Se usaron grants explícitos y no se agregaron los tipos/operadores afectados por los cambios de PostgreSQL.
