# Espejo local: qué está comprobado, qué viene de la foto de octubre y qué se desconoce

El espejo (`scripts/espejo/equitas_espejo.py`, proyecto local `equitas-n7-espejo`) sirve para ensayar compatibilidad. **No es idéntico a producción.** Esta tabla dice de dónde sale cada cosa que reproduce.

- **Comprobado en vivo**: lecturas públicas de solo lectura del 09/11/2026 (`GET` con `limit=0`, sin sesión, cero filas) y un dato informado por el usuario. Evidencia: `PlanToFinish/…/evidence/revision-fable-ux/produccion-lectura-publica-2026-11-09.md`.
- **Foto de octubre**: `database/schema-observado-2026-10-21.json`, tomada el 21/10/2026. Puede estar desactualizada.
- **Desconocido**: no hay evidencia. El espejo toma un valor para poder funcionar, y se dice cuál.

Esta noche no se leyó producción: no hubo acceso de lectura ni un resultado pegado.

| Aspecto | Comprobado en vivo (09/11) | Foto de octubre (21/10) | Desconocido · qué asume el espejo |
|---|---|---|---|
| **Aplicación publicada** | Production sirve `main@36f35b4` y apunta al Supabase original. | — | — |
| **Tablas que existen** | 14 responden 200: `user`, `tenant`, `tenant_user`, `role`, `debtor`, `debt`, `person`, `debtor_person`, `debtor_contact`, `debtor_profile`, `debtor_profile_detail`, `debtor_type`, `debt_status`, `contact_type`. | 23 tablas: las 14 más `address`, `city`, `currency`, `data_source`, `data_source_type`, `document_type`, `person_status`, `person_type`, `province`. | Que las otras 9 sigan existiendo hoy. El espejo crea las 23. |
| **Tablas del módulo de decisiones** | `import_batch`, `case_review`, `case_review_approval` y `access_audit` **no existen** (404 `PGRST205`). | No figuran. | — El espejo arranca sin ellas. |
| **Columnas** | `debt.updated_amount` existe. `debtor_profile.debt_state_not_observed_count` **no existe**. | 146 columnas con tipo, nulabilidad y valor por defecto. El espejo las reproduce: `verificar-esquema` da 146 de 146. | Que no se hayan agregado o quitado columnas desde octubre. |
| **`debt.updated_amount` generado o no** | Solo que la columna existe. | La foto no registra si una columna es generada. | Desconocido. En el espejo es una columna común. El esquema local del repositorio la tiene generada a partir de `current_amount`. |
| **Importes nulos** | — | `debt.current_amount` y `original_amount` son `NOT NULL DEFAULT 0`: un importe faltante no se puede guardar como faltante, llega como 0. | Que siga así. El espejo lo reproduce. |
| **Restricciones** | — | 71 (claves primarias, únicas, foráneas y un `CHECK`). El espejo las reproduce: 71 de 71. | Que no hayan cambiado. `debtor(tenant, id)` única **no** está en la foto. |
| **Identidades y secuencias de los `id`** | — | La foto no las registra: `column_default` nulo en todos los `id`. | Desconocido. El espejo no tiene identidad en ningún `id` y carga con ids explícitos. |
| **Índices** | — | Solo los de claves primarias y únicas (se deducen de las restricciones). | Si hay otros. El espejo solo tiene esos (45). |
| **Políticas de lectura** | Sin sesión se obtienen cero filas. | 23 políticas, todas `SELECT … TO authenticated USING (true)`: cualquier usuario autenticado lee todo. El espejo las reproduce: 23 de 23. | Si siguen vigentes. Es el dato que más conviene confirmar antes de publicar. |
| **Permisos de tabla** | — | `anon`: SELECT. `authenticated`: SELECT, INSERT, UPDATE y DELETE en las 23 tablas. El espejo los reproduce. | Si siguen así. |
| **Roles de Postgres** | — | La foto solo cubre el esquema `public`. | Desconocido. El espejo tiene los de un Supabase local. `equitas_write_definer` y `equitas_review_server` no pueden existir allá: los crea el paquete. |
| **Catálogo `role`** | Informado por el usuario: 1 ADMIN «Administrador del sistema», 2 USER «Usuario estándar»; una membresía activa con ADMIN. | Los valores no están en la foto. | Si hay otros roles o más membresías. El espejo carga solo esos dos. |
| **Catálogo `debt_status` y sus claves** | No se pudo leer (cero filas sin sesión; un intento de ingreso el 09/11 respondió credenciales inválidas y no se reintentó). | Estructura: `id`, `key` única, `value`, `description`, `active`. | **Desconocido el contenido.** El espejo carga los ocho que declara el cargador de `main` (ACTIVE, OVERDUE, PAYMENT_PLAN, JUDICIAL, CERTIFICATE_ACTIVE, PAID, CANCELLED, UNKNOWN). Tomado del código, no observado. No incluye SUSPENDED. |
| **Estado de cada obligación** | — | — | **Desconocido.** El cargador de `main` solo asigna vigente, vencida o desconocida, por fecha. El conjunto a escala del espejo hace lo mismo y marca además un 3 % como pagada para poder medir esa exclusión. |
| **Otros catálogos** (`debtor_type`, `contact_type`, `document_type`, `person_type`, `person_status`, `currency`) | Existen `debtor_type` y `contact_type`. | Estructura. | Contenido desconocido. El espejo usa los del entorno local. |
| **Conteos** | — | Referencia histórica de octubre: del orden de 2.900 objetos y 56.000 obligaciones. | Los actuales. El conjunto a escala del espejo tiene 2.900 objetos y 55.684 obligaciones sintéticas. |
| **Registro público de cuentas** | — | — | Desconocido si Auth permite registrarse. Con políticas abiertas, una cuenta registrada leería todo. El espejo lo tiene deshabilitado. |
| **Firma de las credenciales de servidor** | — | — | Desconocido si el proyecto firma con el secreto compartido (HS256) o con claves asimétricas. De eso depende cómo se emite la credencial `equitas_review_server`. El espejo usa HS256, como cualquier Supabase local. |
| **Funciones y disparadores** | — | Una función de plataforma (`rls_auto_enable`) y disparadores de evento de plataforma, entre ellos el que recarga la Data API ante un cambio de esquema. | Si hay funciones propias. El espejo no tiene ninguna. |
| **Versión de Postgres y de la Data API** | La Data API responde `PGRST205` ante una tabla inexistente, que es el código que usa la aplicación para deducir el nivel de la base. | — | La versión de Postgres. El espejo usa 17. El paquete usa `create or replace trigger` (Postgres 14 o superior), `sha256` y `gen_random_uuid` nativos (13 o superior). |
| **Extensiones** | — | — | Desconocido. El paquete no necesita ninguna. |

## Qué no reproduce el espejo, a propósito

- Los cambios que el esquema local del repositorio hizo sobre tablas existentes para poder cargar archivos: identidades en los `id`, columnas vueltas opcionales, la columna nueva del perfil, los disparadores de versión sobre la cartera.
- Las tablas y funciones de importación.
- Datos reales: todo es sintético y se carga por SQL. Por eso el espejo **no verifica el recorrido de archivos**, que se acepta solo en el entorno local de la noche 7.

## Cómo se comprobó el espejo contra la foto

`back/.venv/bin/python scripts/espejo/equitas_espejo.py verificar-esquema` compara columna por columna (nombre, tipo, nulabilidad y valor por defecto), restricción por restricción (nombre, tipo y definición) y política por política. Resultado sobre el espejo recién creado, y otra vez después de aplicar y revertir el paquete: 146 de 146 columnas, 71 de 71 restricciones, 23 de 23 políticas, sin diferencias.
