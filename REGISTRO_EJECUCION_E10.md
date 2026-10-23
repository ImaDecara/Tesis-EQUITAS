# Registro de ejecución — E10

**Etapa:** informe académico completo y PDF revisado. **Fecha:** 23/10/2026. **Responsable:** Axel Azcune (`AxAzc`). **Estado:** completada, 29/29 controles del roadmap. Nivel declarado: 2, prototipo parcial. La demostración integral continúa en E11.

## Entregables

| Archivo | Función y resultado |
| --- | --- |
| [Informe PDF](entrega/INFORME_ACADEMICO_CALIDAD.pdf) | **27 páginas**, sin índice, con carátula, 18 secciones y dos anexos; todas renderizadas e inspeccionadas visualmente. |
| [Fuente académica editable](entrega/INFORME_ACADEMICO_CALIDAD.md) | Conserva universidad/carrera, logo, tres integrantes e introducción aprovechable del avance recibido. Actualiza contenido y agrega pruebas, automatización, integración, cargas, herramienta, metas, análisis crítico y conclusiones. |
| [Generador](entrega/generar_informe.py) y [dependencias](entrega/requirements-informe.txt) | Python 3.12.14, ReportLab 4.4.9, Pillow 12.3.0 y pypdf 6.10.0; PDF y tres gráficos vectoriales desde datos versionados. |
| [Instrucciones](entrega/README.md) | Edición, instalación separada, regeneración, fuentes tipográficas y revisión con Poppler. |
| [Manifiesto de generación](evidencias/e10/generacion.json) | Hash del PDF/fuente, fuentes de gráficos, versiones y rectángulo mostrado de la captura. |
| [Validación](evidencias/e10/validacion-registros.json) y [revisión visual](evidencias/e10/revision-visual.json) | Consistencia documental/métrica, enlaces, integridad de artefactos, privacidad, regeneración y revisión de las 27 páginas. |

El informe académico de entrega es el de `entrega/`. `tp-Calidad.md` permanece sin modificar como fuente recibida; el informe técnico de raíz conserva el desarrollo histórico con un enlace destacado al entregable consolidado. No se inventaron docente, comisión o legajos: la carátula usa los datos académicos disponibles, incluidos los tres nombres completos.

## Corte de evidencia

El corte técnico es **1472eea8bbd87857a38a6fd0b05283ff9287eb44**, [CI main 39968499139](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39968499139), cuatro jobs aprobados. Se descargaron sus cuatro artefactos y se verificó cada ZIP contra el digest SHA-256 de GitHub: [manifiesto](evidencias/e10/artefactos-ci.json), [resumen](evidencias/e10/ci-summary.json), [gate](evidencias/e10/ci-gate.json), [Supabase real](evidencias/e10/supabase.json) y [66 controles de infraestructura](evidencias/e10/infrastructure-tests.log).

Las coberturas coinciden exactamente con el corte anterior: frontend 794/1.283 sentencias, 200/326 funciones y 566/1.068 ramas; backend 1.254/1.471 sentencias y 339/498 ramas. Se distingue la combinada backend 1.593/1.969=80,9040 %. Nuevo front 36/36, back 15/17; duplicación 427/11.159=3,8265 %. El CI tiene **168 aisladas + 12 HTTP reales = 180 de producto** y **66 de infraestructura aparte**. El acumulado **183** conserva el smoke E07 y las dos cargas E08 en sus propios SHA/fechas; E10 no los reejecuta ni suma documentos a las pruebas.

El informe mantiene el antecedente de cobertura recibido y sus límites de reproducción, el cambio de método V8 de E01 y las mejoras comparables DAT-06/Ruff. Sustituye los CP ilustrativos por casos reales AAA/DAT/AUTH/REC/GATE y vincula rojo/verde, corrección y regresión. El modelo ISO de ocho características corresponde a la edición 2011 solicitada y no se presenta como certificación vigente.

## Figuras y revisión visual

El logo se extrajo sin modificación de `tp-Calidad.md`. Los tres gráficos usan numeradores/denominadores de cobertura, la comparación DAT-06 y las fases reales de estrés. Incluyen unidad, fecha, alcance y fuente. La captura de Personas pertenece al smoke aceptado E07, a6497a7, 23/10; muestra solo datos sintéticos. El PDF exhibe el listado operativo mediante recorte de visualización, sin modificar el PNG original. No se fabricaron imágenes de terminal o de pipeline.

Se generaron versiones de revisión y se corrigieron el ancho de columnas, encabezados, saltos de tablas, espacio entre bloques y representación exacta de reglas, versiones y commits. La versión final se renderizó completa con Poppler a 110 dpi; se abrieron **las 27 páginas a resolución original**, sin limitar la revisión a un mosaico. Se verificaron carátula, tablas completas con encabezados repetidos, caracteres, paginación/pies, gráficos y sus leyendas, captura y legibilidad, conclusiones, comandos y referencias. Los PNG de revisión son auxiliares ignorados; el registro conserva sus hashes y el SHA del PDF efectivamente revisado.

Se generó una segunda copia desde la misma fuente/datos y se obtuvo el **mismo SHA-256 del PDF y de los tres SVG**. La reproducibilidad binaria verificada corresponde a ese runtime, paquetes y fuentes tipográficas; otra fuente o versión puede cambiar maquetación/hash y requiere nueva revisión. El análisis de errores Python del generador aprobó. No se cambió código de producto, suites, dependencias de aplicación ni workflows.

La revisión documental aprobó **33 comprobaciones**, **333 enlaces locales** y **115 enlaces HTTPS del PDF**, con los 29 controles de E10 completos. Las cifras, versiones, reglas y commits se contrastaron con las fuentes; los dos tickets abiertos mantienen su estado real y la fecha de vencimiento de la excepción.

## Metas y pendientes conservados

La tabla R01–R25 del informe diferencia cumplido, parcial y pendiente. E10 cumple la documentación/PDF, pero **no cierra E11**. El original Supabase conserva DEF-SUP-001; OBS-DEP-001 conserva cinco altos dev y vence el 26/10/2026. No se extiende la excepción ni se presenta audit completo como cero. Permanecen explícitas la usabilidad municipal/accesibilidad completa no verificadas, la recuperación cloud/backup restore no ensayada y la capacidad web/cloud no medida por estas cargas.

La arquitectura representa web→Supabase y API independiente; el PDF no atribuye una integración web→FastAPI inexistente. No se declara ausencia total de defectos o preparación productiva completa. La conservación de esos límites permite completar el informe sin convertir tareas futuras en ensayos aprobados.

## Publicación y siguiente etapa

E10 se publica con fuente, generador, PDF, figuras, instrucciones y evidencia versionada. Su commit permite identificar los runs de CI de publicación; la integración a main debe conservar los cuatro jobs obligatorios en verde. Esa verificación se distingue del CI de análisis 1472eea y no obliga a atribuir un nuevo smoke/carga a una edición documental.

**Siguiente E11:** alinear versión de demostración, ejecutar el despliegue nuevo con smoke y la validación integral exigida, revisar pendientes antes del vencimiento, preparar guion/aportes y comprobar coherencia final entre ejecución, repositorio e informe.
