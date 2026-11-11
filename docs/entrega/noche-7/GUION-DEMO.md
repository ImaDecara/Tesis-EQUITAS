# EQUITAS — guion de demostración (5 a 8 minutos)

Para mostrar sobre el **entorno local**, con datos sintéticos. Cada bloque dice qué mostrar, con qué cuenta, qué archivo, qué caso y qué decir. Los tiempos suman unos siete minutos.

## Preparación (antes de que empiece la demo)

1. `back/.venv/bin/python scripts/local/equitas_local.py vaciar --confirmar equitas-n7-local` y después `… equitas_local.py start`, para arrancar con el municipio vacío.
2. Dos ventanas de navegador en `http://127.0.0.1:3100`: una normal para `admin-a` y otra privada para `admin-b`. Las contraseñas están en `~/.equitas-n7/cuentas.txt`; no las proyectes.
3. Tené a mano la carpeta `front/public/ejemplos/carga-csv/`: lotes `1-cartera-2026-09-30`, `2-cartera-2026-10-31-con-errores` y `3-cartera-2026-10-31`.

Si algo falla en vivo: `… equitas_local.py status` dice qué está detenido.

---

## 1. Qué problema resuelve (30 s) — pantalla de ingreso

**Decir:** «Un municipio tiene miles de objetos con deuda y poca gente para gestionarlos. EQUITAS responde una pregunta: qué casos trabajar primero y por qué. Lo hace con reglas explícitas, que se pueden leer y discutir; no con un modelo estadístico.»

**Aclarar de entrada:** «Todo lo que van a ver corre en esta computadora, con datos sintéticos. No hay datos de personas reales.»

## 2. Cargar la cartera desde un CSV (1 min 30 s) — cuenta `admin-a`

**Mostrar:** ingresar. El tablero dice que el municipio todavía no tiene cartera. Menú **Cargar CSV**.

**Hacer:** elegir los dos archivos de `1-cartera-2026-09-30`, fecha de corte **30/09/2026**, **Cargar CSV**.

**Señalar en el resultado:** «Carga completada», 19 de 20 objetos incorporados y **1 en cuarentena**, con archivo, fila y columna del error.

**Decir:** «La cartera entra por la aplicación, no por una terminal. El archivo se valida completo antes de guardar: o entra el lote entero con su fecha, o no cambia nada. Un objeto con un dato inválido queda afuera y la pantalla dice exactamente qué corregir.»

## 3. El tablero (1 min) — cuenta `admin-a`

**Mostrar:** **Ver el tablero**. Arriba, «Cartera al 30/9/2026».

**Señalar:** Total registrado **$ 11.856.000**, Deuda pendiente **$ 11.742.450**, Deuda vencida **$ 11.222.450**; y los cinco grupos de trabajo.

**Decir:** «Tres totales con definiciones distintas y a la vista: todo lo registrado; lo que no está pagado; y, de eso, lo que ya venció a la fecha de la cartera. Las pagadas suman al total registrado pero no son deuda. Cada caso cae en un solo grupo de trabajo, por reglas que se aplican en orden.»

**Mostrar:** menú **Grupos de trabajo**, desplegar «Cómo se arma cada grupo».

**Decir:** «No es clustering ni aprendizaje automático: son seis reglas fijas. Sin contacto cargado, primero hay que mejorar los datos. Más de cinco años de atraso, revisión jurídica. Después, por puntaje: contacto y plan, recordatorio o seguimiento.»

## 4. Un caso, con su explicación (1 min 30 s) — cuenta `admin-a`

**Mostrar:** abrir **`DEMO6-6-60012`**.

**Señalar:** puntaje **45 de 100**, banda media, grupo **Recordatorio**. En «Por qué tiene esta prioridad»: 20 puntos por importe, 20 por atraso (263 días) y 5 por cantidad de obligaciones vencidas. En «Totales del caso»: registrado **$ 141.350**, pendiente **$ 93.350**, vencida **2 obligaciones por $ 93.350**.

**Mostrar:** pestaña **Obligaciones**: una pagada, una suspendida, una vencida.

**Decir:** «El puntaje es una suma de tres factores con tablas publicadas en la ayuda; no es una probabilidad de pago. Este caso tiene una obligación pagada, que no cuenta, y una suspendida, que se computa como cualquier otra porque nadie definió todavía una regla distinta para ese estado. Esa definición le corresponde al municipio, no al sistema.»

## 5. Recomendación, decisión y aprobación (1 min 30 s) — cuentas `admin-a` y `admin-b`

**Mostrar** (`admin-a`): pestaña **Decisión** de `DEMO6-6-60012` → «Aceptar la recomendación» → **Registrar decisión**. El encabezado pasa a mostrar la decisión y quién la registró.

**Decir:** «El sistema recomienda; una persona decide y queda registrado quién, cuándo y sobre qué datos. El sistema nunca recomienda más que un contacto con plan.»

**Mostrar** (`admin-a`): abrir `DEMO6-1-60013` → **Decisión** → «Modificar la acción» → *Intimación administrativa formal (intensidad 3)* → completar y **Registrar propuesta**. Queda «Propuesta pendiente de aprobación».

**Mostrar** (`admin-b`, en la ventana privada): menú **Pendientes** → la propuesta está en «Para aprobar u objetar» → abrirla → **Aprobar la propuesta**.

**Decir:** «Las acciones más intensas no las cierra una sola persona: quien propone no puede aprobar lo suyo, y la aplicación lo comprueba por identidad, no por un permiso.»

## 6. La cartera cambia (1 min) — cuenta `admin-a`

**Hacer:** **Cargar CSV** con `2-cartera-2026-10-31-con-errores`, fecha **31/10/2026**. Resultado: «El lote no se cargó», con cinco errores ubicados por archivo, fila y columna.

**Decir:** «Un lote con demasiados errores se rechaza entero. El tablero sigue mostrando la cartera anterior.»

**Hacer:** cargar `3-cartera-2026-10-31` con la misma fecha. «Carga completada». El tablero pasa a «Cartera al 31/10/2026».

**Mostrar:** abrir `DEMO6-6-60012`: aviso **«Registrada sobre datos anteriores»**.

**Decir:** «La decisión de recién no se pierde ni se da por vigente sin más: la aplicación avisa que se tomó con otra foto de la cartera y la deja en Pendientes para revisarla.»

## 7. Reportes (30 s) — cuenta `admin-a`

**Mostrar:** menú **Reportes** → descargar **Casos por grupo de trabajo** y abrirlo.

**Decir:** «Cinco reportes en CSV. Cada fila declara la fecha de la cartera y la versión de reglas; el total coincide con el tablero. Cada descarga queda registrada.»

## 8. Límites, dichos con claridad (30 s)

**Decir:**

- «Es una demostración local con datos sintéticos. No se probó contra la base de producción ni en una aplicación publicada: lo que haría falta está enumerado en un documento aparte.»
- «Los umbrales, los pesos del puntaje y la escala de intensidad son provisionales: no tienen validación municipal ni académica.»
- «Lee CSV en un formato; Excel y otros formatos municipales quedan pendientes.»
- «No hay resultados de impacto: para eso hacen falta datos reales y un período de uso, que no existen todavía.»

---

## Si preguntan

| Pregunta | Respuesta corta |
|---|---|
| ¿Usa inteligencia artificial para decidir? | No. Segmentación y puntaje son reglas determinísticas, versionadas y con casos de referencia. |
| ¿Qué pasa con las obligaciones suspendidas, en plan o judiciales? | Se computan por importe y vencimiento, igual que antes. La única corrección de esta versión es que las pagadas dejan de contar como deuda. Qué regla le toca a cada estado lo tiene que definir el municipio. |
| ¿Quién puede cargar y decidir? | Las cuentas ADMIN. Las cuentas USER leen lo mismo y descargan reportes de lo que ven. |
| ¿Se puede publicar ya? | No está probado. Faltan requisitos sobre dónde corre el servicio de importación y sobre la base de destino; están en `REQUISITOS-PENDIENTES.md`. |
| ¿Qué es la versión de reglas? | El conjunto de reglas con el que se calculó. La vigente es la 1.1.0; una decisión guarda la versión con la que se tomó. |

Detalle técnico de cada afirmación: `EXPLICACION-TECNICA.md`.
