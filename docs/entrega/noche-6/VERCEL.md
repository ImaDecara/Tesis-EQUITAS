# Compatibilidad con el proyecto Vercel existente — candidata V1 (noche 6)

Fecha: 2026-11-09. Alcance: comprobación local y lectura de lo accesible en GitHub. **No se publicó nada**,
no se cambió configuración remota, no se descargaron secretos y no se tocaron bases remotas.

## Tres estados

| Estado | Resultado |
|---|---|
| Funciona localmente | sí, con Supabase local y la cartera demo ([README](README.md#estado-al-cierre)) |
| Compatibilidad de build/configuración | comprobada localmente (versiones y compilación); **dos precondiciones del panel sin verificar** (§3) |
| Despliegue Vercel de esta candidata probado | **no**: requiere una autorización posterior, una base remota preparada y un Preview nuevo (§6) |

## 1. Qué se pudo verificar (solo lectura)

Fuente: API de GitHub del repositorio `ImaDecara/Tesis-EQUITAS` (despliegues que registra `vercel[bot]`)
y la documentación versionada de E07 (`CONFIGURACION_VERCEL_E07.md`, `REGISTRO_EJECUCION_E07.md`).

- Proyecto Vercel `tesis-equitas`, equipo `equitas`, con integración Git: el repositorio es **público**.
- **Production** se publica desde `main`: el último despliegue registrado es de `36f35b4` (2026-10-23, estado `success`).
- **Preview**: el historial muestra un Preview por cada push de rama (por ejemplo `quality/*`), además del
  Production de `main`. Es el comportamiento esperado de la integración Git, **sujeto a la configuración vigente
  del panel**, que no se pudo verificar (§3). Los Preview están protegidos por Vercel Authentication; el CI usa
  `VERCEL_AUTOMATION_BYPASS_SECRET` (secreto de GitHub).
- Variables históricas documentadas en E07: `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  **solo para Preview de `quality/tp-testing`**, apuntando a Supabase testing. Eso es Preview, no Production:
  la configuración actual de Production no consta en el repositorio.
- Variables de sistema expuestas (E07): `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_REF`, `VERCEL_ENV`
  (las usa `/api/build-info`).

## 2. Qué se comprobó localmente sobre la candidata

| Aspecto | `main` desplegado (`36f35b4`) | Candidata N6 | Resultado |
|---|---|---|---|
| Node | 22.23.2 (`.nvmrc`, `engines`) | igual | compatible |
| npm / lockfile | 11.21.1, lockfile v3 | igual; agrega `overrides` (minimatch) | npm ≥ 8.3 aplica `overrides`; `npm ci --offline` en copia aislada reprodujo el árbol |
| Next / React | 16.4.2 / 19.2.4 | igual | compatible |
| `next.config.ts` | `turbopack.root: __dirname` | `turbopack.root: path.join(__dirname, '..')` (desde la integración, no de N6) | ver §3 |
| Archivos fuera de `front/` | ninguno | importa JSON de `../contracts/` (`decision-rules.v1.json`, `action-costs.v1.json`) | ver §3 |
| Lecturas de archivos en ejecución | — | ninguna (`fs`/`readFile` no se usa en `app/`, `lib/`, `components/`) | los JSON quedan dentro del bundle |
| Autenticación | contraseña | contraseña; sin OAuth ni callbacks | no requiere URLs de redirección para ingresar |
| Cookies | `sb-<ref>-auth-token` | además `equitas_tenant_id` (servidor) | funcionan con HTTPS |
| API de importación | — | `/api/imports` reenvía solo a loopback (`EQUITAS_IMPORT_API_URL`) | en Vercel queda deshabilitada; no se abre a otros destinos |

Evidencia de compilación (2026-11-09, sobre el código de la rama):

- Repositorio completo (como Vercel con acceso a archivos fuera de la raíz): `next build` termina bien.
- Copia que solo contiene `front/`: `next build` falla con 8 errores
  `Module not found: Can't resolve '../../../../contracts/decision-rules.v1.json'`.

## 3. Precondiciones del panel que no se pudieron verificar

En esta sesión no había acceso al panel de Vercel (sin token de la CLI ni conexión administrativa). Antes
de publicar hay que comprobar, en **Settings → Build and Deployment**:

1. **Root Directory** = `front` y la opción **«Include files outside the root directory in the Build Step»
   habilitada**. Si está deshabilitada, la candidata **no compila** (§2). `main` nunca lo necesitó, así que
   el despliegue actual no prueba que esté activa.
2. **Node.js Version** = 22.x; **Install Command** y **Build Command** por defecto (`npm install` /
   `next build`) o equivalentes; ningún **Ignored Build Step** que omita la rama.

También conviene revisar Deployment Protection, dominios y la lista de variables por entorno (solo nombres).

Cómo comprobarlo sin publicar: abrir esas pantallas del proyecto `tesis-equitas` con una cuenta del equipo.
Cómo acreditarlo después, con autorización: un Preview de la rama debe compilar y `/api/build-info` debe
devolver el SHA esperado.

## 4. Variables por entorno (nombres; los valores no van al repositorio)

| Variable | Production | Preview | Tipo |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase elegido para publicar | la del Preview correspondiente (hoy `quality/tp-testing` → testing) | pública |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clave publicable de ese proyecto | ídem | pública |
| `EQUITAS_REVIEW_SERVER_JWT` | JWT del rol `equitas_review_server` firmado con el secreto de **ese** proyecto, con vencimiento | ídem para el proyecto del Preview | **secreta, solo servidor** (marcar Sensitive) |
| `EQUITAS_IMPORT_API_URL` | no definir | no definir | — |

`EQUITAS_REVIEW_SERVER_JWT` es la credencial dedicada de revisión y auditoría: sin ella la ficha, las
decisiones y los CSV (que exigen registrar auditoría) responden «no disponible». La emite el custodio del
proyecto Supabase; vence y hay que renovarla y volver a desplegar. Nunca `SERVICE_ROLE_KEY` ni `JWT_SECRET`.

## 5. La base conectada a Vercel

Un build o un merge **no** prueba que la base tenga el esquema. La candidata necesita las 13 migraciones de
`supabase/migrations/`:

| Migración | Aporta |
|---|---|
| `20261021220156_equitas_testing_schema` | esquema base; **exige `public` vacío**: solo para un proyecto nuevo, nunca sobre el original |
| `20261021221030_active_membership_rls` | RLS de lectura por membresía activa |
| `20261030090000_etl_compat`, `20261102100000_etl_semantic_nullables` | compatibilidad del ETL |
| `20261030100000_case_review` | roles `equitas_write_definer`, `equitas_review_server`, `equitas_import_server` (concedidos a `authenticator`); `case_review`, `case_review_approval`, `import_batch`; `record_case_review*`, `record_import_batch` |
| `20261102120000_case_review_cutoff` | `equitas_current_cutoff`, `equitas_verify_cutoff` |
| `20261102170000_access_audit` | `access_audit`, `record_access_audit` |
| `20261102180000_recompute_debtor_profiles` | `recompute_debtor_profiles` |
| `20261105201716_import_batch_staging` y `20261105213408_…` | publicación atómica: `equitas_import_definer`, esquema privado, `stage/publish/settle_import_batch`, presupuestos de tiempo del rol importador |
| `20261107061833_…`, `20261107110911_…`, `20261107151854_…` | preview de importación (054) |

Estado conocido de las bases remotas (sin consultarlas en N6):

- **Original** (`folyslqzqvnpolexcxjo`): conserva DEF-SUP-001 abierto (ALIGN-045); no tiene estas migraciones
  documentadas y la primera no se le puede aplicar. No usarla para esta candidata sin una migración revisada.
- **Testing** (`iylwghgvtydpmwidojdo`): tiene el esquema de E06 para su campaña de 12 casos; no consta que
  tenga las migraciones posteriores. No se resetea ni se usa para campañas nuevas.

Además, **la cartera no viaja**: los datos locales no se copian y el ETL actual solo publica en loopback
(`ALLOWED_TARGET_HOSTS`, PLAN §7.6). Una base remota quedaría sin cartera hasta un procedimiento de carga
autorizado (ALIGN-046/050). Sin cartera, la app publicada mostraría tableros vacíos.

## 6. Efectos automáticos de un push futuro (no ejecutados en N6)

| Acción | Qué se dispara |
|---|---|
| Push de `delivery/noche-6-v1` (o de otra rama que no sea `main` ni `quality/tp-testing`) | `Calidad - CI y gates` (jobs frontend y backend) en GitHub Actions; previsiblemente un **Preview** de Vercel con las variables de Preview vigentes |
| Push o merge a `main` | el mismo CI **más** el job `Supabase - integracion real Auth y RLS` contra **Supabase testing** (secreto `SUPABASE_TEST_CONFIG`) y, según el historial, un despliegue de **Production** |
| Push a `quality/tp-testing` | el mismo CI **más** el job contra **Supabase testing** (la condición del job incluye `main` y `quality/tp-testing`), un Preview y el workflow `Preview - smoke posterior al despliegue` |

Fuente: `.github/workflows/quality-ci.yml` (disparadores `push` sin filtro de ramas y condición del job `supabase`),
`.github/workflows/preview-smoke.yml` y el historial de despliegues. Lo de Vercel depende del panel (§3).

Merge a `main` sin base preparada publicaría en Production una app que no encuentra sus tablas.

## 7. Orden sugerido para publicar más adelante (requiere autorización expresa)

1. Elegir el proyecto Supabase destino (recomendado: uno nuevo y vacío para la demo, no el original).
2. Que el custodio aplique las 13 migraciones y verifique roles, grants y RLS (`database/verificacion_supabase_solo_lectura.sql`).
3. Emitir el JWT de `equitas_review_server` de ese proyecto y cargar las variables en Vercel (primero Preview, por rama).
4. Verificar las precondiciones del §3.
5. Definir cómo se carga la cartera sintética en ese proyecto (hoy no hay procedimiento remoto autorizado).
6. Push de la rama → Preview → smoke (`front/tests/smoke/deployed-smoke.mjs`) y recorrido.
7. Solo después, autorización para `main` (que además dispara el job contra testing y Production).
