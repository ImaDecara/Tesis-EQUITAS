# EQUITAS — resumen de la noche 7

**Estado: candidata local para tu prueba personal.** Rama `delivery/noche-7-entrega`, creada desde `delivery/noche-6-v1@f0fb8f8`, con commits solo locales. Sin push, merge, despliegue ni escrituras remotas. **No está lista para `main`:** falta tu prueba, la validación contra la base original y la publicación, que no fueron trabajo de esta noche.

Lo que sigue se probó en un entorno local con datos sintéticos. Donde se dice «comprobado», la tabla de la sección 6 indica con qué prueba, sobre qué commit y en qué entorno.

## 1. Qué entorno autentica y qué base recibe los archivos

- **Autentica:** el servicio de autenticación del Supabase **local** de este entorno (`http://127.0.0.1:55321`), con siete cuentas sintéticas. Las cuentas de producción no existen acá.
- **Recibe los archivos:** navegador → aplicación en `http://127.0.0.1:3100` → servicio de importación local (`http://127.0.0.1:8765`) → base **local** `equitas-n7-local` (`127.0.0.1:55322`).
- **Producción no interviene.** No se leyó ni se escribió ninguna base remota. El cargador sigue rechazando cualquier destino que no sea local y sus guardas no se tocaron. Si la aplicación no está conectada a una base local, «Cargar CSV» aparece deshabilitado y lo explica.
- Es un proyecto local nuevo, con otro identificador, otros puertos y otra carpeta privada (`~/.equitas-n7`) que la demo de la noche 6, que quedó detenida y conservada.

Un comando inicia todo y otro lo detiene (`scripts/local/equitas_local.py start | stop`); al arrancar imprime estas dos cosas. Guía paso a paso: [PRUEBA-MANUAL.md](PRUEBA-MANUAL.md).

## 2. Qué cambió respecto de la noche 6

**Acceso.** La aplicación usa los dos roles de la base original, ADMIN y USER, en lugar de los cuatro de la noche 6. Cualquier cuenta activa del municipio lee lo mismo. Lo nuevo que escribe o supervisa requiere ADMIN: cargar CSV, registrar decisiones, aprobar la propuesta de otra persona y los reportes de supervisión y de accesos. Cada rechazo dice por qué y cuál es el paso siguiente, sin ciclos de pantallas.

**Carga de CSV desde la aplicación.** Hay una entrada «Cargar CSV» en el menú. La persona elige los dos archivos y la fecha de corte; la aplicación valida el lote completo y lo publica todo o nada. El resultado dice qué entró, qué quedó en cuarentena y por qué, con archivo, fila y columna. Repetir el mismo lote no duplica; un lote con errores se rechaza sin tocar la cartera anterior; un lote con fecha posterior actualiza el tablero. Antes esto solo se podía hacer desde una terminal.

**Totales y pagadas.** Tres totales con una sola definición en toda pantalla y reporte: total registrado, deuda pendiente y deuda vencida. Una obligación pagada deja de contar como deuda pendiente, como vencida y en el puntaje. Es la única corrección de cálculo y por eso hay una versión nueva de reglas, la 1.1.0; la 1.0.0 no se editó.

**Lenguaje y navegación.** Menú en tres bloques (Trabajo, Análisis, Datos), sin entradas duplicadas. Una línea fija arriba dice municipio, fecha de la cartera, quién está usando la aplicación y con qué rol. Un solo nombre para cada cosa: «puntaje de prioridad» (antes aparecía también como severidad, riesgo o prioridad) y «grupos de trabajo» (antes colas).

**Ficha del caso.** Encabezado con cuatro datos: puntaje, grupo de trabajo, recomendación automática y decisión registrada. Cuatro pestañas: Resumen (con el desglose del puntaje y la regla aplicada), Obligaciones, Personas y contactos, Decisión.

**Decisiones a la vista.** La decisión registrada se ve en el encabezado de la ficha y en los listados, no solo en una pestaña. Recomendación automática, decisión registrada y aprobación se muestran como tres cosas distintas. Si la cartera cambió después, la decisión se marca «Registrada sobre datos anteriores». Hay una pantalla **Pendientes** con lo que espera algo de quien está mirando.

**Reportes.** Entrada «Reportes» en el menú, con los cinco reportes, qué es cada fila y sus definiciones. Los de decisiones y accesos identifican el caso; los códigos tienen su rótulo legible; todos declaran fecha de la cartera y versión de reglas; el total del reporte de casos coincide con el tablero. Una selección que no se puede evaluar avisa en lugar de entregar cero filas.

**Ayuda y estados.** Pantalla de ayuda con totales, puntaje (con sus tablas), grupos, decisiones, estados, carga y permisos. Un municipio sin cartera muestra una sola tarjeta que lo dice; un error de lectura nunca se muestra como vacío ni como cero.

**Entorno.** Proyecto local propio, cuentas sintéticas con contraseñas privadas, tres lotes de ejemplo descargables desde la pantalla de carga, y un comando `vaciar` que borra solo la base sintética de este entorno para repetir la prueba.

## 3. Las ocho funciones: qué quedó hecho, cómo comprobarlo y qué queda pendiente

Los pasos citados son los de [PRUEBA-MANUAL.md](PRUEBA-MANUAL.md).

| Función | Qué quedó hecho | Cómo comprobarlo | Qué queda pendiente |
|---|---|---|---|
| **Lectura de archivos CSV** | Pantalla «Cargar CSV» y paso de servidor que valida y publica con las mismas funciones del cargador por terminal. Resultados: cargado, ya estaba cargado, rechazado con errores ubicados, o falla del servicio (nunca presentada como error del archivo). | Pasos 2, 10, 11 y 12. | Excel/XLSX. Formatos de otros municipios (mapeo editable). La carga en una aplicación publicada y en la base de producción: [REQUISITOS-PENDIENTES.md](REQUISITOS-PENDIENTES.md). |
| **Segmentación** | Cinco grupos de trabajo por seis reglas fijas aplicadas en orden; la aplicación las explica en «Grupos de trabajo», en la ayuda y en cada caso. Un solo nombre por grupo. | Paso 3: un caso de ejemplo por grupo y la regla que lo ubicó. | Validación municipal o académica de criterios y umbrales. |
| **Puntaje de prioridad** | Puntaje de 0 a 100 por reglas, con un solo nombre y la aclaración de que no es una probabilidad de pago. Las pagadas no puntúan. La ficha muestra el desglose. | Paso 4: 20 + 20 + 5 = 45 en `DEMO6-6-60012`. Casos chicos: `docs/tesis/casos-chicos-v1.md`. | Validación de umbrales y pesos. |
| **Estrategias de acción** | Recomendación automática con su explicación; decisión registrada por una cuenta ADMIN; aprobación por otra persona para intensidad 3 y 4; aviso cuando la cartera cambió; pantalla Pendientes. | Pasos 5, 6, 7 y 12. | Validación de costos y de la escala de intensidad (el contrato la declara provisional). Canal con el contribuyente. |
| **Tablero** | Tres totales definidos, grupos, casos sin contacto y distribuciones, en lenguaje claro; estado sin cartera. | Pasos 1, 3 y 12: los totales coinciden con los esperados y con el reporte. | Maquetas formales. |
| **Reportes** | Cinco CSV desde el menú, con fecha, definiciones, identificador del caso y rótulos; aviso de selección incompleta. | Paso 9. | Otros formatos. Resultados de impacto: requieren datos reales y un período de uso que no existen. |
| **Pruebas** | Suites de frontend y backend con ADMIN y USER, casos chicos de cálculo en cada consumidor, la carga de punta a punta en navegador real y campañas locales. | Sección 6 de este documento. | Prueba de usabilidad con personas. Campaña remota contra la base de testing. Revisión de seguridad de la importación. |
| **Ajustes finales** | Las correcciones del diagnóstico previo, en el orden del encargo. | El recorrido manual completo. | Lo que enumera la sección 7. |

## 4. Estados de las obligaciones: lo que no se sabe

Se repite acá la incertidumbre exacta, porque condiciona cualquier cifra que se muestre con datos reales:

- **No se sabe qué estados existen hoy en el catálogo de producción.** El catálogo vivo (`debt_status`) no se pudo observar: no hubo acceso de lectura ni un resultado pegado. Lo que se conoce es el código de `main`, que declara ocho estados.
- **No se sabe qué estado tienen hoy las obligaciones de producción.** El cargador de `main` solo asigna tres, por fecha de vencimiento: vigente, vencida y desconocida. Que haya o no obligaciones en otros estados no se pudo comprobar.
- **No está definido quién decide cómo se computa cada estado.** Esa definición es del municipio, no del sistema.

Qué hace esta entrega con eso:

- No hay regla nueva para ningún estado salvo «Pagada». Una obligación suspendida, en plan de pago, judicial, con certificado o cancelada se computa por importe y vencimiento, igual que en `main` y que en las reglas 1.0.0.
- La pagada se reconoce únicamente por la clave exacta `PAID` del catálogo. Un estado ausente o no reconocido no convierte una obligación en pagada.
- «Suspendida» no existe en `main`: la agregó el catálogo local porque el archivo de ejemplo la distingue. No se renombró ningún estado ni se reclasificó ninguna obligación.

## 5. Diferencias y decisiones que conviene que conozcas

- **Rol no reconocido.** Una cuenta cuyo rol no es ADMIN ni USER no entra, y la pantalla lo explica. En `main` cualquier membresía activa lee todo, sin mirar el rol. Es una diferencia deliberada: con un rol desconocido no se puede decir qué puede hacer esa cuenta.
- **Ver decisiones con USER.** Una cuenta USER ve la decisión registrada de cada caso y su estado (sin el texto libre). La tabla de permisos del encargo no tiene una fila para eso; se resolvió como «lectura de lo que ya está en el caso». Si preferís que solo ADMIN las vea, es un cambio de una línea por capa.
- **«Confirmación de carga» en el registro de accesos** significa que se pidió confirmar una carga, no que terminó bien: se anota antes de publicar. El resultado está en el lote.
- **El perfil guardado por objeto se recalcula solo al publicar una carga.** Las pantallas no dependen de él: calculan al leer.
- **Un caso con una obligación sin importe:** la pantalla muestra «$ 0 con 1 dato faltante» y el perfil guardado deja la deuda vencida vacía. Es una diferencia declarada entre los dos, documentada en los casos chicos.
- **Obligaciones sin vencimiento o sin importe no se pueden mostrar cargando un CSV:** la validación deja ese objeto en cuarentena. Los casos chicos que los cubren se prueban en las suites, no en el recorrido de pantalla.
- **La compilación de la demo de la noche 6 queda invalidada** al compilar esta entrega en la misma carpeta. Su base y sus cuentas se conservan; para volver a abrirla hay que recompilarla desde su rama.
- **Este hilo corrió con Claude Fable 5.2**, no con Opus 5.5 como pedía el arranque. El advisor fue otra instancia de Fable 5.2 con esfuerzo extra alto. Los subagentes de implementación y de pruebas fueron Opus 5.5. La prueba final la hizo Codex (gpt-6-astra), de otro proveedor.

### Consultas al advisor y consejos que no se siguieron

Se lo consultó antes de escribir código, antes de dar por buenas las migraciones, antes de tocar la guarda de auditoría (el diseño primero y lo implementado después), y antes y después de la prueba final. No hubo ningún fallo que sobreviviera a dos intentos, así que esa consulta no hizo falta. Las consultas, con los archivos que se le pasaron, están en la carpeta de evidencia.

Lo que se hizo distinto de lo que aconsejó, y por qué:

| Consejo | Qué se hizo | Por qué |
|---|---|---|
| Que la carga desde la aplicación reutilice la función de publicación del cargador por terminal, con parámetros. | El paso de servidor llama a las mismas funciones de la base, pero con su propia secuencia. | Necesita el recibo de cierre y distinguir «rechazado» de «sin respuesta», que esa función no devuelve. |
| Mover la tabla de permisos de la base a otro esquema. | Quedó en el esquema público. | Lo dejó como opcional; la función es pura y solo `authenticated` puede ejecutarla. |
| En nivel base, comprobar el nivel antes que la credencial al abrir un caso. | Se intenta registrar siempre; solo si falla se consulta el nivel. | No agrega una consulta a cada apertura en el nivel normal y nunca omite un registro que se podía escribir. En su revisión posterior lo consideró más estricto que lo pedido. |
| Comprobar el nivel de forma explícita en cada lectura. | En las lecturas la comprobación se dispara solo si una lectura normal ya respondió que la tabla no existe; en reportes es explícita. | Ninguna consulta de más en el camino normal. Lo dio por suficiente. |
| Que las rutas de carga también respondan «no disponible en esta base». | No se hizo. | Opcional: en nivel base esas rutas no escriben y la pantalla ya lo explica. |

## 6. Qué se ejecutó, sobre qué commit, en qué entorno y con qué resultado

Las cifras de noches anteriores son antecedentes; esta tabla solo trae lo ejecutado esta noche.

| Qué | Commit | Entorno | Resultado |
|---|---|---|---|
| Controles de calidad del repositorio (`quality/ci.py` y `gates.py`) | `1923260` | Esta máquina, sin base (dobles de prueba) | **Aprobado.** 4.882 pruebas (2.548 de frontend y 2.334 de backend), 0 fallas, 0 omitidas. Cobertura de líneas nuevas: 98,6 % en frontend y 96,8 % en backend. Duplicación 0,78 %. Sin errores ni advertencias de análisis estático. Dependencias sin hallazgos de producción. |
| Recorrido de aceptación en navegador real (Chromium automatizado, 21 comprobaciones): acceso con las siete cuentas, municipio vacío, carga válida, repetida y con errores, cálculos del caso de referencia, decisión, propuesta y aprobación con otra cuenta, reportes contra el tablero, segundo corte, 1440 y 390 px | `1923260` | Entorno local de la noche 7 (`equitas-n7-local`), base recién creada, compilación real del comando de inicio | **21 de 21**, consola sin errores. Estado final en la base: cartera al 31/10/2026, 20 objetos, 2 decisiones, 1 aprobación. |
| Persistencia: detener todo, volver a iniciar y comprobar | `1923260` | El mismo | **2 de 2**: la cartera, las decisiones y la aprobación siguen ahí y a la vista. |
| Campaña de reportes por HTTP contra base real | `1923260` | Proyecto local descartable `equitas-n7-campanas` | **1.235 comprobaciones, 0 fallas**, 118 solicitudes. **Sin las cuatro fallas viejas.** |
| Comprobación local de acceso (los 12 casos de la campaña de acceso, como adaptación local declarada) y humo de cinco pasos | `1923260` | El mismo | **12 de 12** y **5 de 5**, sin errores de consola. |
| Decisiones contra base real: comprobaciones SQL y HTTP | `aa4884a` | El mismo | 393 casos SQL, 0 fallas; 161 casos HTTP, 0 fallas; 55 pruebas del ejecutor en verde. |
| Campaña de revisión por HTTP | `aa4884a` | El mismo | **75 de 75**, validador aprobado. |
| Importación contra base real, incluida la carga nueva desde la aplicación | `aa4884a` | El mismo | **272 pruebas, 0 fallas** (carga 7, API 93, ruta de Next 26, cargador y publicación 92, reintento 3, validación previa 49, tope de bloqueo 2). |
| Migraciones nuevas (acceso ADMIN/USER, consulta de recibo, perfil con reglas 1.1.0) | `aa4884a` | Bases locales creadas desde cero | Se aplican en orden sobre una base vacía; la de acceso trae su propia comprobación de cierre. El perfil guardado coincide con la definición 1.1.0 en todos los objetos (0 diferencias). |
| Espejo de la base original: esquema contra la foto, paquete mínimo, cartera heredada, políticas de lectura | `f6ab3d8` | Proyecto local `equitas-n7-espejo` | Ver sección 7 y sus anexos. |
| Aplicación sobre el espejo, en navegador real: nivel base (con y sin credencial de servidor) y con el paquete | `f6ab3d8` | El mismo | Nivel base: sin escrituras en los datos, consola sin errores. Con el paquete: decisión registrada, propuesta pendiente, cinco reportes. |
| **Prueba final independiente**, hecha por otro proveedor (Codex gpt-6-astra) usando la aplicación en un navegador real | `f6ab3d8` | Entorno local de la noche 7, base recién creada | Recorrió los 15 pasos del encargo. **Todo el recorrido funcional dio bien**: acceso y rechazos con las siete cuentas, carga válida, repetida, con errores y segundo corte, cálculos, decisión y aprobación con otra cuenta, reportes contra el tablero, reinicio y persistencia; consola sin errores propios de la aplicación. Encontró **cuatro fallas de presentación y una duda visual**, sin pérdida ni alteración de datos. Detalle y qué se hizo con cada una, abajo. |
| Reverificación puntual de las correcciones posteriores a la prueba final, **hecha por el coordinador** (navegador real; 390, 768, 1024, 1280 y 1440 px) | `1923260` | El mismo, compilación real | **17 de 17** sobre las correcciones, consola sin errores, más dos comprobaciones propias de lo que el probador no llegó a ejecutar (abajo). |

Los cambios posteriores a `aa4884a` no tocan lo que prueban las campañas de decisiones, revisión e importación: `f6ab3d8` agrega una línea de registro al abrir un caso en nivel base y endurece los scripts del espejo, y `1923260` son las cinco correcciones de presentación posteriores a la prueba final. Las campañas de reportes y de acceso sí se repitieron sobre `1923260`.

El commit de entrega agrega solo documentos sobre `1923260`.

### Lo que encontró la prueba final y qué se hizo

La hizo Codex en un navegador real **automatizado**: el uso de computadora no estuvo disponible en su ejecución, y lo declaró al principio de su informe, como preveía el encargo. Declaró también cobertura parcial en dos pasos: abrió los reportes como archivos de texto estructurado y no en una planilla, y no probó todas las combinaciones posibles de filtros. Informe completo, con capturas: `PlanToFinish/DeliveryPlan/2026-10-28-v2/execution/evidence/noches/noche-7-prueba-final/INFORME.md`.

| Hallazgo | Qué era | Qué se hizo |
|---|---|---|
| El objeto en cuarentena no se identifica | La carga decía archivo, fila y columna del error, pero no qué caso era. | **Mitigado, no resuelto.** La pantalla ahora explica cómo ubicarlo en el archivo: la columna `ClaveAgrupacion` une las filas de un objeto, y su identificador es la columna `Identificador` de la cabecera. Mostrar el identificador directamente queda **pendiente**: el servicio de carga, a propósito y con pruebas que lo fijan, no devuelve ningún valor del archivo; cambiarlo toca el cargador compartido y no correspondía hacerlo sin otra verificación independiente. |
| Un lote rechazado decía «Objetos incorporados: 15 de 21» | Contradecía «El lote no se cargó». No se había cargado nada: un rechazo no llega a publicar. | **Corregido.** Dice «Objetos sin errores en el archivo: 15 de 21. No se incorporó ninguno». Vale para cualquier resultado que no sea una carga completada. |
| En Personas, «Sin contacto» no seguía la búsqueda | Mostraba el total de la cartera aunque la búsqueda no encontrara a nadie. | **Corregido.** Sale de la misma selección que los demás indicadores. Se revisó la misma situación en las demás pantallas con filtros: no la tenían. |
| A 390 px, los encabezados de «Casos» se superponían | La tabla se comprimía y la última columna quedaba recortada. | **Corregido** en las cinco pantallas con tablas de casos, también en anchos intermedios: la tabla conserva un ancho mínimo, se desplaza dentro de su marco y un aviso lo dice. Comprobado a 390, 768, 1024, 1280 y 1440 px. |
| Duda: el gráfico de bandas del tablero no se veía en sus capturas | — | **Duda aclarada.** En el commit que probó, el anillo estaba dibujado (se comprobó en la página: tres sectores, a 1440 y a 390 px); en escritorio medía 117 px de ancho. Igual se mejoró: ahora ocupa el ancho de la tarjeta, con la leyenda debajo, y se dibuja sin animación de entrada. |
| Incidencia de su herramienta | Las capturas de su primer navegador dejaron de responder. | No es del producto ni del entorno de la aplicación. Siguió con otro navegador real. |

**Lo que el probador no llegó a ejecutar**, y que por eso no tiene verificación independiente:

- **Objetar una propuesta.** Solo probó aprobar y el bloqueo de la autoaprobación. Comprobación propia del coordinador, en navegador real sobre `1923260`: una cuenta ADMIN propuso una acción de intensidad 3, otra cuenta ADMIN la objetó con motivo, y quedó «Propuesta objetada» en la ficha y en el listado para las tres cuentas del municipio, y en Pendientes de quien la propuso.
- **Cargar con una fecha anterior a la vigente.** Vio el aviso y no confirmó, como se le pidió. Comprobación propia del coordinador: repetir un lote ya cargado con su misma fecha responde «ya estaba cargado» y no cambia nada; un lote distinto con fecha anterior se carga y la cartera pasa a mostrarse con esa fecha, como dice el aviso, con las decisiones marcadas «sobre datos anteriores».

Después de la prueba final el encargo permite un solo ciclo de correcciones y una reverificación puntual, sin volver a lanzar al probador independiente. Eso es lo que se hizo. **Las correcciones están hechas y reverificadas por el coordinador; ningún probador independiente volvió a mirarlas.** Y la prueba final, como todo lo demás, es local: no dice nada sobre la base original ni sobre una aplicación publicada.

Evidencia: `PlanToFinish/DeliveryPlan/2026-10-28-v2/execution/evidence/noches/noche-7-entrega/` (recorrido con capturas, controles de calidad, espejo, consultas al advisor) y, para las campañas, la carpeta privada `~/.equitas-n7-campanas/evidencia/`.

## 7. Segunda parte: compatibilidad con la base original (ensayada en un espejo local)

No condiciona lo anterior. Estado: **avanzada en local; nada validado en remoto.** Detalle y decisiones: [REQUISITOS-PENDIENTES.md](REQUISITOS-PENDIENTES.md).

| Punto | Estado | Evidencia |
|---|---|---|
| Espejo local de la base original | Hecho. Coincide con la foto de octubre: 146 columnas, 71 restricciones, 23 políticas. Lista de lo comprobado, lo tomado de la foto y lo desconocido. | [anexos/espejo-comprobado-foto-desconocido.md](anexos/espejo-comprobado-foto-desconocido.md) |
| Nivel base (la app sobre esa base sin ningún cambio) | Hecho y probado en navegador real sobre el espejo: ADMIN y USER entran, ven tablero, listados, grupos, puntaje y ficha; **la aplicación no escribió nada en los datos** (con y sin credencial de servidor); lo nuevo dice «no disponible en esta base». | `front/tests/integration/base-level.integration.test.ts`; [REQUISITOS-PENDIENTES.md](REQUISITOS-PENDIENTES.md) §2 |
| Propuesta mínima de base | Hecha: un script idempotente, con verificación de solo lectura y reversa. Aplicado, repetido sin cambios, revertido y reaplicado **solo en el espejo**. | [anexos/espejo-paquete-minimo.md](anexos/espejo-paquete-minimo.md) |
| Registro de la cartera ya cargada | Hecho: función de un solo uso por municipio, con fecha declarada. La aplicación muestra «(fecha declarada)». Con el paquete y ese registro, en el espejo la app registró una decisión, dejó una propuesta pendiente y entregó los cinco reportes. | mismo anexo, sección 2 |
| Cambio de políticas de lectura | Hecho como script separado, con reversa. Probado por la Data API con cinco cuentas, antes y después. | mismo anexo, sección 3 |
| Rendimiento | Medido a escala (2.900 objetos, 55.684 obligaciones). La ficha pasó de 98 consultas a 33. Los listados siguen en unas 95 consultas por pantalla. Sin caché; propuesta escrita. | [anexos/rendimiento.md](anexos/rendimiento.md) |
| Comprobación local de acceso | Hecha como adaptación local declarada, en un proyecto local propio de esa comprobación. La campaña original y sus archivos no se tocaron. | [anexos/campanas-locales.md](anexos/campanas-locales.md) |
| Carga de CSV en una aplicación publicada | Solo documentada, como pedía el encargo. | [anexos/carga-desplegada-requisitos.md](anexos/carga-desplegada-requisitos.md) |

Un hallazgo de esta parte cambió el producto: una cartera que existe pero no tiene ningún lote publicado **ya no se oculta**. Se muestra con la fecha del día y la pantalla lo dice. «Sin cartera cargada» queda solo para un municipio sin ningún caso.

## 8. Lo que no se verificó

- **Nada contra una base remota.** Ni producción ni testing: ni lectura ni escritura. La corroboración de los estados de producción queda pendiente, como se decidió.
- **Nada en una aplicación publicada.** Sin Vercel, sin despliegue.
- **Rendimiento con red real** entre la aplicación y la base.
- **El panel y las variables de Vercel**, y cómo firma las credenciales el proyecto original.
- **Uso con datos reales** y con personas del municipio. No hay prueba de usabilidad.
- **Otras plataformas**: todo se probó en macOS con Docker Desktop.
- **Suites de importación a escala** contra la base real (duran mucho; quedaron fuera esta noche).
- **Recorridos de humo de noches anteriores** que todavía nombran los cuatro roles viejos (`front/tests/smoke/demo-local-walkthrough.mjs`, `review-a11y.mjs`, `thesis-flow-smoke.mjs`, `analytics-a11y.mjs`, y `front/tests/local-dal`, `local-audit`). No se actualizaron ni se ejecutaron; el recorrido vigente es `n7-local-walkthrough.mjs`.

## 9. Pendiente que no entró

- Excel y otros formatos de archivo.
- Cuando falla la lectura de los contactos de un caso, la ficha avisa del error de lectura pero además muestra el aviso «sin contacto activo cargado», que en ese momento no puede afirmar.
- Los reportes de decisiones, supervisión y accesos leen toda la cartera para tomar identificadores y fecha.
- La compilación alternativa con webpack falla un chequeo de tipos generado en tres páginas; la compilación por defecto, que es la que se usa, no.
- Validación municipal o académica de reglas, pesos, umbrales, costos y escala de intensidad.
