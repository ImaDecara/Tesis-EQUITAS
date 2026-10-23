# Plan de pruebas y criterios de cierre — EQUITAS

**Versión 2.0 — E09, 23/10/2026. Responsable: Axel Azcune.** E00–E09 completadas en sus alcances; siguen informe/PDF E10 y demostración E11. Nivel declarado: **2, prototipo parcial**. Presentación: **26/10/2026**. [Consigna](consigna_pdf.md) y [roadmap](ROADMAP_TP_CALIDAD_SOFTWARE.md).

Esta versión consolida el plan vigente y reemplaza las notas de actividades futuras ya ejecutadas. Las versiones anteriores siguen en Git y en las fichas [E00](REGISTRO_EJECUCION_E00.md), [E01](REGISTRO_EJECUCION_E01.md), [E02](REGISTRO_EJECUCION_E02.md), [E03](REGISTRO_EJECUCION_E03.md), [E04](REGISTRO_EJECUCION_E04.md), [E05](REGISTRO_EJECUCION_E05.md), [E06](REGISTRO_EJECUCION_E06.md), [E07](REGISTRO_EJECUCION_E07.md), [E08](REGISTRO_EJECUCION_E08.md) y [E09](REGISTRO_EJECUCION_E09.md). No se sobrescriben sus resultados históricos.

## 1. Versiones y alcance

| Referencia | Versión / evidencia | Uso |
| --- | --- | --- |
| Base fija de cobertura nueva | `531996f51243dc3d4c5a607338e2f35e32313f6b` | No se mueve al último commit para facilitar el gate. |
| Corte actual de análisis | `2f9e48fe11bf246d6fc73bc0308bda4692d0d866`, [CI main 39964341314](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39964341314) | 168 aisladas + 12 HTTP reales = 180 de producto; 66 controles de infraestructura aparte. |
| Despliegue/smoke aceptado | `a6497a73b226f9d27abb4e9080d5540503d95539`, [smoke 39955572523](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39955572523) | Un recorrido de navegador con cinco comprobaciones en Preview de testing. |
| Cargas aceptadas | `f6f83f9a3172fc2e42912305a181057130d9577b`, [pipeline 39960952025](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39960952025) | Estrés y sostenido, datos nuevos de CI contra política previa. |

El producto no cambió entre el cierre E07 y el corte E09; E08 incorporó infraestructura de carga. Corte acumulado: **183 pruebas/campañas aprobadas**, cero fallidas/omitidas, y **66 controles separados**. No es una ejecución única del último SHA. [Métricas](METRICAS_CALIDAD.md), [mapa nominal y niveles](PROCESO_Y_TECNICAS_CALIDAD.md#2-mapa-actual-de-niveles-sin-doble-conteo), [manifiestos](evidencias/e09/artefactos-ci.json).

Incluido: parsers/mappers/paginación/riesgo/recomendaciones; presentación aislada; contexto Auth→usuario→tenant; lectura completa y relaciones; ETL sintético/reintentos; API FastAPI/scoring; integración real Supabase testing; smoke desplegado; cargas del componente; análisis/gates y evidencias.

Cobertura: `front/app`, `front/components`, `front/lib`, `back/ETL`, `back/api`, `back/services`. Por ejemplo, `front/proxy.ts` queda fuera de la base medida. La web consulta Supabase; no consume FastAPI. Las pruebas de scoring/cargas de FastAPI no validan el dashboard completo.

Límites: sin UAT municipal, pentest integral, revisión completa de accesibilidad, restauración de backup, failover ni disponibilidad anual medidos. Los datos sintéticos no acreditan toda la cartera real. El Supabase original conserva DEF-SUP-001 abierto; la corrección de testing no se declara aplicada al original.

## 2. Responsabilidades y gestión

| Actividad | Responsable y soporte |
| --- | --- |
| Ejecución técnica, criterios, métricas, evidencias y continuidad de defectos | Axel Azcune, cuenta `AxAzc`. |
| Revisión académica final y defensa | Equipo: Ignacio Magoia, Axel Azcune e Imanol Decara. Registrar intervenciones cuando ocurran. |
| Configuración administrativa de hosting | Cuenta administradora de Imanol Decara; configuración de testing E07 ya verificada. Recuperaciones futuras se coordinan con el administrador. |
| Seguimiento | [GitHub Issues](https://github.com/ImaDecara/Tesis-EQUITAS/issues), [registro](REGISTRO_DEFECTOS_CALIDAD.md), [plantillas y flujo](GESTION_CALIDAD.md). Jira no se utilizó. |

Son 12 tickets, 10 cerrados en su alcance y **2 abiertos**: [DEF-SUP-001 #1](https://github.com/ImaDecara/Tesis-EQUITAS/issues/1), original; [OBS-DEP-001 #3](https://github.com/ImaDecara/Tesis-EQUITAS/issues/3), cinco avisos altos dev con excepción hasta **26/10/2026**. [Snapshot E09](evidencias/e09/seguimiento.json). Cerrar una campaña no resuelve todos los riesgos asociados.

## 3. Metas medibles y evaluación actual

Las metas se originan en E00 y se concretan en E03/E04/E06/E07/E08. Esta tabla agrega estado/evidencia al 23/10; no reconstruye acuerdos municipales ni umbrales previos inexistentes.

| ID / interesado | Objetivo y aceptación | Observado / estado | Evidencia |
| --- | --- | --- | --- |
| M-U1, usuario | Lectura completa: 100 % de IDs esperados, sin ausentes/duplicados, >3.000 filas y agregados/relaciones. | **Cumple en dataset aislado**: 3.507/3.507 por ruta/variante; complemento real pequeño E06. | [Antes/después](evidencias/e03/comparacion-dat-06.json), DAT-01–14. |
| M-U2, usuario | Cero filas ajenas para A/B y cero negocio sin pertenencia; acceso positivo intacto. | **Cumple en testing; incumplido en original** por RLS permisiva. | [12 HTTP reales](evidencias/e09/supabase.json), defecto #1. |
| M-U3, usuario | Tras desplegar testing: disponibilidad, login, datos conocidos, navegación/filtro y logout con SHA correcto. | **Cumple en Preview E07**, 5/5 comprobaciones de una campaña. Usabilidad municipal no medida. | [Smoke](evidencias/e07/smoke.json), [filtro rojo/verde](evidencias/e07/filtro-rojo-verde.json). |
| M-E1, equipo | Cero fallos/omisiones en controles obligatorios y regresión por defecto declarado corregido. | **Cumple en alcance**: CI 180/180, DAT, RLS testing y filtro; 66/66 de infraestructura aparte. | [CI](evidencias/e09/ci-summary.json), [trazabilidad](TRAZABILIDAD_CALIDAD.md). |
| M-E2, equipo | Sentencias≥60 % por módulo; líneas nuevas≥80 % contra base fija; duplicación por líneas≤5 %. | **Cumple**: 61,8862/85,2481 %, nuevo 36/36 y 15/17, duplicación 3,8265 %. | [Gate](evidencias/e09/ci-gate.json). |
| M-E3, equipo | Cero críticos clasificados por política de gate y cero estáticos no aceptados; audit productivo sin avisos. | **Cumple política con excepción vigente**. No es cero defectos de negocio ni cero avisos dev; OBS-DEP-001 abierto. | [Política/gate](evidencias/e09/ci-gate.json), [audit](evidencias/e09/audit-decision.json). |
| M-E4, equipo | Rendimiento E08 previo: p95≤2 s, error≤1 % hasta 10 usuarios, cero contenido incorrecto, sostenido 600 s. | **Cumple** en fuente sintética local de CI; no es SLA municipal/cloud. | [Cargas](evidencias/e08/resultados.json), [plan previo](PLAN_RENDIMIENTO_E08.md). |
| M-O1, organización | Sin duplicados/huérfanos en controles elegidos y repetición de carga sin duplicación según contrato. | **Parcial**: SQL seleccionado y ETL simulado aprobados; no recarga ETL completa de cartera real. | [Inspección inicial](evidencias/supabase-2026-10-21.json), 8 integraciones ETL simuladas. |
| M-O2, organización | Recuperación controlada: error identificable, reintentos acotados, parada, revisión de lote y verificación. | **Parcial**: negativos/reintentos simulados y recreación de fixtures testing verificados. Protocolo documentado; caída cloud/backup restore no ensayados. | Sección 9; [ciclo de fixtures](evidencias/e06/fixtures-lifecycle.json). |
| M-O3, organización | Comandos/versiones/reportes disponibles; PDF coherente y demostración final. | **Parcial**: repositorio y reportes disponibles; E10/PDF y E11/demo pendientes. | [Reproducción](REPRODUCIBILIDAD_CALIDAD.md), roadmap E10/E11. |

La [matriz ISO](MATRIZ_ISO25010_CALIDAD.md) evalúa las ocho características y conserva el top 3 explícito: **1 adecuación funcional, 2 seguridad, 3 fiabilidad**. Cada fila tiene objetivo, métrica/aceptación, evidencia, estado y límite. Una meta parcial no se aprueba por cerrar E09.

## 4. Entornos y datos permitidos

| Entorno | Uso y estado verificado | Restricción |
| --- | --- | --- |
| Local Windows | E01: instalación nueva Node 22.23.2/npm 11.21.1/Python 3.12.14; PoC k6 E08. | Fixtures/temporales y versiones fijadas; el corte actual íntegro se verifica en Linux CI. |
| Actions Ubuntu 24.04 | Suites/build/análisis/gates, integración main/testing y cargas específicas. | Reportes nuevos por SHA; artefactos 30 días más resúmenes portables versionados. |
| Supabase original `folyslqzqvnpolexcxjo` | Inspección de lectura registrada 21/10. | Sin escrituras/cargas del TP; no recibió corrección RLS. |
| Supabase testing `iylwghgvtydpmwidojdo` | Auth/Data API reales, fixtures e06-v1, A/B/none/inactive y dos tenants. | Solo datos sintéticos reservados; cliente normal en pruebas, secretos fuera de reportes. [Preparación](SUPABASE_TESTING_CALIDAD.md). |
| Vercel Preview `quality/tp-testing` | SHA a6497a7… y Supabase testing comprobados E07. | Variables limitadas a Preview/rama; protección conservada y secreto de automatización en GitHub. [Configuración](CONFIGURACION_VERCEL_E07.md). |
| Rendimiento dentro de runner | FastAPI real/fuente sintética; 3.600 perfiles/objetos y 72.000 deudas representadas por agregados. | No web/cloud; un worker, hardware por campaña, stop y presupuesto E08. [Alcance](RENDIMIENTO_CALIDAD.md). |

## 5. Niveles, técnicas y trazabilidad

[Mapa completo](PROCESO_Y_TECNICAS_CALIDAD.md#2-mapa-actual-de-niveles-sin-doble-conteo): **114 unidad/componentes + 11 presentación aislada + 43 integración simulada/API + 12 HTTP reales + 1 smoke + 2 cargas = 183**. Infraestructura: 66 aparte. Las 94 aprobadas y una omitida son la base histórica, no el contador actual.

El [catálogo](CASOS_PRUEBA_CALIDAD.md) contiene 56 IDs/familias seleccionados; cada ficha combina contexto y campos propios. [Proceso/técnicas](PROCESO_Y_TECNICAS_CALIDAD.md) muestra AAA real ejecutado, particiones/límites, siete reglas REC-01 y siete principios con evidencia. Sentencias/ramas no equivalen a MC/DC ni exhaustividad.

Cadenas conservadas: R-DAT-01→DAT-06→[caso #5](https://github.com/ImaDecara/Tesis-EQUITAS/issues/5)→[defecto #2](https://github.com/ImaDecara/Tesis-EQUITAS/issues/2)→corrección `3bfe156…`→rojo/verde E03→regresión CI. R-SEG-01→SUP-RLS-02→[caso #9](https://github.com/ImaDecara/Tesis-EQUITAS/issues/9)→[defecto #1](https://github.com/ImaDecara/Tesis-EQUITAS/issues/1)→rojo/verde HTTP E06 solo testing; original pendiente. DEF-UI-001→smoke→`a6497a7…`→mismo control del filtro en verde. [Matriz completa](TRAZABILIDAD_CALIDAD.md).

## 6. Automatización y gates

[quality-ci.yml](.github/workflows/quality-ci.yml): push, PR a main y dispatch; instala dependencias fijadas, prueba/build/analiza y genera JSON/JUnit/HTML. Supabase obligatorio en push/dispatch de **main y quality/tp-testing**, sin secretos en cualquier PR/rama. El resumen exige presencia/éxito donde corresponde. Un verde de otra rama no acredita integración real.

Gate E04: sentencias≥60 % por módulo, nuevas líneas ejecutables≥80 % por módulo contra base fija, duplicación por líneas≤5 % sin redondeo, cero críticos según clasificador de reglas y cero estáticos no aceptados. Base/reportes ausentes o procedencia incorrecta bloquean. Audit: cero críticas/productivas y solo excepción exacta de cinco altos dev hasta 26/10. [Criterios actuales](evidencias/e09/ci-gate.json). `release_approved=false` no pasa a aprobación productiva por gate verde.

[preview-smoke.yml](.github/workflows/preview-smoke.yml): tras CI de **quality/tp-testing**, espera deployment de ese SHA y verifica build-info/URL/proyecto antes de navegar. Ese es el alcance automático de despliegue del TP; no se configura para todos los previews ni producción. E11 debe usar esa rama y conservar un nuevo recorrido.

[load-tests.yml](.github/workflows/load-tests.yml): manual o cambios del harness en rama E08; exige CI del mismo SHA y ejecuta estrés/sostenido en runners separados. No corre cargas largas en cada PR/push. El rojo funcional real es E03, separado de la inyección sintética E04 y del fallo de imports E08. Se conservan artefactos también al fallar.

## 7. Entrada y salida

Entrada: SHA/configuración conocidos; dependencias preparadas; caso/esperado/datos/entorno identificados; externos solo en testing con cuentas configuradas; cargas con política/duración/usuarios/stop anteriores al ensayo. Salida de etapa: criterio satisfecho o incumplimiento explícito, métricas/casos/tickets coherentes, reportes propios y límites registrados. Una omisión no es aprobación.

Salida integral: R01–R25 respaldados; controles/build/gates obligatorios aprobados; rojo real y verde posterior; integración real, nuevo despliegue con smoke y dos cargas; registro/herramienta completos; **PDF y demostración final**, aún pendientes en E10/E11. Riesgos del original/excepción dev se informan como metas pendientes; no presentar el MVP como listo para producción.

## 8. Riesgos priorizados

P e I: estimaciones de planificación 1–5; P×I: **15–25 crítica, 10–14 alta, 5–9 media, 1–4 baja**. No son frecuencias observadas ni severidades de Ruff/npm. La reevaluación residual 23/10 es juicio operativo al consolidar E09, no reducción de probabilidad demostrada estadísticamente. Responsable de seguimiento: Axel Azcune.

| ID / riesgo | Inicial E00 P×I | Residual E09 P×I | Tratamiento, evidencia y pendiente |
| --- | --- | --- | --- |
| R-01 Indisponibilidad Supabase |3×5=15 crítica | **3×5=15 crítica** | Negativos/reintentos y sección 9; sin serie de disponibilidad/failover. Contener lote incierto y verificar servicio antes de reanudar. |
| R-02 Contexto Auth/tenant incorrecto |3×5=15 crítica | **1×5=5 media, testing** | AUTH aisladas y 12 HTTP A/B/none/inactive; denegar sin contexto. Cambio de esquema/claims exige repetir suite real; no extrapolar al original. |
| R-03 Inconsistencia/duplicación ETL |3×5=15 crítica | **2×5=10 alta** | Ocho integraciones simuladas y SQL seleccionado reducen incertidumbre, sin probar recarga real completa. Parar lote, conciliar claves/importes y reanudar solo lo verificado. |
| R-04 Lectura sin pertenencia/RLS |2×5=10 alta | **4×5=20 crítica, original; 1×5=5 media, testing** | Exposición original observada eleva prioridad. [#1 abierto](https://github.com/ImaDecara/Tesis-EQUITAS/issues/1). Testing corrigió/regresó; original requiere cambio validado por su responsable. E09 no lo modificó. |
| R-05 Truncamiento de cartera |4×4=16 crítica | **2×4=8 media** | Cursor y DAT-06 rojo/verde, regresión mantenida. Gran volumen ensayado con doble; si difieren totales, advertir incompletitud y evitar decisiones con agregados no conciliados. |
| R-06 Despliegue/variables erróneas |2×4=8 media | **1×4=4 baja, Preview verificado** | E07 verifica SHA/URL/Supabase y smoke; no califica producción. Retirar de demo el deployment fallido, elegir versión estable de testing y repetir CI/smoke; rollback operativo no ensayado. |
| R-07 Regresión módulos/dependencias |3×4=12 alta | **2×4=8 media** | Suites/gates/base fija/regresiones DAT/RLS-testing/UI; persisten ramas sin cubrir. Conservar caso, corregir/revertir cambio y repetir niveles afectados. |
| R-08 Dependencias vulnerables dev | Seguimiento desde E01, sin puntuación previa | **3×3=9 media** | Cinco altas dev, cero críticas/productivas. [#3 abierto](https://github.com/ImaDecara/Tesis-EQUITAS/issues/3), excepción vence **26/10/2026**. Revisar actualización y validar suite/build antes de vencer; no extender automáticamente. |
| R-09 Pérdida/caducidad de evidencia | Formalizado E09, sin puntuación previa | **1×3=3 baja** | Artefactos30 días; manifiestos SHA y snapshots/series/muestras portables en Git. Algunos logs crudos completos siguen sujetos a expiración; conservar referencias para PDF. |

R-04 original permanece crítico aunque E09 esté documentada; CI verde no lo reduce por sí solo. R-08 debe revisarse antes de la entrega. Se conserva el historial de puntuaciones; los residuales no reemplazan retroactivamente los originales.

## 9. Contingencia ante fallo de Supabase

Procedimiento operativo del TP. **No se ensayó caída completa del proveedor ni restauración de backup**. Coordina Axel; equipo/administrador intervienen según acceso. La comunicación describe una acción futura, no mensajes ya enviados ni una guardia contratada.

| Fase | Acción concreta y criterio para avanzar | Registro mínimo |
| --- | --- | --- |
| Detección | Ante error Auth/Data API, timeout, lectura parcial o fallo del job real, identificar entorno/operación. Distinguir indisponibilidad, permiso, credencial, esquema o datos; consultar estado del proveedor/logs permitidos. | Hora UTC/local, SHA/URL, ref de proyecto, código HTTP/error y caso/lote; sin JWT/contraseña/datos personales. |
| Contención | No presentar lectura parcial como éxito. Detener ETL si no se sabe qué se confirmó; usar solo reintentos acotados del código, sin repetir escrituras a ciegas. No cambiar testing por original para sostener la demo. | Último paso confirmado, claves del lote sintético, errores/advertencias, operaciones detenidas. |
| Comunicación | Informar equipo/administrador: alcance, posible desactualización, operaciones detenidas y próximo punto de revisión. En demo señalar indisponibilidad y fecha de evidencia histórica. No dar por resuelto sin comprobar. | Destinatarios/medio/fecha, responsable, resumen sin secretos y próxima revisión acordada; sin SLA/intervalo inventado. |
| Recuperación | Verificar proyecto/configuración/Auth. Conciliar claves/conteos/duplicados/huérfanos/importes de escrituras inciertas antes de reanudar. En testing recrear solo fixtures reservadas según E06. Pérdida real: escalar al responsable y estrategia de backups, sin restore improvisado. | Servicio accesible, conciliación por lote, cambios realizados y decisión operativa de reanudación. |
| Verificación y cierre | Repetir suite real **12/12 sin omisiones**, A/B y denegaciones/filas/montos conocidos. Si afectó web/configuración, repetir CI/smoke del deployment correcto; si afectó ETL, casos/conciliación del lote. Mantener incidente abierto si hay diferencias. | Nuevo reporte SHA/fecha/entorno, esperado/obtenido, ticket con causa/acciones y comunicación de cierre. |

**Ensayado:** errores/reintentos ETL con dobles, datos fallidos sin éxito parcial y limpieza/recreación de fixtures E06: cero usuarios/tenants/objetos/personas/currency después de limpiar; luego cuatro cuentas/fixtures recreadas y [12 HTTP aprobadas](evidencias/e06/recreated-green.json). [Ciclo real de fixtures](evidencias/e06/fixtures-lifecycle.json). Recupera el conjunto sintético; no es backup/restore de toda la base ni recuperación del proveedor.

**No medido:** RTO, RPO, caída real, recuperación de cartera municipal, failover, backup/restore o claves perdidas. No se prometen valores. Se cumple el protocolo como planificación, con controles ensayados identificados por separado.

## 10. QA/QC, herramienta y repetición

QA: criterios previos, riesgo, aislamiento, dependencias reproducibles, fichas/trazabilidad. QC: pruebas, análisis, cobertura, mediciones, gates y rojo/verde. [Ejemplos, principios, AAA, técnicas y herramientas](PROCESO_Y_TECNICAS_CALIDAD.md). [k6 con cinco pasos](HERRAMIENTA_INCORPORADA_CALIDAD.md): PoC real, pesos previos, comparación documental justificada y adopción CI.

Con entorno preparado según [reproducibilidad](REPRODUCIBILIDAD_CALIDAD.md), ejecutar el comando del alcance requerido. No se incluyen secretos:

| Ejecución | Comando / ubicación | Alcance |
| --- | --- | --- |
| Frontend aislado/cobertura | Raíz: `npm --prefix front run test:coverage` | Vitest/V8; no campaña externa ni navegador. |
| Backend/cobertura | Desde back: `.venv/Scripts/python.exe -m pytest --cov=ETL --cov=api --cov=services --cov-branch --cov-report=term-missing --cov-report=json` | 61 variantes/cobertura; en Linux, Python del venv preparado. |
| Externa Windows | Raíz: `back/.venv/Scripts/python.exe -X utf8 quality/supabase_integration.py --config-file .quality/e06/credentials.json --output .quality/e09/externa-repeticion` | 12 variantes obligatorias; salida nueva/vacía. Credenciales ignoradas, solo testing. |
| Infraestructura | Raíz: `back/.venv/Scripts/python.exe -m unittest discover -s quality/tests -v` | 66 contratos aparte. |
| CI integral | `gh workflow run quality-ci.yml --ref main --repo ImaDecara/Tesis-EQUITAS` | Reportes nuevos, externa obligatoria y gates; no smoke de main. |
| Preview/smoke TP | `gh workflow run quality-ci.yml --ref quality/tp-testing --repo ImaDecara/Tesis-EQUITAS` | CI de esa rama y smoke automático para su SHA/deployment; E11 alineará la rama con la versión de demo. |
| Estrés | Python del venv: `python quality/load/run.py stress --output .quality/e09/stress-repeticion` | Instalar k6 fijado antes: `python quality/load/install.py`. |
| Sostenido | Python del venv: `python quality/load/run.py soak --output .quality/e09/soak-repeticion` | 600 s de fase más warmup/drenajes y reportes nuevos. |
| Ambas cargas CI | `gh workflow run load-tests.yml --ref main --repo ImaDecara/Tesis-EQUITAS` | Preflight CI del mismo SHA y dos jobs con nueva evidencia. |

No sobrescribir snapshots aceptados. Un cambio de producto/configuración exige reevaluar niveles afectados; editar documentos no agrega pruebas ni ejecuta nuevamente cargas/smoke. E10/E11 deben completar PDF/demo y revisar dependencias con su vencimiento vigente.
