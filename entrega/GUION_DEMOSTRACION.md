# Demostración y defensa de EQUITAS

Versión de aplicación candidata: **5b62c14c8186b1ea79c4d4c2aa7dfb8acbb26198**, 23/10/2026. Nivel 2: prototipo parcial. El manifiesto [E11](../evidencias/e11/validacion-integral.json) identifica CI, deployment, smoke y cargas. Las actualizaciones de informe y de este guion se publican después del corte; no modifican el producto probado.

## 1. Preparación antes de presentar

1. Abrir el [PDF](INFORME_ACADEMICO_CALIDAD.pdf), el [repositorio](https://github.com/ImaDecara/Tesis-EQUITAS), el manifiesto E11 y los runs citados allí. Descargar los reportes con anticipación: Actions los conserva 30 días.
2. Abrir el Preview de E11 desde el manifiesto. Mantener la protección Vercel; un integrante con acceso puede iniciar sesión en Vercel. Las credenciales sintéticas de Supabase se obtienen de la configuración privada de testing; nunca mostrarlas en pantalla, diapositivas o Git.
3. Usar el usuario de tenant A para el recorrido. No usar cuentas ni cartera del Supabase original. Deben aparecer el importe 1250, riesgo 20 y la persona/objeto de A; B no debe aparecer.
4. Tener preparados los HTML de cobertura y rendimiento, el resumen del gate y los JSON/JUnit. El [catálogo de casos](../CASOS_PRUEBA_CALIDAD.md) explica precondición, entrada y esperado.
5. Reservar aproximadamente 15 minutos de exposición y tiempo para preguntas. Las cargas completas tardan más de diez minutos: mostrar sus reportes existentes y disparar una repetición si lo solicitan, sin alterar duración ni umbrales.

## 2. Recorrido de exposición, con evidencia

| Minutos | Mostrar y hacer | Qué explicar / resultado esperado |
| --- | --- | --- |
| 0–2 | Carátula, objetivo y arquitectura del informe. | EQUITAS apoya gestión y recupero municipal. La web usa Supabase; FastAPI es un componente separado. Nivel 2 no significa listo para producción. |
| 2–4 | Login A, dashboard, Objetos y Personas del Preview E11. Buscar un valor inexistente y pulsar Limpiar. | Total 1250, datos A y ausencia de B; el campo vuelve a vacío y el listado se restaura. Después logout y acceso directo a ruta protegida deben llevar al login. El smoke automatiza ese recorrido con cinco comprobaciones, contadas como una campaña. |
| 4–6 | CI E11: cuatro jobs; resumen, cobertura, lint, auditoría, duplicación y gate. | 107 frontend + 61 backend + 12 HTTP reales = 180; sin fallos/omisiones. Los 66 controles del harness se informan aparte. Mostrar la base fija y el gate de código nuevo. |
| 6–8 | [Rojo E03](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39672114249), [verde E03](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39673351642) y [comparación](../evidencias/e03/comparacion-dat-06.json). | El mismo dataset de 3507 IDs perdía filas por límites de respuesta 1000/3000. Cursor por id recupera 3507 sin pérdidas/duplicados. Conservar las cuatro aserciones originales prueba la corrección; una inyección del gate es otra evidencia diferente. |
| 8–10 | Reporte Supabase E11, fixtures y negativos. | Auth/Data API HTTP reales, con clave pública de cliente y JWT normal: acceso A/B positivo, sin pertenencia/inactivo/anon/tenant ajeno denegados, DML denegado y logout. El SQL administrativo no sustituye estas pruebas. Testing está corregido; el defecto del original sigue abierto. |
| 10–12 | Pipeline de cargas E11, reportes HTML y series por fase/operación. | FastAPI con fuente sintética local: 3600 perfiles, 72000 deudas representadas por agregados. Estrés 1/5/10/20/40 y sostenido 10×600 s. Objetivo previo hasta 10 VU: p95≤2000 ms y error≤1%; cero diferencias de contenido. 20/40 son exploratorios. |
| 12–14 | Matriz de herramienta, métricas, issues y conclusiones. | k6 se incorporó en cinco pasos y obtuvo 4,7 con pesos anteriores a la PoC. No se probaron Locust/JMeter. OBS-DEP-001 se cerró por retiro oficial del aviso y audit actual 0/0; no por cambio de paquete. RLS original, UAT, accesibilidad y recuperación cloud siguen limitados. |
| 14–15 | Fuente editable, PDF, manifiesto y comandos. | El acumulado sigue siendo 183: 180 + un smoke + dos campañas. Repetirlos no crea casos nuevos. Explicar qué está cumplido, qué está parcialmente verificado y qué debe hacer cada integrante antes de la defensa. |

## 3. Preguntas que cada integrante debe poder responder

**¿Qué prueba concreta puedo explicar?** Elegir DAT-06, AUTH, REC o un caso ETL del catálogo. Identificar Arrange (fixture/doble/datos), Act (función o request) y Assert (resultado/efecto/denegación). Explicar un negativo y por qué fallaría si se elimina la corrección. Un estado HTTP 200 por sí solo no prueba contenido correcto.

**¿Cómo se calcula cobertura?** Sentencias cubiertas/sentencias instrumentadas×100. Frontend: 794/1283=61,8862%; backend: 1254/1471=85,2481%. Vitest presenta 61,88% por su formato. Ramas: 566/1068 y 339/498; pasar 60% de sentencias no implica cubrir todas las decisiones. Backend combinada 1593/1969=80,9040% no debe confundirse con su cobertura de sentencias.

**¿Qué es código nuevo?** El diff contra la base fija `531996f51243dc3d4c5a607338e2f35e32313f6b`. Líneas nuevas ejecutables: 36/36 front y 15/17 back, 100% y 88,2353%. No se movió la base para aprobar. Un porcentaje global no sustituye esos dos controles.

**¿Qué bloquea el gate?** Fallos de controles, cobertura existente menor al 60%, nueva menor al 80%, duplicación por líneas mayor al 5%, diagnósticos críticos configurados o auditorías sin tratamiento aceptado. Duplicación actual 427/11159=3,8265%. Reportes incompletos/procedencia incorrecta también deben impedir aceptación. No afirmar que existe un análisis universal de toda vulnerabilidad.

**¿Qué demuestra rojo/verde?** Un defecto real reproducible con esperado fijo, modificación identificada y misma aserción que cambia a verde. El rojo E03 tiene cuatro fallos reales; el verde posterior conserva esas aserciones y amplía la suite. El gate crítico inyectado demuestra bloqueo, no un defecto productivo descubierto.

**¿Qué demuestran RLS y cargas?** RLS real se verificó en testing con positivos y negativos. No corrige ni certifica el original. Las cargas verifican una API y dataset concretos en runners compartidos, sin medir Supabase, red municipal ni web cloud. En E11, 40 VU superó 2000 ms en el tramo exploratorio; hasta 10 VU cumplió el objetivo obligatorio. Esa observación no da una capacidad máxima universal. Diez minutos no demuestran ausencia de fugas.

**¿Por qué ahora hay cero avisos y antes cinco?** Cambió la base de avisos: GitHub retiró el aviso el 23/10. El lockfile no cambió. Auditoría completa/productiva 0/0 y `exception:null`; los resultados anteriores se conservan. No fue una mejora de código ni una actualización de dependencias.

## 4. Repetir la validación técnica con un comando

Prerequisitos: PowerShell 5.1+ o 7, GitHub CLI autenticado con acceso al repositorio/Actions, workflows habilitados y secretos de testing/bypass previamente configurados. El comando no muestra ni requiere copiar esos secretos al terminal. `main` y `quality/tp-testing` remotos deben apuntar al **mismo candidato** antes de iniciar; el controlador rechaza desalineaciones. Ver [configuración del Preview](../CONFIGURACION_VERCEL_E07.md) y [Supabase testing](../SUPABASE_TESTING_CALIDAD.md).

Desde la raíz del repositorio, para el candidato actualmente publicado en ambas referencias:

```powershell
powershell -NoProfile -File entrega/validacion-integral.ps1 -CandidateSha <SHA_COMPLETO> -OutputDirectory .quality/ensayo-nuevo
```

El controlador inicia CI en main y testing, espera los cuatro jobs, conserva el smoke automático posterior al CI de testing y ejecuta las cargas en main. Verifica procedencia, descarga reportes y comprueba el SHA/CI/proyecto del smoke. La salida debe ser nueva para conservar los resultados anteriores. La creación de un Preview nuevo requiere un push nuevo a la rama persistente; volver a despachar CI sobre un SHA ya desplegado prueba ese deployment existente. Para una versión distinta, alinear las ramas mediante fast-forward revisado y seguir el nuevo deployment hasta READY.

La repetición E11 usó el mismo comando con `-MainRunId 39976881137 -PreviewRunId 40032393112 -LoadRunId 40032355979 -SmokeRunId 40032558356`, retomando ejecuciones ya iniciadas sobre el SHA completo del encabezado. Esos parámetros no omiten verificaciones; evitan duplicar campañas costosas. Los comandos individuales permanecen en [el roadmap](../ROADMAP_TP_CALIDAD_SOFTWARE.md#19-tabla-de-comandos-que-debe-quedar-completa-al-entregar).

## 5. Contingencia durante la demostración

- Si un servicio externo no responde, mostrar fecha/versión del último reporte aprobado y explicar el fallo actual. No presentarlo como ejecución en vivo aprobada.
- Si un enlace de Actions expiró, abrir el JSON/JUnit/HTML/series versionados de E11 y sus digests. Si necesitan reporte nuevo, repetir; no modificar el resultado histórico.
- Si el smoke o gate falla, detener la afirmación de validación, conservar salidas y revisar causa. No retirar negativos, acortar el sostenido ni bajar umbrales para conseguir verde.
- Si aparece cartera real o un destino distinto de testing, detener el recorrido y corregir la configuración antes de continuar.

## 6. Confirmación individual y académica

Los nombres y aportes observables se conservan en [APORTES_TP_CALIDAD.md](../APORTES_TP_CALIDAD.md); no se inventan horas ni porcentajes. Universidad, carrera, tres integrantes y fecha prevista están en la carátula. No se dispone de docente/comisión/legajos; solo agregarlos si la cátedra los requiere y el equipo los confirma.

- [ ] Ignacio Magoia repasó un caso AAA, coberturas/gates, rojo/verde y límites; confirmó sus aportes y datos.
- [ ] Axel Azcune repasó un caso AAA, coberturas/gates, rojo/verde y límites; confirmó sus aportes y datos.
- [ ] Imanol Decara repasó un caso AAA, coberturas/gates, rojo/verde y límites; confirmó sus aportes y datos.
- [ ] El equipo ensayó la exposición oral y confirmó quién muestra cada bloque.
- [ ] Se realizó la presentación y entrega en el canal indicado por la cátedra.

Esta lista registra acciones humanas, no resultados automatizados. La validación técnica y el guion no acreditan por sí solos la preparación de los tres integrantes ni una defensa ya realizada.

Confirmación del responsable durante E11: todavía falta el repaso del equipo. Las casillas anteriores permanecen abiertas hasta realizarlo.
