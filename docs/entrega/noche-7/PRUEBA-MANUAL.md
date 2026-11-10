# EQUITAS — prueba manual (noche 7)

El recorrido completo, cuenta por cuenta, empezando por la carga del CSV. Cada paso dice qué hacer y qué se debe ver. Lleva unos 25 minutos.

**Todo ocurre en tu computadora, con datos sintéticos.** Producción no interviene en ningún paso.

## 0. Antes de empezar

Hace falta Docker en marcha. Desde la carpeta del repositorio:

```
back/.venv/bin/python scripts/local/equitas_local.py start
```

Al terminar, el comando imprime un cartel con las dos cosas que conviene tener presentes durante toda la prueba:

- **Quién autentica:** el servicio de autenticación del Supabase **local** (`http://127.0.0.1:55321`), con cuentas sintéticas. Las cuentas de producción no existen acá.
- **Qué base recibe los archivos:** navegador → aplicación en `http://127.0.0.1:3100` → servicio de importación local (`http://127.0.0.1:8765`) → base **local** `equitas-n7-local` (`127.0.0.1:55322`).

Para detener todo (conserva los datos): `back/.venv/bin/python scripts/local/equitas_local.py stop`. Para ver el estado sin cambiar nada: `… equitas_local.py status`.

**Cuentas.** Están en el archivo privado `~/.equitas-n7/cuentas.txt` (fuera de Git), con el correo, la contraseña y lo que se espera de cada una:

| Cuenta | Qué es | Municipio |
|---|---|---|
| `admin-a` | ADMIN | Municipio sintético A |
| `admin-b` | ADMIN (la otra persona que aprueba) | Municipio sintético A |
| `user` | USER | Municipio sintético A |
| `user-otro-municipio` | USER | Municipio sintético B (sin cartera) |
| `sin-membresia` | cuenta sin ningún municipio | — |
| `membresia-inactiva` | acceso desactivado | Municipio sintético A |
| `rol-no-reconocido` | rol que la aplicación no admite | Municipio sintético A |

**Archivos de ejemplo.** Se descargan desde la propia pantalla «Cargar CSV» (abajo de todo, «Archivos de ejemplo para descargar») y también están en `front/public/ejemplos/carga-csv/`:

| Lote | Carpeta | Fecha de corte | Qué pasa al cargarlo |
|---|---|---|---|
| Válido | `1-cartera-2026-09-30` | 30/09/2026 | Se carga |
| Con errores | `2-cartera-2026-10-31-con-errores` | 31/10/2026 | Se rechaza y no cambia nada |
| Fecha posterior | `3-cartera-2026-10-31` | 31/10/2026 | Se carga y actualiza la cartera |

Cada lote son **dos archivos** (`cabecera.csv` y `detalle.csv`) que se eligen juntos en el mismo selector.

---

## 1. Entrar y ver el municipio vacío — cuenta `admin-a`

1. Abrí `http://127.0.0.1:3100` e ingresá con `admin-a`.
2. **Se debe ver:** arriba, «Municipio sintético A» y «Admin A (cuenta sintética) · Administrador». El tablero dice que el municipio **todavía no tiene una cartera cargada** y ofrece ir a «Cargar CSV». No hay números en cero simulando datos.

## 2. Cargar el primer CSV — cuenta `admin-a`

1. Menú **Cargar CSV**. La pantalla explica qué dos archivos espera, sus columnas obligatorias, el separador, el formato de fechas e importes y los límites.
2. En «Archivos del lote» elegí **los dos** archivos del lote válido (`1-cartera-2026-09-30`). **Se debe ver:** la pantalla reconoce cuál es la cabecera y cuál el detalle por sus columnas.
3. En «Fecha de corte de los datos» poné **30/09/2026** y pulsá **Cargar CSV**.
4. **Se debe ver «Carga completada»** con este resumen:
   - Fecha de corte 30/9/2026 · Objetos incorporados **19 de 20** · Obligaciones en el archivo 36 · Personas en el archivo 20.
   - **1 objeto en cuarentena**, con el detalle: archivo Detalle, fila 35, columna `NOTD_vencimiento`, «Falta la fecha de vencimiento…». La pantalla no nombra el caso: explica cómo ubicarlo en el archivo (es `DEMO6-3-60019`).
   - 4 advertencias que no impiden la carga (marcadores de «no tiene» en contactos y una obligación sin estado).
5. Pulsá **Ver el tablero**.

## 3. Ver la cartera — cuenta `admin-a`

**Tablero.** Arriba dice «Cartera al 30/9/2026». Se debe ver:

| Indicador | Valor |
|---|---|
| Total registrado | $ 11.856.000 |
| Deuda pendiente | $ 11.742.450 |
| Deuda vencida | $ 11.222.450 |
| Casos con deuda vencida | 16 |
| Casos con puntaje alto | 6 |
| Casos sin contacto | 2 |

Grupos de trabajo: Mejorar datos 2 · Revisión jurídica 1 · Contacto y plan 4 · Recordatorio 7 · Seguimiento 5 (suman 19).

**Casos.** Menú **Casos**: 19 casos. Probá el buscador con `60012` y los filtros por puntaje, estado, tipo y contacto.

**Un ejemplo por grupo** (menú **Grupos de trabajo**; la pantalla explica la regla de cada uno):

| Grupo | Caso de ejemplo | Por qué está ahí |
|---|---|---|
| Mejorar datos | `DEMO6-3-60004` | No tiene un contacto activo cargado |
| Revisión jurídica | `DEMO6-3-60009` | Tiene una obligación vencida con más de 1.825 días de atraso (2.761) |
| Contacto y plan | `DEMO6-1-60003` | Puntaje 90, banda alta |
| Recordatorio | `DEMO6-6-60012` | Puntaje 45, banda media |
| Seguimiento | `DEMO6-6-60010` | Puntaje 20, banda baja |

## 4. El caso de referencia — cuenta `admin-a`

Abrí **`DEMO6-6-60012`**. Tiene tres obligaciones: una pagada de $ 48.000, una suspendida de $ 47.150 que venció el 10/01/2026 y una vencida de $ 46.200 que venció el 10/04/2026. **Se debe ver:**

| Dato | Valor |
|---|---|
| Total registrado | $ 141.350 |
| Deuda pendiente | $ 93.350 (la pagada no cuenta) |
| Deuda vencida | 2 obligaciones por $ 93.350 (la suspendida cuenta como cualquier otra) |
| Atraso máximo | 263 días |
| Puntaje de prioridad | 45 de 100, banda Media: 20 (importe) + 20 (atraso) + 5 (obligaciones vencidas) |
| Grupo de trabajo | Recordatorio |
| Recomendación automática | Recordatorio (intensidad 1) |
| Decisión registrada | «Todavía no hay una decisión registrada.» |

La pestaña **Obligaciones** muestra las tres, con su estado; **Personas y contactos**, el titular.

Otros casos chicos para comparar a mano: `DEMO6-6-60016` (solo pagadas: deuda pendiente $ 0, puntaje 0), `DEMO6-3-60017` (vencida con importe cero: no cuenta como vencida), `DEMO6-3-60011` (vence después de la fecha: sin deuda vencida), `DEMO6-1-60006` (dos titulares: el importe se cuenta una sola vez), `DEMO6-6-60018` (sin estado: se computa por importe y vencimiento).

## 5. Registrar una decisión — cuenta `admin-a`

1. En `DEMO6-6-60012`, pestaña **Decisión** → «Aceptar la recomendación» → **Registrar decisión**.
2. **Se debe ver:** en el encabezado del caso, «Recomendación aceptada: Recordatorio (intensidad 1)», «Registrada por vos (Administrador)…» y el estado **Decisión registrada**. En **Casos**, la fila del caso muestra «Decisión registrada».

Las tres cosas quedan separadas en la pantalla: la **recomendación automática** (la calcula el sistema), la **decisión registrada** (la toma una persona) y la **aprobación** (la da otra persona, solo para las acciones más intensas).

## 6. Proponer una acción que necesita aprobación — cuenta `admin-a`

1. Abrí `DEMO6-1-60013`, pestaña **Decisión** → «Modificar la acción».
2. Acción: **Intimación administrativa formal (intensidad 3)**. Motivo: cualquiera de la lista. Completá la lista de control (situación del hogar y las tres casillas) → **Registrar propuesta**.
3. **Se debe ver:** el estado **Propuesta pendiente de aprobación**, y la explicación de que la registraste vos y la tiene que aprobar **otra persona con rol ADMIN**. No hay botón para aprobarla.
4. Menú **Pendientes**: el caso aparece en tus propuestas en espera.

## 7. Aprobar la propuesta de otra persona — cuenta `admin-b`

1. Cerrá sesión e ingresá con `admin-b`.
2. Menú **Pendientes** → sección «Para aprobar u objetar (1)» → abrí `DEMO6-1-60013`.
3. Elegí **Aprobar la propuesta**, completá la lista de control y registrá.
4. **Se debe ver:** **Propuesta aprobada**, en la ficha y en el listado de casos.

## 8. Lo que ve una cuenta USER — cuenta `user`

1. Ingresá con `user`. **Se debe ver** el mismo tablero, los mismos casos y los mismos totales que `admin-a`.
2. **Cargar CSV:** «Tu cuenta no puede cargar CSV», con la explicación y a quién pedírselo. No hay selector de archivos.
3. Ficha de `DEMO6-1-60013`: se ve «Propuesta aprobada». En la pestaña **Decisión** no hay formularios; dice que registrar requiere una cuenta ADMIN.
4. **Pendientes:** «Tu cuenta no tiene tareas pendientes», con la explicación.
5. **Reportes:** puede descargar *Casos por grupo de trabajo*, *Calidad de datos* y *Decisiones registradas*. *Supervisión de decisiones* y *Registro de accesos* aparecen deshabilitados con «requiere una cuenta ADMIN».

## 9. Reportes — cuenta `admin-a`

1. Menú **Reportes** → descargá **Casos por grupo de trabajo**.
2. **Se debe ver** (abrilo con una planilla; el separador es punto y coma): 19 filas de detalle y una fila `TOTAL` con deuda pendiente **11742450** y deuda vencida **11222450**, las mismas cifras del tablero. La fila de `DEMO6-6-60012` trae 141350, 93350, 93350 y 263 días. Todas las filas declaran la fecha de la cartera y la versión de reglas.
3. Descargá **Decisiones registradas**: aparecen `DEMO6-6-60012` («Decisión registrada») y `DEMO6-1-60013` («Propuesta aprobada»), cada una con el identificador del caso.
4. *Supervisión de decisiones* y *Registro de accesos* se descargan con esta cuenta. Cada descarga queda anotada en el registro de accesos.

## 10. Volver a cargar el mismo lote — cuenta `admin-a`

Cargá otra vez el lote válido con la misma fecha (30/09/2026). **Se debe ver «Este lote ya estaba cargado»**: no se duplica nada y el tablero no cambia.

## 11. Cargar un lote con errores — cuenta `admin-a`

1. Cargá el lote `2-cartera-2026-10-31-con-errores` con fecha **31/10/2026**.
2. **Se debe ver «El lote no se cargó»**, con «Objetos sin errores en el archivo: 15 de 21. No se incorporó ninguno» y la lista de errores, cada uno con archivo, fila, columna y qué se esperaba. Los cinco errores puestos a propósito:

| Archivo | Fila | Columna | Problema |
|---|---|---|---|
| Detalle | 2 | `NOTD_vencimiento` | Fecha imposible |
| Detalle | 9 | `NOTD_totalActualizado` | Importe no numérico |
| Detalle | 18 | `NOTD_ESTA_id` | Estado de origen fuera de la lista |
| Cabecera | 15 | `Destinatario_Porcentaje` | Porcentaje inválido |
| Cabecera | 17 | `Bien_Tipo_Id` | Tipo de objeto fuera del catálogo |

3. Volvé al tablero: sigue diciendo **Cartera al 30/9/2026** con los mismos totales. La cartera anterior quedó intacta.

## 12. Cargar el lote corregido, con fecha posterior — cuenta `admin-a`

1. Cargá el lote `3-cartera-2026-10-31` con fecha **31/10/2026**.
2. **Se debe ver «Carga completada»**: 20 de 21 objetos.
3. Tablero: **Cartera al 31/10/2026**. Total registrado **$ 12.953.950** · Deuda pendiente **$ 12.828.400** · Deuda vencida **$ 12.308.400**. Ahora hay 20 casos (entró `DEMO6-1-60021`) y `DEMO6-6-60010` pasó a deuda pendiente $ 0 porque figura pagada.
4. Abrí `DEMO6-6-60012`: el atraso máximo pasó a 294 días, y la decisión que registraste en el paso 5 se ve con el aviso **«Registrada sobre datos anteriores: se registró con la cartera al 30/9/2026 y la vigente es al 31/10/2026. Conviene revisar el caso de nuevo.»**
5. Menú **Pendientes**: tus dos decisiones aparecen en «Tus decisiones registradas sobre datos anteriores».

## 13. Otras cuentas: rechazos con explicación

Cerrá sesión y probá cada una. Ninguna debe quedar en un ciclo de pantallas ni ver datos.

| Cuenta | Se debe ver |
|---|---|
| `user-otro-municipio` | Entra al **Municipio sintético B**, sin cartera cargada. No ve nada del municipio A. |
| `sin-membresia` | Vuelve a la pantalla de ingreso con «Tu cuenta no tiene acceso a ningún municipio» y a quién pedirle que lo revise. |
| `membresia-inactiva` | «Tu acceso al municipio está desactivado», con el mismo paso siguiente. |
| `rol-no-reconocido` | «Tu cuenta tiene un rol que esta aplicación no reconoce (admite ADMIN y USER)», con el mismo paso siguiente. |

## 14. Persistencia

Detené todo (`… equitas_local.py stop`) y volvé a iniciar (`… equitas_local.py start`). Ingresá con `admin-a`: la cartera al 31/10/2026, las dos decisiones y la aprobación siguen ahí.

## 15. Ayuda

Menú **Ayuda**: totales, puntaje (con las tablas de puntos), grupos de trabajo, recomendación / decisión / aprobación, estados de las obligaciones, cómo cargar un CSV, qué puede hacer cada cuenta y los límites de esta versión.

---

## Si algo no coincide

Anotá la cuenta, la pantalla, lo que hiciste, lo que esperabas y lo que viste. Si la pantalla de carga dice «La carga no se completó» o «No se pudo confirmar el resultado», el problema es del entorno (servicio de importación o base detenidos) y no del archivo: corré `… equitas_local.py status`.

Para repetir la prueba desde un municipio vacío:

```
back/.venv/bin/python scripts/local/equitas_local.py vaciar --confirmar equitas-n7-local
back/.venv/bin/python scripts/local/equitas_local.py start
```

`vaciar` borra **solo** la base sintética de este entorno (pide escribir su identificador) y conserva las cuentas y sus contraseñas. No alcanza a la demo de la noche 6 ni a ninguna base remota.

## Lo que esta prueba no demuestra

Demuestra el recorrido en un entorno local con datos sintéticos. No certifica producción, ni una aplicación publicada, ni el uso con datos municipales reales. Lo pendiente está en `REQUISITOS-PENDIENTES.md` y en `RESUMEN.md`.
