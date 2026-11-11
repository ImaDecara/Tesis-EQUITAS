# Conexión original: alcance comprobado

Verificación del 11/11/2026. Proyecto original: `folyslqzqvnpolexcxjo`. **No se inició sesión en producción ni se enviaron escrituras o RPC remotos.** Por decisión del usuario, la prueba con una cuenta queda a cargo de la administración después de conectar la entrega.

| Aspecto | Estado y límite |
| --- | --- |
| Esquema que consultan estas lecturas | Comprobado mediante GET/HEAD anónimos, sin filas. Las cuatro tablas nuevas faltan: esquema BASE. |
| Datos visibles y corte | NO verificados con sesión. Sin conteos de objetos, obligaciones, personas, contactos, estados ni fechas reales. Cero filas anónimas no demuestra cartera vacía. |
| Sesión, membresía y RLS | NO verificados en la original. Tampoco se comprobó si una sesión puede leer otro municipio. Las pruebas de código conservan sesión validada, membresía activa, ADMIN/USER y alcance municipal en servidor. |
| Identidad del municipio | NO verificada en esta corrida. El antecedente «Municipalidad Demo» y la correspondencia con La Falda indicada por el usuario no constituyen identificación oficial; no se consultaron localidades ni códigos postales con sesión. |

Los tiempos y el recorrido autenticado de producción también quedan **NO verificados**. El espejo usa datos sintéticos y políticas de una foto anterior: no reemplaza esa comprobación.

## Arranque local

Desde la raíz del checkout, con Node `22.23.2`, las dependencias fijadas de `front/` y Python del entorno `back/.venv`. Creá `~/.equitas-original` con modo `0700` y `app.env` con modo `0600`, fuera de Git. El archivo admite solamente:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://folyslqzqvnpolexcxjo.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clave publicable de este proyecto>
```

No copies cuentas ni contraseñas al repo. Usá una terminal sin credenciales de servidor/importador y sin archivos `.env` de carga automática en este checkout.

```sh
back/.venv/bin/python scripts/original/equitas_original.py start
back/.venv/bin/python scripts/original/equitas_original.py status
back/.venv/bin/python scripts/original/equitas_original.py stop
```

`start` compila y sirve `http://127.0.0.1:3200/login`. Rechaza otro proyecto, credenciales administrativas, archivos inseguros y puerto ocupado; no detiene procesos ajenos. Usa `front/build/original-next` y estado/registros privados en `~/.equitas-original`. No inicia Docker ni importador, no aplica SQL y no modifica la demo N7 ni N6. `stop` verifica PID, inicio y carpeta antes de detener únicamente su aplicación.

Se comprobó compilación con solo las dos variables públicas de Supabase, sin JWT de servidor, y pantalla de ingreso en navegador: campos correo/contraseña y botón «Iniciar sesión». `/api/build-info` devolvió entorno `local`, ref original y SHA de código `2c5bf5b4112ccec706f849d18b1bae17ecaa4372`. No se completó el formulario. Una primera compilación falló por disco lleno; el reintento terminó correctamente. La inspección DOM funcionó; la herramienta de snapshot agotó su plazo y no se guardaron capturas.

## Sonda de las consultas modificadas

```sh
node scripts/original/verificar-lecturas.mjs esquema .quality/original-schema.json
```

La sonda importa `tenant-read-scope.ts` y `paginated-table-reader.ts` actuales mediante TypeScript ya instalado. Restringe destino/método antes de enviar y no imprime claves ni filas. Resultado observado: **18 solicitudes, 17 GET y 1 HEAD; 14 respuestas 200 y 4 respuestas 404 `PGRST205`; cero filas**.

- Los nueve `select` de cartera, con sus `!inner`, conversiones `::text`, filtros municipales y `order=id.asc`: `debtor`, `debtor_type`, `debt`, `debt_status`, `debtor_person`, `person`, `debtor_contact`, `debtor_profile`, `debtor_profile_detail`: 200 con `limit=0`.
- Obligaciones: HEAD, conteo exacto y rango `0..999`, mismo alcance y orden, identificador imposible `0`: 200, conteo 0.
- Columnas de identidad de `user`, `tenant_user`, `tenant`, `role`: 200 sin filas.
- `import_batch`, `case_review`, `case_review_approval`, `access_audit`: 404 `PGRST205` en las cuatro.

Un ensayo preliminar de rangos posteriores sobre un resultado vacío devolvió 416. Es un rango fuera del resultado, no evidencia de columna incompatible: el lector probado se detiene en la primera página cuando el conteo es cero. Los rangos siguientes se comprobaron con filas sintéticas en el espejo y con pruebas unitarias; no se atribuyen a producción.

## Ajustes hechos al integrar

Posteriores a la sonda de arriba; cada uno tiene su prueba.

- **Catálogo de estados.** `debt_status` vuelve a pedir `description`, que el mapeador usa como rótulo de respaldo cuando `value` viene vacío. Se comprobó con lecturas anónimas de cero filas que la columna existe en la original, y que ninguna otra columna alternativa que el mapeador aceptaría existe sin estar pedida en `debtor`, `debtor_contact`, `debtor_type` y `debt_status` (64 lecturas, todas GET, cero filas).
- **Qué cuenta como «no se puede saber» en nivel BASE.** Solo una tabla que no muestra ninguna fila del municipio. En la ficha, que un caso no tenga contactos, perfil u obligaciones es un dato normal mientras esa tabla sí muestre filas del municipio: así la ficha dice lo mismo que el listado. Si la tabla entera no muestra filas, la ficha tampoco afirma ausencia.
- **Índice anterior por persona.** `debtor_profile_detail` sin filas conserva el aviso propio de la noche 7 («dato que no existe para nadie») también en nivel BASE. No se informa como lectura fallida.
- **Municipio sin cartera, con el módulo instalado.** Sigue siendo un estado real (ahí empieza la carga de CSV), y un corte publicado sin casos sigue informando cero. En nivel BASE, donde nada certifica la ausencia, una cartera que no muestra casos es «no disponible».

## Comportamiento y rendimiento comprobados localmente

BASE se decide **antes** de crear el escritor: abrir una ficha no llama RPC, incluso si hay JWT de servidor configurado. Decisiones y reportes del módulo quedan no disponibles. CON_MODULO conserva auditoría obligatoria: si el registro falla, no se entrega la acción. Un esquema parcial, 401/403, columna faltante o fallo de conexión queda incierto/error; una tabla que no muestra ninguna fila del municipio no se presenta como ausencia confirmada (con las precisiones de «Ajustes hechos al integrar»). La ausencia del módulo no oculta las filas de cartera visibles.

`base-read-only-transport.integration.test.ts` registra método/ruta con el SDK real y transporte simulado en tablero, listados, búsqueda, personas, ficha, acciones y cinco reportes, con/sin JWT de servidor. También prueba las 14 combinaciones de módulo parcial, fallos y tablas ocultas. La analítica de este checkout todavía es un stub; su implementación posterior requiere repetir el recorrido al integrar.

`parallel-table-reader.test.ts` comprueba orden bigint, filtro municipal en cada página, hasta cuatro páginas simultáneas, límite efectivo del servidor y descarte completo ante página fallida, incompleta o conteo cambiado. No hay caché entre usuarios. No es una transacción entre solicitudes: una modificación concurrente que conserve conteo y orden podría no detectarse.

Espejo `equitas-n7-espejo` en `56321/56322`, **2.900 objetos y 55.684 obligaciones sintéticas**:

```sh
node scripts/original/verificar-lecturas.mjs espejo .quality/mirror-pagination.json
```

En las ocho tablas del cargador, el cursor previo hizo 82 consultas: 57 de obligaciones en serie; tiempos 596/540/541 ms. La paginación agrupada hizo 81 consultas: 56 de obligaciones en 15 tandas; tiempos 554/538/529 ms. Esta comparación usa el mismo alcance y datos y excluye Auth, layout y sondas. **No equivale a reducir las 95 consultas históricas de toda la pantalla a 81.**

La compilación de producción local contra el espejo, sin JWT, se recorrió por HTTP con sesión sintética y `trace-fetch.cjs` precargado. El comando `node scripts/original/recorrer-espejo.mjs .quality/mirror-http.json` requiere esa aplicación temporal en `3201`; actualmente está detenida. La traza solo guarda método/ruta sin parámetros, estado y duración, y bloquea operaciones prohibidas antes de enviarlas.

| Pantalla | Duraciones de tres corridas (ms) | Solicitudes Supabase / REST por corrida |
| --- | --- | --- |
| Tablero | 1443 / 1291 / 1263 | 106 / 104 |
| Casos | 1049 / 1011 / 991 | 107 / 105 |
| Búsqueda | 1004 / 1102 / 1998 | 107 / 105 |
| Ficha | 253 / 243 / 131 | 44 / 42 |

Reporte: una corrida, 501 esperado, 82 ms, 19/17 solicitudes. **Cero escrituras/RPC** en esos recorridos; todos los accesos REST fueron GET/HEAD. Los otros dos accesos por pantalla fueron validaciones Auth GET. Son tiempos HTTP locales, no tiempos de navegador autenticado ni garantías de latencia en Vercel. Las sondas agregadas explican parte del costo de la pantalla completa.

Pruebas reproducibles del arranque: `back/.venv/bin/python -m unittest discover -s scripts/original -p 'test_*.py'` (5 pruebas). Los controles completos y su integridad se ejecutan con `quality/ci.py` y `quality/gates.py`; leer `gate.json`, no el código de salida de `gates.sh`. Ver también [despliegue y reversión](DESPLIEGUE-Y-REVERSION.md).

Para detener el espejo sin borrar sus datos: `back/.venv/bin/python scripts/espejo/equitas_espejo.py stop`. Esto es independiente del `stop` de la aplicación original.
