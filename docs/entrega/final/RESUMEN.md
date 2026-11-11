# EQUITAS — entrega final: resumen

Fecha: 11/11/2026. Rama `delivery/entrega-final`, sobre la candidata de la noche 7. Alcance y permisos: [ALCANCE.md](ALCANCE.md).

El SHA publicado y la base a la que apunta se leen en `https://tesis-equitas.vercel.app/api/build-info`. Este documento no los afirma: describe lo que se comprobó antes de publicar.

## Qué estado tiene cada cosa

| Qué | Estado |
|---|---|
| Tablero, listados, ficha, analítica y borrador de WhatsApp | **Funciona en local**, con datos sintéticos, en navegador y con pruebas. |
| La aplicación sobre una base como la original (sin el módulo de decisiones): solo consulta, sin ninguna escritura | **Compatibilidad ensayada en local** sobre el espejo. El espejo no es la original. |
| Lecturas de la candidata contra el esquema de la base original | **Comprobado sin sesión**: lecturas anónimas de cero filas. Columnas y relaciones existen. |
| Cartera real: datos visibles, permisos con sesión, correspondencia con La Falda, cantidades, tiempos, clustering sobre datos reales | **Validación remota pendiente.** Nadie entró con una cuenta durante esta entrega. |

## Qué hace la versión

- **Cartera.** Tablero con seis indicadores y un resumen operativo, listados con búsqueda y filtros, y ficha del caso con totales, puntaje de prioridad y regla aplicada. Sin fecha de corte registrada, la pantalla separa la fecha de cálculo de la fecha de actualización de la cartera. Detalle: [INTERFAZ.md](INTERFAZ.md).
- **Modo consulta.** En una base sin el módulo de decisiones, la aplicación lo dice una sola vez, no intenta ninguna escritura y deja Pendientes, Cargar CSV y Reportes visibles como «no disponible». Detalle: [CONEXION-ORIGINAL.md](CONEXION-ORIGINAL.md).
- **Analítica.** Pantalla «Analítica» con dos secciones que no se mezclan. Detalle: [ANALITICA.md](ANALITICA.md).
  - *Clusters aprendidos:* k-medias sobre deuda vencida, atraso máximo y cantidad de obligaciones. Lo calcula la aplicación al abrir la pantalla, con la sesión y el municipio de quien consulta; no se guarda. Muestra exclusiones, candidatos de 2 a 6 grupos, separación, estabilidad y el perfil de cada grupo. Dice cuando hay datos insuficientes o cuando no se pudo calcular.
  - *Experimento supervisado:* rotulado «Experimento con datos sintéticos; no predice pagos reales de La Falda». Regresión logística contra dos baselines y dos controles sin señal, sobre 6.300 observaciones generadas.
  - Ninguna de las dos cambia prioridades, grupos, intensidades, aprobaciones ni mensajes.
- **WhatsApp.** Botón «Preparar mensaje» en la ficha: persona y teléfono, texto editable desde las plantillas de las reglas, validaciones explicadas y copia al portapapeles. Estado fijo «Integración de WhatsApp pendiente». No envía, no guarda y no registra decisiones. Qué falta para un proveedor: [WHATSAPP-PROVEEDOR.md](WHATSAPP-PROVEEDOR.md).
- **Carga de CSV.** Sin cambios respecto de la noche 7 y solo en el entorno local autorizado.

## Qué se comprobó y cómo

Sin Computer Use, que no estuvo disponible: navegador Chromium automatizado con Playwright, con capturas revisadas una por una. Solo entornos locales con datos sintéticos.

- **Espejo local en modo consulta** (2.900 casos sintéticos), cuentas sintéticas, 1440 y 390 px: tablero, listado, búsqueda sin resultados, ficha, volver, borrador, analítica, Pendientes, Cargar CSV, Reportes, Casos sin contacto, Grupos y Ayuda. Sin errores de consola. Los contadores de inserciones, actualizaciones y borrados de las tablas de la cartera quedaron iguales antes y después. El clustering calculó sobre 2.040 casos utilizables.
- **Demo local con el módulo** (19 casos sintéticos): repetir la carga del lote vigente («ya estaba cargado», sin cambios en la cartera), borrador con elección de teléfono, validaciones y copia, pestaña Decisión, analítica con datos insuficientes, municipio sin cartera y cuenta sin rol de administración.
- **Controles del repositorio** (pruebas, cobertura, lint, build, duplicación, complejidad, auditoría y gates): se corren sobre el commit publicado; el resultado queda en la ejecución de CI de ese commit.

## Límites conocidos

- El clustering no calcula con más de 10.000 casos ni si tarda más de 1,5 segundos: en esos casos dice «No disponible». No se conoce el tamaño de la cartera real.
- En modo consulta, una tabla que no muestra ninguna fila del municipio se informa como «no se puede saber», no como vacía. Si en la base original alguna tabla está vacía de verdad, los datos que dependen de ella van a figurar como no disponibles.
- Abrir la pantalla de analítica no queda en el registro de accesos, ni siquiera con el módulo instalado. Muestra solo agregados.
- Decisiones, aprobaciones, reportes y carga de CSV no funcionan sobre la base original mientras no tenga el módulo. Instalarlo es un cambio en la base que esta entrega no hizo ni tenía autorizado.

## Qué le queda a quien conecte y compruebe

1. Abrir `/api/build-info` en la URL pública y confirmar el SHA y que la base es `folyslqzqvnpolexcxjo`.
2. Entrar con una cuenta activa. Anotar el nombre del municipio tal como aparece: esta entrega no verificó que la cartera corresponda a La Falda y no renombró nada.
3. Comparar la cantidad de casos y los totales del tablero con una fuente propia.
4. Abrir «Analítica» y anotar el estado del clustering.
5. Si alguna pantalla dice «No disponible» o «no se puede saber», anotar cuál y qué dato.

Reversión: [DESPLIEGUE-Y-REVERSION.md](DESPLIEGUE-Y-REVERSION.md). Referencia estable anterior: `36f35b4`.
