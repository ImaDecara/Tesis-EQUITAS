# Interfaz de la entrega final

Qué se recuperó de `main`, qué se conservó de la noche 7, qué se descartó y qué cambia para la persona. Pensado para lo que se va a ver publicado: la base original, sin el módulo de decisiones, en **nivel BASE** (solo consulta: iniciar sesión, ver la cartera, consultar casos).

## Lo que cambia para la persona, por pantalla

| Pantalla | Qué cambia |
|---|---|
| **Marco (todas)** | Fondo y menú institucional de `main` (degradé, separadores por bloque, logo más grande). Nueva entrada **Analítica** en «Análisis». La línea de contexto, sin fecha de corte acreditada, dice **«Cálculo al D/M/AAAA · Actualización de la cartera: no registrada»**: la fecha con la que se calcula no se presenta como la fecha de la cartera. En nivel BASE aparece **una sola vez** la etiqueta «Modo consulta», que se despliega y explica qué no está en esta base; en el menú, Pendientes, Cargar CSV y Reportes llevan «no disponible» (siguen visibles: la pantalla explica). |
| **Tablero** | Seis indicadores en dos filas de tres (importes arriba, casos abajo), con una frase corta cada uno; las coberturas pasan al desplegable «¿Qué significan estas cifras?». **Resumen operativo** de tres frases con cifras de la selección (de `main`, sin porcentajes inventados: si falta un dato, lo dice). Una acción principal: **«Trabajar por grupos»**. En nivel BASE no ofrece «Ver reportes». Los gráficos se dibujan sin animación de entrada. |
| **Casos, Grupos de trabajo, Casos sin contacto** | En nivel BASE la columna «Decisión registrada» (que solo podía mostrar «—») se reemplaza por **«Ver detalle»**, como en `main`, y desaparece el aviso del módulo en cada listado. En Grupos de trabajo, el enlace del caso abre el resumen y no la pestaña «Decisión», que en esa base no tiene uso. Con el módulo, todo sigue como en la noche 7. |
| **Ficha del caso** | Debajo del encabezado (puntaje, grupo, recomendación, decisión), una **síntesis económica** (deuda pendiente, deuda vencida, atraso máximo) y el **contacto principal**, con enlace a «Personas y contactos», como en `main`. Botón **«Preparar mensaje»** (ver [WHATSAPP-PROVEEDOR.md](WHATSAPP-PROVEEDOR.md)). |
| **Analítica** (nueva, `/analytics`) | Cuatro conceptos que no se mezclan, con una frase cada uno, y la aclaración de que no modifica nada. Clusters aprendidos y experimento supervisado en secciones separadas, cada una con su propio estado de carga. Detalle abajo. |

## Analítica

- **Estados del clustering:** «Clusters calculados» (OK), «Datos insuficientes», «Nada que separar» (degenerado) y «No disponible». Los tres últimos no muestran grupos; «No disponible» aclara que no significa que la cartera no tenga grupos.
- **Resultado anterior** (`STALE`): aviso visible con la fecha del cálculo; nunca se presenta como calculado en esta consulta.
- **Fuente y fechas:** municipio, casos incluidos de cuántos y el mínimo, exclusiones con motivo y cantidad, fecha de cálculo del atraso frente a fecha de la cartera (de corte, declarada o «no registrada en esta base»).
- **Variables** con unidad, tratamiento y por qué se usan; **candidatos de k** con silueta, grupo más chico y elegibilidad; **separación** y **estabilidad** con su lectura (una separación débil lo dice en palabras); **perfil de cada grupo** con mediana y rango intercuartil en unidades originales; **cruce con los grupos de trabajo por reglas**, rotulado «descripción; no entra en el cálculo».
- **Experimento supervisado:** el rótulo exacto `SUPERVISED_LABEL` siempre visible, también cuando no hay resultados; veredicto arriba aunque el modelo no supere al baseline; datos, partición temporal (con embargo), modelos junto a los baselines, controles, historial real y limitaciones.
- **Solo agregados:** ningún identificador de caso, ninguna marca por caso, ningún enlace de un grupo a una lista. La pantalla pide el cálculo solo en esta ruta, dentro de `<Suspense>`; si un cargador falla, la sección dice «No disponible» y el resto sigue.
- En esta rama los cargadores de `lib/ml/server.ts` todavía devuelven «No disponible» (los completa otra persona). Los estados con datos se probaron con resultados sintéticos que cumplen el contrato (`front/tests/helpers/ml-fixtures.ts`), solo en pruebas.

## Recuperado de `main`

- Identidad visual: fondo en degradé, menú con separadores por bloque, logo.
- Tablero compacto con indicadores comparables y un resumen operativo breve.
- «Ver detalle» en las tablas cuando no hay nada mejor que mostrar en la última columna.
- Ficha con síntesis económica y contacto visible sin cambiar de pestaña.

## Conservado de la noche 7

- Las definiciones únicas de total registrado, deuda pendiente y deuda vencida, y el desglose del puntaje.
- El tratamiento de datos faltantes: una lectura fallida nunca se muestra como vacío ni como cero (también en el resumen operativo, la síntesis de la ficha y el panel de mensajes).
- Filtros, paginación y regreso al listado; accesibilidad (salto al contenido, pestañas ARIA, `aria-current`, textos para lectores de pantalla).
- La línea de contexto con municipio, persona, rol y fecha.
- La separación entre recomendación automática, decisión registrada y aprobación.
- La carga CSV desde el navegador, sin cambios.

## Descartado de `main`, y por qué

- **«Recomendación urgente», «Con contacto» y las insignias de riesgo con score**: no corresponden a las reglas vigentes o repetían otro indicador con otro nombre.
- **«Los 5 objetos con mayor deuda concentran X %»**: el gráfico «Casos con mayor total registrado» ya lo muestra con su definición; un porcentaje de concentración sin definición acordada es una métrica decorativa.
- **Nombres anteriores** («Dashboard ejecutivo», «Análisis de riesgo», «Objetos de deuda», «Score»): la noche 7 unificó el lenguaje y se mantiene.
- **Seis indicadores en una sola fila**: a 1440 px cortaba los importes en dos líneas.

## Comprobado

- Pruebas de páginas y unitarias nuevas: analítica en todos sus estados, borrador de WhatsApp (lógica y panel), ficha con síntesis, tablero y listados en nivel BASE, marco a 390 px.
- Navegador real (Chromium) a 1440 y 390 px, cuentas ADMIN y USER, contra el espejo local sintético en nivel BASE, a través de un proxy local de solo lectura que agregaba teléfonos sintéticos (código 555) a las respuestas. Sin escrituras. Las capturas quedan fuera del repositorio.
- No se cambiaron reglas, importes ni cálculos.

El recorrido de aceptación `front/tests/smoke/n7-local-walkthrough.mjs` no necesita cambios: los textos y selectores que usa siguen iguales con el módulo de decisiones presente (no se ejecutó en esta tarea porque escribe en la base de la demo).
