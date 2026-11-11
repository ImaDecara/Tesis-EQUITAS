# Rendimiento: mediciones en el espejo a escala

**Qué se midió.** La aplicación de esta rama, compilada para producción y corriendo en esta computadora contra el espejo local (`equitas-n7-espejo`) con la cartera sintética a escala: **2.900 objetos y 55.684 obligaciones** en un municipio. Para cada pantalla: tiempo hasta recibir el documento completo (mediana de tres pedidos) y cantidad de consultas a la Data API que dispara un pedido, contadas en el registro de la puerta de entrada de la base.

**Qué no se midió.** Nada de esto es producción. La base y la aplicación están en la misma máquina, así que el tiempo de red entre ambas es casi cero. En una aplicación publicada, cada consulta suma el viaje entre el servidor de la aplicación y la base; por eso el número que mejor predice el comportamiento real es la **cantidad de consultas**, no los milisegundos de esta tabla.

## Antes y después

Nivel base (la base sin ningún cambio, como la original hoy).

| Pantalla | Antes: tiempo | Antes: consultas | Después: tiempo | Después: consultas |
|---|---|---|---|---|
| Tablero | 1.168 ms | 95 | 1.174 ms | 95 |
| Casos | 910 ms | 96 | 971 ms | 96 |
| Grupos de trabajo | 946 ms | 96 | 943 ms | 96 |
| Casos sin contacto | 934 ms | 96 | 947 ms | 96 |
| Personas | 647 ms | 86 | 654 ms | 86 |
| Deuda y mora | 922 ms | 94 | 930 ms | 94 |
| Puntaje de prioridad | 1.122 ms | 95 | 1.145 ms | 95 |
| Acciones recomendadas | 932 ms | 94 | 989 ms | 94 |
| **Ficha de un caso** | **928 ms** | **98** | **105 ms** | **33** |

Con el paquete mínimo y la cartera heredada registrada (después del cambio):

| Pantalla o reporte | Políticas abiertas | Políticas por membresía | Consultas |
|---|---|---|---|
| Tablero | 1.136 ms | 1.207 ms | 93 |
| Casos | 932 ms | 970 ms | 94 |
| Grupos de trabajo | 921 ms | 1.031 ms | 94 |
| Ficha de un caso | 125 ms | 132 ms | 36 |
| Pendientes | 968 ms | — | 94 |
| Reportes (pantalla) | 59 ms | — | 8 |
| Reporte de casos (CSV, 1,2 MB) | 1.050 ms | 1.076 ms | 96 |
| Reporte de calidad de datos | 1.009 ms | — | 96 |
| Reporte de decisiones | 1.010 ms | — | 98 |
| Reporte de supervisión | 978 ms | — | 98 |
| Reporte de accesos | 1.017 ms | — | 98 |

Las políticas por membresía, con sus índices, costaron entre 2 % y 12 % más en esta medición.

## Qué se cambió

**La ficha ya no carga toda la cartera para mostrar un caso.** Antes leía todos los objetos y las 55.684 obligaciones del municipio (57 páginas) para quedarse con uno. Ahora lee los casos del municipio, busca ahí el pedido, y trae las obligaciones, personas, contactos y perfil **solo de ese caso**, con los mismos permisos que la lectura completa. El identificador de la dirección nunca filtra una consulta: primero se encuentra la fila entre los casos del municipio (`front/lib/data/raw-debtor-loader.ts`, `front/lib/server/dal.ts`). De 98 consultas a 33, y de 928 ms a 105 ms.

## Qué se encontró al medir

**La doble lectura del tablero ya no llega a la base.** El tablero pide la cartera dos veces (una para los casos y otra para el resumen de personas), pero las dos piden exactamente las mismas consultas dentro del mismo pedido y el servidor las resuelve una sola vez: se midió una sola lectura de obligaciones (57 consultas, no 114). Es un comportamiento del entorno de ejecución (consultas idénticas dentro de un mismo pedido se comparten), no una caché entre pedidos ni entre personas.

**Lo que domina es la lectura paginada de obligaciones.** De las ~95 consultas de cada listado, **57 son las páginas de obligaciones**, que se piden de a una porque cada página arranca donde terminó la anterior. Todas las pantallas que muestran totales necesitan todas las obligaciones, porque el puntaje y los totales se calculan al leer.

**Repeticiones menores dentro de un pedido**, que no se tocaron: la sesión y la membresía se verifican dos veces (4 a 6 consultas), y la fecha de la cartera se lee dos o tres veces (una al principio y otra al final, a propósito, para detectar una carga en medio de la lectura).

**Los reportes de decisiones, supervisión y accesos leen toda la cartera** para tomar el identificador visible de cada caso y la fecha, con la misma lectura que usan los listados. Podrían leer solo los casos (unas 10 consultas en lugar de 96), pero habría que duplicar cómo se arma el identificador, y hoy esa lectura única es lo que garantiza que el reporte diga lo mismo que la pantalla. No se cambió: los reportes son descargas ocasionales.

## Si sigue haciendo falta: propuesta, sin implementar

En esta máquina un listado tarda cerca de un segundo. En una aplicación publicada, con ~95 consultas y 57 de ellas una detrás de otra, hay que esperar varios segundos por pantalla. Hay que **medirlo allá** antes de decidir. Si resulta lento, estas son las opciones, de menor a mayor riesgo:

1. **Pedir las páginas de obligaciones en paralelo.** No cambia qué se lee ni agrega caché: pide de a varias páginas a la vez. Reduce la espera aproximadamente en proporción a cuántas se pidan juntas. Requiere cuidar que una carga en medio de la lectura siga detectándose (hoy se detecta comparando la fecha de la cartera antes y después).
2. **Que la base devuelva los totales por caso.** Una vista o función que entregue, por objeto, lo que hoy se calcula con todas sus obligaciones. Reduce las 57 consultas a unas pocas, pero pasa parte de las reglas a la base: habría que mantener una definición más, y los casos chicos tendrían que probarse también ahí.
3. **Caché de la cartera calculada.** Solo si las anteriores no alcanzan, y con estas condiciones, todas:
   - Nunca se guardan autorizaciones ni resultados por persona: sesión, membresía, rol y permisos se verifican en cada pedido.
   - La clave incluye el municipio y la cartera (el lote vigente): una cartera nueva no puede servir datos de la anterior.
   - Cargar un lote o registrar una decisión o una aprobación invalida lo guardado para ese municipio.
   - El registro de accesos se escribe igual en cada apertura de caso y en cada descarga, se sirva o no desde caché.
   - Se define cuánto dura y cómo se vacía a mano.

No se agregó ninguna caché.

## Cómo repetir la medición

`scripts/espejo/equitas_espejo.py cargar escala` deja la cartera a escala; `~/.equitas-n7-espejo/app.env` trae las dos variables públicas que una compilación local necesita para apuntar al espejo. Para el nivel base se arranca la aplicación sin la credencial de servidor ni la dirección del servicio de importación.
