# EQUITAS — Revisión del proyecto Supabase conectado

> **E06:** [testing aislado y cliente real](SUPABASE_TESTING_CALIDAD.md) completados; la corrección de RLS está aplicada allí y aprobó 12/12 en CI. **Este proyecto original no se modificó**: conserva 23 SELECT `USING(true)` y DEF-SUP-001 #1 abierto. La inspección SQL siguiente es histórica y no se reetiqueta como prueba HTTP.

> **Seguimiento E03:** DEF-DAT-001 se corrigió y validó mediante regresión aislada en objetos/personas y sus relaciones. [Ficha, pruebas y CI rojo/verde](REGISTRO_EJECUCION_E03.md). Las cifras y observaciones de esta revisión permanecen como evidencia de detección; no son una nueva validación del cliente autenticado. DEF-SUP-001 sigue abierto. E03 no modificó datos, cuentas ni políticas del proyecto real; integración y despliegue siguen pendientes E06/E07.

Revisión del **21/10/2026**, realizada mediante el plugin de Supabase y contrastada con el código del repositorio. Se consultaron catálogos, políticas, restricciones y conteos agregados. Las comprobaciones de roles utilizaron transacciones `READ ONLY` con `ROLLBACK`. No se modificaron datos, cuentas, políticas, esquema ni configuración del proyecto.

## 1. Proyecto y alcance real de esta evidencia

| Propiedad | Resultado |
| --- | --- |
| Proyecto | EQUITAS |
| Referencia | `folyslqzqvnpolexcxjo` |
| Estado del servicio | `ACTIVE_HEALTHY` |
| Región | `us-east-2` |
| PostgreSQL | 17, versión del servicio `17.6.1.166` |
| Tablas públicas | 23 |
| Columnas públicas | 146 |
| Branches de desarrollo devueltas por el plugin | 0 |
| Entradas de migraciones devueltas por el plugin | 0 |
| Edge Functions devueltas por el plugin | 0 |

La conexión del plugin permite **inspección real del servicio externo**. No aporta por sí misma una sesión Auth del frontend, cookies SSR ni un login de usuario de testing. La prueba `front/tests/integration/supabase-testing.integration.test.ts` sigue sin ejecutarse con un usuario real. Tampoco se comprobó que el despliegue Vercel use actualmente esta referencia mediante su configuración protegida, aunque el nombre, esquema y volumen coinciden con el proyecto descrito en la conversación.

No se identificó un entorno aislado de pruebas entre los recursos devueltos. Este proyecto contiene la cartera del MVP; la revisión se limitó a lecturas y no ejecutó cargas de estrés.

## 2. Volumen comprobado con COUNT(*)

| Entidad | Filas |
| --- | ---: |
| Municipios / tenants | 1 |
| Usuarios de Supabase Auth | 1 |
| Usuarios de aplicación | 1 |
| Relaciones usuario–tenant | 1, activa |
| Objetos de deuda (`debtor`) | **2.933** |
| Deudas (`debt`) | **56.286** |
| Personas (`person`) | **2.493** |
| Relaciones objeto–persona | **3.007** |
| Contactos | **2.289** |
| Perfiles de objeto | **2.933** |
| Detalles de perfil por persona | **3.007** |

Distribución de objetos: **37 inmuebles, 1.832 rodados y 1.064 conexiones de agua**. Estos conteos coinciden con el volumen histórico de 2.933 objetos y 56.286 deudas mencionado en el chat.

El resumen inicial de `list_tables` informó `rows: 0` en sus metadatos. Se descartó ese valor como prueba de tablas vacías y se verificaron los conteos exactos mediante SQL. Las cifras de esta sección provienen de esas consultas, no del resumen de metadatos.

## 3. Modelo y restricciones observadas

Se observaron **23 claves primarias, 24 claves foráneas, 22 restricciones de unicidad y 2 CHECK**. El snapshot de `database/schema-observado-2026-10-21.json` registra columnas, restricciones, políticas, permisos y funciones, sin filas de negocio.

- `tenant` identifica la organización municipal.
- `public.user.auth_user` referencia a `auth.users.id` y es único. `tenant_user` vincula usuario, tenant y rol; la pareja `(tenant, user)` es única.
- `debtor` pertenece a un tenant y tiene clave única `(tenant, type, external_id)`.
- `debt` pertenece a un `debtor`; la clave `(debtor, external_id)` es única. Esta restricción respalda la deduplicación del loader.
- `person` tiene `external_id` único y se relaciona con objetos mediante `debtor_person`. Los contactos pertenecen a una persona, aunque la tabla se llame `debtor_contact`.
- `debtor_profile` admite un perfil por objeto; `debtor_profile_detail` admite un detalle por pareja perfil–persona. Los CHECK limitan los valores de riesgo a 0–100.

`person` no incluye un tenant directo: su acceso autorizado debe resolverse a través de las relaciones con objetos u otra regla explícita del modelo. La unicidad global de `person.external_id` deberá revisarse si esos identificadores solo son únicos dentro de cada municipio; no se declaró ese punto como defecto porque no hay evidencia suficiente sobre el contrato de origen.

El snapshot es una **observación versionable del esquema actual**, no una migración ejecutada ni un procedimiento completo para reconstruir Supabase y Auth.

## 4. Integridad y coherencia verificadas

| Comprobación | Resultado |
| --- | ---: |
| Claves de deuda `(debtor, external_id)` duplicadas | **0** |
| Deudas sin objeto asociado | **0** |
| Objetos sin perfil | **0** |
| Perfiles cuyo `debt_count` difiere del conteo real de deudas | **0** |
| Perfiles cuyo `total_debt_amount` difiere de `SUM(current_amount)` en más de 0,01 | **0** |
| Usuarios de aplicación sin vínculo válido a Auth | **0** |
| Usuarios Auth sin pertenencia activa de aplicación | **0** |

Esto confirma consistencia de las relaciones y agregados seleccionados en el estado actual. No demuestra todas las reglas de negocio, equivalencia con los TSV originales ni idempotencia de una nueva ejecución ETL contra este servicio. No se reimportaron datos para esta revisión.

## 5. Hallazgo confirmado: RLS no exige pertenencia al tenant

Todas las tablas públicas tienen RLS habilitado, pero sus **23 políticas** son de la forma:

```sql
FOR SELECT TO authenticated USING (true)
```

No hay un filtro por `auth.uid()`, pertenencia activa ni tenant de la fila. La validación del frontend en `front/lib/services/auth-service.ts` sí comprueba la cadena usuario–tenant, pero esa comprobación de aplicación no convierte las políticas de la base en autorización por filas. La [documentación oficial de RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) distingue el rol autenticado de las condiciones que restringen las filas visibles.

Se verificó el comportamiento con una identidad **sintética**, sin crear una cuenta ni generar un JWT:

| Caso | Usuarios de aplicación que coinciden con la identidad | Pertenencias activas | Objetos visibles | Deudas visibles | Personas visibles |
| --- | ---: | ---: | ---: | ---: | ---: |
| `SUP-RLS-01`: rol `anon` | No aplica. | No aplica. | **0** | **0** | **0** |
| `SUP-RLS-02`: rol `authenticated`, identidad sin pertenencia | **0** | **0** | **2.933** | **56.286** | **2.493** |

Para `SUP-RLS-02`, el criterio esperado es **cero filas de negocio**. La base mostró toda la cartera. El defecto queda registrado como **DEF-SUP-001**, prioridad alta, abierto.

La prueba se limita a la autorización de PostgreSQL bajo un rol y claims controlados desde la conexión de administración. No demuestra que un atacante pueda emitir un JWT válido, ni que se haya producido acceso indebido real, ni un recorrido HTTP entre dos tenants existentes. Solo hay un tenant y un usuario en el proyecto; no se crearon otros para simular ese flujo.

También se verificaron permisos de tabla amplios para `anon` y `authenticated`. **Un GRANT de escritura no equivale a una escritura permitida por RLS**: las políticas observadas son únicamente SELECT. No se probaron INSERT/UPDATE/DELETE sobre datos reales. Las lecturas anónimas comprobaron cero filas.

## 6. El volumen real confirma el problema del límite de lectura

Los loaders `front/lib/data/raw-debtor-loader.ts` y `front/lib/services/person-data-service.ts` solicitan:

```typescript
supabase.from(table).select('*').limit(TABLE_LIMIT)
```

`TABLE_LIMIT` vale **3.000** y no hay recuperación de páginas posteriores en la base. El proyecto tiene **56.286 deudas**, por lo que una lectura limitada a 3.000 no puede recuperar la cartera completa. Incluso si el servidor aceptara esas 3.000 filas, equivaldrían como máximo al **5,33 %** de las deudas. El límite efectivo de la Data API podría ser menor; no se obtuvo su configuración desde los parámetros de roles consultados.

Las relaciones objeto–persona también superan el límite: 3.007 filas. La paginación visual de 10/20 elementos actúa sobre lo ya descargado y no recupera esas filas restantes.

Este hallazgo queda registrado como **DEF-DAT-001**, abierto. Se confirmó la incompatibilidad entre el volumen real y el código de lectura; no se midió un importe específico incorrecto en la interfaz autenticada. La corrección debe probar recuperación completa, orden estable y coherencia de agregados.

## 7. Avisos oficiales del proyecto

Security Advisors devolvió **3 advertencias**:

1. `anon` tiene EXECUTE sobre `public.rls_auto_enable()`, función SECURITY DEFINER. [Detalle oficial](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
2. `authenticated` también tiene EXECUTE sobre esa función. [Detalle oficial](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
3. La protección frente a contraseñas filtradas está deshabilitada. [Detalle oficial](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

La inspección de `rls_auto_enable` mostró retorno `event_trigger`, `SECURITY DEFINER`, `search_path=pg_catalog` y un trigger de eventos habilitado. No se invocó la función ni se demostró explotación de un RPC. El aviso de permisos debe revisarse teniendo en cuenta esa naturaleza de event trigger; no se presenta como un ataque confirmado.

Performance Advisors devolvió **19 observaciones informativas**, distribuidas en:

- **10 claves foráneas sin índice de cobertura**, entre ellas referencias de `address`, `data_source`, `debt`, `debtor_contact`, `person` y `tenant_user`. [Detalle oficial](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
- **9 índices sin uso registrado**. [Detalle oficial](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

No son 19 fallos de rendimiento medidos. Antes de cambiar índices se necesitan patrones de consulta y mediciones; esta revisión no ejecutó planes de optimización, DDL ni carga sostenida.

Los advisors no marcaron como error las políticas `USING (true)`. Por eso su resultado no sustituye una prueba de la regla de autorización de EQUITAS.

## 8. Qué cambia en el estado del TP

| Aspecto | Estado después de la revisión |
| --- | --- |
| Acceso al Supabase real desde el plugin | **Comprobado**. |
| Esquema y restricciones efectivas | **Inspeccionados y guardados como snapshot**. |
| Volumen e integridad seleccionada | **Comprobados mediante agregados**. |
| RLS anónimo | Cero filas en las tablas de negocio consultadas. |
| Autorización sin pertenencia | **Falla confirmada en PostgreSQL**; DEF-SUP-001 abierto. |
| Lectura completa de la cartera por la web | Límite incompatible con el volumen confirmado; DEF-DAT-001 abierto. |
| Login Auth real y cliente web contra testing | **Pendiente**. |
| Aislamiento entre dos tenants reales | **Pendiente**. |
| Smoke posterior al despliegue y CI/CD | **Pendiente**, sin cambio por esta inspección. |
| Estrés y esfuerzo sostenido | **Pendiente**. |
| Jira | Sin evidencia nueva; se conserva el estado anterior. |

La revisión ya aporta un **defecto real reproducible**. Para completar el rojo/verde todavía faltan una corrección autorizada, la misma comprobación aprobada y la regresión correspondiente. No se debe presentar la inspección administrativa como si hubiera aprobado la prueba de login omitida por Vitest.

## 9. Archivos de evidencia y continuidad

- `evidencias/supabase-2026-10-21.json`: proyecto, conteos, integridad, probes por rol, hallazgos y avisos oficiales.
- `database/schema-observado-2026-10-21.json`: snapshot de catálogos, restricciones, políticas y permisos.
- `database/verificacion_supabase_solo_lectura.sql`: consultas de conteos y de roles para reproducir la observación con una conexión autorizada. Las pruebas de roles finalizan en ROLLBACK.
- `REGISTRO_DEFECTOS_CALIDAD.md`: defectos, casos, esperado/obtenido y criterios de cierre.

El siguiente trabajo técnico debe priorizar aislamiento y lectura completa, manteniendo acceso del usuario existente y evitando que una corrección RLS bloquee la validación de `public.user`/`tenant_user`. El alcance de esta revisión fue investigar; no se aplicaron cambios a la base conectada.
