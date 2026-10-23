# Registro de ejecución — E09

**Etapa:** herramienta, métricas y documentación transversal. **Fecha:** 23/10/2026. **Responsable:** Axel Azcune (`AxAzc`). **Estado:** completada, 31/31 controles del roadmap, con metas parciales y riesgos pendientes explícitos. Nivel declarado: 2, prototipo parcial.

## Entrada y alcance

E08 ya estaba cerrada: política previa, PoC k6 y dos cargas nuevas en pipeline, 24/24 controles; última publicación de evidencias `2f9e48fe11bf246d6fc73bc0308bda4692d0d866`. E09 consolida R02–R06, R11–R13, R15 y R22. No agrega funcionalidades ni pruebas, no cambia workflows/dependencias y no modifica entornos remotos.

Se consultó el [CI main 39964341314](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39964341314), SHA `2f9e48f…`, cuatro jobs aprobados. Los cuatro ZIP se descargaron y verificaron con su digest SHA-256. Se preservan [metadatos/digests](evidencias/e09/artefactos-ci.json), [hashes de archivos extraídos](evidencias/e09/archivos-ci.json), [resumen](evidencias/e09/ci-summary.json), [gate](evidencias/e09/ci-gate.json), [HTTP real](evidencias/e09/supabase.json), JSON/JUnit y [datos de ejecución](evidencias/e09/ejecucion-ci.json). Los enlaces temporales de descarga y credenciales quedan fuera del repositorio.

## Entregables y decisiones

| Entregable | Qué resuelve / criterio verificado |
| --- | --- |
| [Métricas](METRICAS_CALIDAD.md) y [JSON de cálculo](evidencias/e09/metricas.json) | Producto/proceso/proyecto separados, fórmulas, alcance, fecha/SHA, sentencias/funciones/ramas, combinada backend, duplicación por líneas/tokens, ejecución/omisión y tamaño. |
| [Matriz ISO](MATRIZ_ISO25010_CALIDAD.md) | Ocho características de la edición 2011 correspondiente a la consigna, cada una con objetivo/métrica/aceptación/evidencia/estado. Top 3: adecuación funcional, seguridad y fiabilidad. Parciales no convertidos en aprobaciones globales. |
| [Plan 2.0](PLAN_PRUEBAS_CALIDAD.md) | Consolida estado actual en lugar de conservar instrucciones futuras ya completadas. Metas por interesado, entornos, criterios, automatización real, riesgos iniciales/residuales y contingencia detallada. Historial conservado en Git y fichas. |
| [Proceso y técnicas](PROCESO_Y_TECNICAS_CALIDAD.md) | QA/QC con ejemplos propios, mapa disjunto que suma 183, 66 controles separados, AAA real, particiones/límites y tabla REC-01 ejecutada, siete principios con evidencia y mapa de herramientas. |
| [Herramienta incorporada](HERRAMIENTA_INCORPORADA_CALIDAD.md) | Cinco pasos ya comprobados en E08: requisitos/alternativas/PoC/matriz/adopción. Pesos previos 20/20/20/20/10/10, k6 4,70 frente a 4,30/3,70 de evaluación documental; no se inventa PoC de otras herramientas. |
| [Seguimiento](evidencias/e09/seguimiento.json) | Consulta actual de 12 tickets: 10 cerrados, dos abiertos, responsables y enlaces. No se crearon tickets/tests ficticios para una consolidación documental. |

El antecedente recibido **12,03→60,43 % frontend y 26,83→85,26 % backend** se conserva con su procedencia. El extremo final fue corroborado en el diagnóstico inicial; el inicial no se reejecutó sobre una versión antigua. E01 cambió instrumentación frontend, con mismos archivos: 60,43→45,96 % no prueba un empeoramiento funcional. E03→E04 conserva método/denominador y añade 49/1.280 sentencias cubiertas, +3,8281 puntos porcentuales.

La mejora funcional comparable usa las mismas 3.507 filas: antes 1.000/3.507=28,5144 % o 3.000/3.507=85,5432 % según máximo de respuesta, después 100 % en ambas rutas, sin ausencias/duplicados. Conserva rojo/verde real y aserciones iniciales. En Ruff se distinguen **16 correcciones y tres excepciones** del total inicial de 19; no se declara que las tres últimas se corrigieron ni que el audit completo da cero.

## Cifras verificadas

| Indicador | Corte actual / interpretación |
| --- | --- |
| Producto del CI consultado | **168 aisladas + 12 HTTP reales = 180/180**, cero fallidas/omitidas. `summary.tests` solo suma aisladas; la externa se lee en su propio campo/job. |
| Corte acumulado | **183** = 180 anteriores + un smoke E07 + dos cargas E08. No se atribuye a un solo workflow/SHA. |
| Infraestructura | **66/66**, aparte del producto; log del mismo CI. |
| Frontend | 794/1.283 sentencias=61,8862 %; herramienta 61,88 %. Funciones 200/326; ramas 566/1.068. |
| Backend | 1.254/1.471 sentencias=85,2481 %; ramas 339/498=68,0723 %; combinada 1.593/1.969=80,9040 %. Funciones no medidas. |
| Nuevo código | Front 36/36=100 %; back 15/17=88,2353 %, base fija 531996f… sin mover. |
| Duplicación/tamaño | 427/11.159 líneas=3,8265 %; 2.533/53.287 tokens=4,7535 %. 64 archivos/11.159 líneas de alcance productivo. |
| Proceso histórico | 94/94 aprobadas/ejecutadas=100 %, una omitida; ejecución 94/95=98,95 %, no 95 aprobadas. |
| Tickets | 12 registrados, diez cerrados y dos abiertos; no es una tasa de cierre de defectos porque mezcla tipos de ticket. |

## Riesgos y límites conservados

DEF-SUP-001 sigue abierto en el **original**, aunque testing aprobó aislamiento. El plan eleva su prioridad residual original a **4×5=20 crítica** y separa el alcance testing; las puntuaciones son estimaciones, no frecuencias medidas. OBS-DEP-001 conserva cinco altas dev y vencimiento **26/10/2026**, sin extenderlo. No se modificaron políticas originales ni se declararon aprobadas usabilidad municipal, accesibilidad completa o seguridad total.

La contingencia incluye detección, contención, comunicación, recuperación y verificación con responsables/registros/criterios. Distingue errores/reintentos simulados y limpieza/recreación real de fixtures seguida de 12 HTTP aprobadas de la **caída cloud/backup restore no ensayados**. No inventa RTO/RPO. Las cargas E08 siguen midiendo el componente con fuente sintética local, sin capacidad cloud/web ni prueba de ausencia de fugas.

## Revisión y salida

La [validación E09](evidencias/e09/validacion-registros.json) documenta el recálculo de cocientes y sumas, igualdad con artefactos, integridad SHA-256, grupos disjuntos del inventario, estados de tickets, 31 controles, enlaces/anchors, UTF-8 y revisión de material sensible. No se alteran snapshots E00–E08 ni se cuentan documentos como pruebas nuevas. Las fuentes teóricas son las fichas oficiales de ISO y el syllabus oficial de ISTQB, citadas en los entregables.

No se repiten diez minutos de carga ni se produce un nuevo smoke por una edición documental. La publicación dispara el CI normal de la rama; la integración en main debe conservar los cuatro jobs en verde, incluida la externa obligatoria. El run de publicación se identifica por su commit en GitHub Actions y se informa al cerrar la etapa, separado del snapshot de análisis aquí preservado.

**E09 completa su documentación transversal. Próxima etapa E10:** integrar el informe académico recibido, completar metas/análisis crítico/conclusiones, incorporar evidencia visual y producir fuente editable/PDF revisado. **E11:** nueva demostración alineada con versión final y revisión de entrega. El PDF todavía no está producido por esta etapa y el TP integral no se declara terminado.
