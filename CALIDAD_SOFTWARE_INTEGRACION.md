# Pruebas de integracion - TP Integrador de Calidad de Software

> **Actualización E03, 21/10/2026:** la [lectura completa](REGISTRO_EJECUCION_E03.md) quedó corregida en ambas rutas. Se agregaron 22 pruebas de integración con SDK Supabase real y transporte HTTP sintético, además de 20 unitarias del lector. Se conservaron cuatro fallos reales antes de corregir y los mismos casos aprobados después, con límites, errores y agregados. La integración Auth/Data API con el servicio de testing sigue omitida y pendiente E06; estos resultados aislados no cambian ese estado ni corrigen RLS.

> **Actualización del 21/10/2026:** las secciones iniciales describen las suites históricas y su prueba Auth opcional omitida. Se amplió la revisión al proyecto real mediante el plugin Supabase: esquema, políticas, conteos e integridad fueron inspeccionados y se reprodujo un defecto de autorización sin pertenencia. El detalle está en `REVISION_SUPABASE.md`; la prueba Auth de Vitest no se ejecutó como parte de esa inspección.

## Alcance

Esta etapa incorpora pruebas de integracion para el MVP Nivel 2 sin escribir datos en Supabase ni ejecutar cargas reales. Se distinguen las pruebas simuladas, que se ejecutan siempre, de la prueba real opcional contra un proyecto exclusivo de testing.

## Integraciones identificadas

- **Frontend + Supabase SSR:** `front/lib/supabase-server.ts` crea el cliente de Server Components con cookies; `front/lib/data/raw-debtor-loader.ts` consulta las ocho tablas del tablero de objetos.
- **Frontend + Auth/RLS:** `front/lib/services/auth-service.ts` valida la cadena `auth.users -> public.user -> tenant_user` mediante el cliente browser de Supabase.
- **ETL + Supabase:** `back/ETL/load.py` centraliza lecturas, inserciones, actualizaciones, carga bulk de deudas y reintentos HTTP transitorios.
- **ETL interno:** `back/ETL/run_etl.py` encadena extracción TSV, transformación y preparación de cargas.

## Pruebas simuladas

| Area | Archivo | Caso | Datos de entrada | Resultado esperado | Resultado obtenido |
| --- | --- | --- | --- | --- | --- |
| Lectura frontend | `front/tests/integration/raw-debtor-loader.integration.test.ts` | Consulta exitosa | Respuestas mock con filas de `debtor` y `debt` | Filas mapeadas, sin alertas | Aprobado |
| Lectura frontend | Mismo archivo | Respuesta vacia | Listas vacias mock | Listados vacios validos, sin alertas | Aprobado |
| Lectura frontend | Mismo archivo | Error de conexion | Error mock `FetchError` | Alerta de datos, sin romper la carga | Aprobado |
| Lectura frontend | Mismo archivo | Error de permisos | Error RLS mock `42501` | Alerta que solicita policy SELECT | Aprobado |
| Auth/RLS | `front/tests/integration/auth-service.integration.test.ts` | Acceso autorizado | Filas mock de `user` y `tenant_user` activa | Contexto con usuario, tenant y rol | Aprobado |
| Auth/RLS | Mismo archivo | Usuario o dato invalido | Usuario inexistente e identificador no numerico | Acceso denegado antes de consultar de mas | Aprobado |
| Auth/RLS | Mismo archivo | Permiso denegado | Error mock `42501` | Error de base de datos sin autorizar | Aprobado |
| Flujo ETL | `back/tests/integration/test_etl_pipeline_integration.py` | Extraccion a carga simulada | TSV temporales con Agua e Inmueble | Se preparan dos deudas por clave interna | Aprobado |
| Flujo ETL | Mismo archivo | Duplicados e idempotencia | Detalle con una deuda repetida; segunda ejecucion | No duplica y la segunda carga queda sin cambios | Aprobado |
| Flujo ETL | Mismo archivo | Registro invalido | Cabecera sin `Destinatario_Id` | Omite el objeto invalido y conserva el valido | Aprobado |
| Flujo ETL | Mismo archivo | Fallo de carga | Loader bulk mock que lanza `RuntimeError` | Interrumpe y propaga el fallo | Aprobado |
| Retry ETL | `back/tests/integration/test_supabase_loader_integration.py` | Errores transitorios | Mocks de `RemoteProtocolError`, `ReadTimeout`, `ConnectTimeout` y `ConnectError` | Reintenta y completa la operacion | Aprobado |
| Retry ETL | Mismo archivo | Reintentos agotados | `ConnectError` persistente | Propaga el error despues del quinto intento | Aprobado |

Los TSV de integracion se crean dentro del directorio temporal de Pytest y los loaders se reemplazan mediante `monkeypatch`. No se utilizan credenciales reales ni se realizan solicitudes HTTP en estas pruebas.

## Prueba real opcional de Supabase

Archivo: `front/tests/integration/supabase-testing.integration.test.ts`.

La prueba inicia sesion con un usuario exclusivo de testing y realiza solo esta lectura:

```text
SELECT id FROM debtor LIMIT 1
```

No inserta, actualiza ni elimina filas. La sesion se crea sin persistencia local y se cierra al finalizar.

| Condicion | Estado obtenido |
| --- | --- |
| Variables de testing ausentes o prueba no habilitada | **Omitida** |
| Credenciales de testing configuradas y consulta correcta | Se registrara como aprobada por Vitest |
| Credenciales invalidas, RLS incorrecta o error de red | Se registrara como fallida por Vitest |

En esta ejecucion se omitio porque no se configuraron las variables de un proyecto de testing. No se intento conectar a Supabase de produccion.

### Requisitos para ejecutarla

Se necesita un proyecto o branch de **Supabase de testing** que replique el esquema y las politicas RLS necesarias, junto con un usuario de prueba con permiso `SELECT` sobre `debtor`. Configurar localmente o en un gestor de secretos, sin versionar valores:

```powershell
$env:SUPABASE_TEST_ENABLED = 'true'
$env:SUPABASE_TEST_URL = 'https://<proyecto-testing>.supabase.co'
$env:SUPABASE_TEST_PUBLISHABLE_KEY = '<publishable-key-del-proyecto-testing>'
$env:SUPABASE_TEST_EMAIL = '<usuario-de-prueba>'
$env:SUPABASE_TEST_PASSWORD = '<password-del-usuario-de-prueba>'
```

No hace falta ni se debe proporcionar una `service_role` para esta prueba. Antes de habilitarla, confirmar que la URL corresponde al proyecto de testing y que el usuario no tiene permisos de escritura.

## Comandos

Desde `front`:

```powershell
npm run test:unit
npm run test:integration
npm run test
```

Desde `back`:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/integration -q
.\.venv\Scripts\python.exe -m pytest
```

## Resultados de la ejecucion inicial

- Integraciones frontend simuladas: **8 aprobadas**.
- Integracion real con Supabase de testing: **1 omitida** por variables de entorno no configuradas.
- Integraciones ETL simuladas: **8 aprobadas**.
- Fallos inesperados: **0**.
- Regresion de pruebas unitarias existentes: **27 aprobadas**.
- Suite frontend completa: **22 aprobadas, 1 omitida**.
- Suite backend completa: **21 aprobadas**.
- Total consolidado: **43 aprobadas, 0 fallidas y 1 omitida**.

## Riesgos y limitaciones

- Los mocks verifican contratos, respuestas y flujos, pero no reemplazan la validacion de esquema, cookies SSR ni politicas RLS de un proyecto Supabase real.
- La prueba real valida autenticacion y lectura de `debtor`; no ejecuta el ETL ni operaciones de escritura.
- La idempotencia se comprueba con un almacen simulado. La validacion definitiva depende de restricciones y politicas presentes en el proyecto de testing.
- No se crean proyectos, usuarios ni datos de Supabase automaticamente para evitar modificar servicios externos.

## Actualización de regresión

En la ejecución ampliada del 16 de octubre de 2026, las integraciones simuladas continuaron aprobando dentro de las suites completas: 8 de frontend y 8 de backend. La prueba de lectura real contra Supabase de testing permaneció omitida por ausencia de variables de entorno específicas de testing; no se intentó ninguna conexión a producción. El total final de las suites fue 94 pruebas aprobadas, 0 fallidas y 1 omitida. Ver `INFORME_TP_CALIDAD_SOFTWARE.md` para la cobertura y trazabilidad consolidadas.

## Revisión real por plugin Supabase — 21/10/2026

Proyecto identificado: EQUITAS, referencia `folyslqzqvnpolexcxjo`, estado `ACTIVE_HEALTHY`. Se observaron 23 tablas públicas con RLS y se comprobaron exactamente 2.933 objetos, 56.286 deudas y 2.493 personas. Las claves únicas y relaciones respaldan la deduplicación; los agregados seleccionados no mostraron duplicados, huérfanos ni discrepancias de conteo o importe de perfiles.

La prueba `SUP-RLS-01` con rol anónimo devolvió cero filas. La prueba `SUP-RLS-02`, con rol autenticado y una identidad sintética sin usuario de aplicación ni pertenencia activa, pudo contar toda la cartera. Sus políticas SELECT son `TO authenticated USING (true)`. Este comportamiento incumple el criterio de autorización por tenant y se registró como **DEF-SUP-001**, abierto, en `REGISTRO_DEFECTOS_CALIDAD.md`.

Las consultas de roles utilizaron `BEGIN READ ONLY`, configuración local y `ROLLBACK`; no se crearon usuarios ni se obtuvieron JWT. La verificación prueba el comportamiento RLS de PostgreSQL, no un login real por HTTP ni la sesión SSR del frontend. La suite conserva sus 94 aprobadas y una omitida: esta inspección no se suma a ese recuento ni declara completado el flujo de testing del cliente.

Evidencias: `evidencias/supabase-2026-10-21.json`, `database/schema-observado-2026-10-21.json` y `database/verificacion_supabase_solo_lectura.sql`. No hay branches de desarrollo ni migraciones devueltas por el plugin. Para cerrar la integración de aplicación y el rojo/verde siguen pendientes un entorno de testing, el tratamiento del defecto, la repetición del caso y la regresión automatizada.
