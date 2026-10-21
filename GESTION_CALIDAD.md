# Gestión de casos, defectos y trazabilidad — EQUITAS

La herramienta de seguimiento del TP es **GitHub Issues**, junto con el registro versionado del repositorio. Se eligió en E00 y se aplica en E05. Jira no forma parte de la evidencia presentada. Responsable de continuidad y de los registros actuales: **Axel Azcune (`AxAzc`)**.

## Documentos y fuentes de verdad

- [Casos y técnicas](CASOS_PRUEBA_CALIDAD.md): fichas, entradas, esperado/obtenido, particiones, límites y tablas de decisión.
- [Registro estructurado](calidad/casos-prueba.json): IDs estables, contexto, pasos, variantes, resultados, código y evidencia.
- [Defectos y observaciones](REGISTRO_DEFECTOS_CALIDAD.md): reproducción y tratamiento, conservando DEF-DAT-001, DEF-SUP-001, OBS-COB-001 y OBS-DEP-001.
- [Matriz de trazabilidad](TRAZABILIDAD_CALIDAD.md): requisito → caso → issue → evidencia → defecto → corrección → regresión.
- [Aportes documentados](APORTES_TP_CALIDAD.md): cambios reales del historial, sin atribuir tareas por planificación.
- [Evidencias E05](evidencias/e05/seguimiento-2026-10-21.json): inventario observado, números/URLs y estados comprobados en GitHub.

El resultado técnico proviene del test/reporte y su SHA. El estado de seguimiento proviene del issue y su alcance declarado. El catálogo enlaza ambos. Un ID de caso agrupa variantes parametrizadas; no equivale automáticamente a una sola prueba ni aumenta el total de las suites por documentarlo.

## Crear y ejecutar un caso

1. Usar la [plantilla de caso](.github/ISSUE_TEMPLATE/caso_prueba.md), conservar el ID existente si lo tiene y asignar responsable/requisito.
2. Fijar precondiciones, entrada y esperado antes de ejecutar. Una ampliación posterior se identifica como tal, sin reescribir el criterio que produjo un fallo.
3. Registrar nivel y técnica: unidad, integración aislada, inspección SQL o integración HTTP real; equivalencias, límites, decisión o regresión.
4. Ejecutar el comando/procedimiento y guardar SHA, entorno, fecha, salida y reporte. Registrar todas las variantes contempladas.
5. Marcar aprobado solo si el obtenido satisface el esperado. Un negativo esperado puede aprobar cuando detecta/rechaza el problema; un caso funcional con filas ausentes está fallido.
6. Si hay defecto, abrir o vincular su ID estable. Repetir el mismo caso tras corregirlo y mantenerlo en la regresión automatizada.
7. Actualizar catálogo y matriz con el issue real. No crear un ticket duplicado por cada repetición del mismo defecto o variante.

Los casos aprobados de E03/E04 se formalizan retrospectivamente en Issues el 21/10/2026: sus criterios y ejecuciones conservan las fechas/commits originales. La fecha de alta del ticket no se presenta como la fecha de descubrimiento o aceptación previa.

## Estados de defectos y observaciones

| Estado del registro | Estado GitHub | Condición |
| --- | --- | --- |
| Abierto | Open | Hay un problema/observación identificado y una siguiente acción. |
| Reproducido | Open | Pasos, esperado y obtenido confirmados en el entorno declarado. |
| En corrección | Open | Existe trabajo activo identificado, sin validación concluida. |
| Corregido pendiente de validación | Open | Existe un cambio, pero falta repetir el criterio o conservar evidencia. |
| Cerrado | Closed / completed | Corrección/tratamiento y validación posterior aprobadas, con regresión cuando corresponde. El alcance del cierre debe ser explícito. |
| Reabierto | Open / reopened | Una nueva ejecución vuelve a incumplir el criterio o invalida la evidencia del cierre. |

Una aceptación temporal de riesgo **no cierra** la observación. OBS-DEP-001 conserva su vencimiento y sus cinco avisos, aunque la política de auditoría acepte temporalmente la cadena revisada. La prueba SQL fallida de DEF-SUP-001 tampoco se convierte en integración Auth/HTTP aprobada.

DEF-DAT-001 se cierra por la corrección de **ambas rutas y relaciones con regresión automatizada aislada** ya validada en E03. Ese cierre no declara comprobados datos/importes de una sesión real o un despliegue. La campaña de integración E06 sigue abierta. OBS-COB-001 se cierra por superar el mínimo dentro del mismo alcance y aplicar los gates comprobados en E04.

## Severidad, prioridad y pendientes

La severidad describe impacto; la prioridad ordena el trabajo. Los registros conservan la clasificación **alta** de los dos defectos y las observaciones ya documentadas, con justificación. DEF-SUP-001 tiene prioridad P1 para E06 por autorización; OBS-DEP-001, P1 antes del vencimiento 26/10/2026. Los cerrados conservan su prioridad histórica y no se borran.

Esto no cambia la matriz de riesgos P × I del plan ni convierte automáticamente cada regla Ruff o vulnerabilidad en bug funcional crítico. Las reglas críticas del gate tienen su propia política versionada. Los ensayos controlados de E02/E04 se distinguen del defecto real rojo/verde de E03.

## Mantener el seguimiento

- Antes de crear un issue, buscar el ID en abiertos y cerrados. Actualizar el existente si ya representa ese problema.
- Conservar requisito, caso, pasos, esperado/obtenido, impacto, versión, responsable y evidencia en el cuerpo; usar la [plantilla de defecto](.github/ISSUE_TEMPLATE/defecto_calidad.md).
- Actualizar cuerpo/estado y sus vínculos al avanzar. No hace falta un mensaje a terceros para mantener el registro.
- Para cerrar, comprobar corrección y regresión; para reabrir, guardar el nuevo caso fallido y su SHA. No reemplazar evidencias anteriores.
- Al cambiar un caso o estado, actualizar también el registro estructurado, la matriz y la ficha de etapa. Los snapshots históricos conservan su fecha; crear nuevos cortes.
- Usar enlaces permanentes al commit y al run. Descargar artefactos antes del vencimiento; los manifiestos y resultados esenciales permanecen en Git.
- Mantener credenciales y datos personales fuera de tickets/reportes. Los casos aislados usan datos sintéticos; la investigación SQL conserva solo resultados agregados.
