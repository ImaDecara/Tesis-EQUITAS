# Reproducir los controles locales de calidad — EQUITAS

**Actualización E11, 23/10/2026:** validación técnica integral aprobada sobre `5b62c14`: cuatro jobs obligatorios, 180 pruebas de producto, nuevo Preview/smoke y dos cargas del mismo SHA; acumulado **183**, con **66 controles de infraestructura aparte**. [Manifiesto portable](evidencias/e11/validacion-integral.json), [ficha](REGISTRO_EJECUCION_E11.md), [guion y repaso individual](entrega/GUION_DEMOSTRACION.md). Auditorías completas/productivas actuales **0/0**, sin excepción utilizada; OBS-DEP-001 cerrado por retiro oficial del aviso, conservando la historia. DEF-SUP-001 original sigue abierto. **E11 no está completamente cerrada: falta confirmar preparación individual, ensayo oral y datos del equipo.** Esta nota prevalece sobre estados históricos anteriores.

**Actualización E06, 21/10/2026:** Supabase aislado **EQUITAS-TP-TESTING**, `iylwghgvtydpmwidojdo`, creado en Ignacio Magoia con cotización USD 0 mensuales. Auth/Data API reales y funciones productivas verificadas en [CI main](https://github.com/ImaDecara/Tesis-EQUITAS/actions/runs/39686380481), SHA `4bb783f1a34c25e9003ee6ece66825668b1c1106`: **163 pruebas aisladas + 12 reales = 175 de producto aprobadas, cero fallidas/omitidas**, y **48 controles de infraestructura** aparte. Se conserva rojo/verde HTTP de SUP-RLS-02. **DEF-SUP-001 corregido en testing; sigue abierto para el proyecto original**, que mantiene sus políticas permisivas. CAS-EXT #9 cerrado; nueve issues, siete cerrados y dos abiertos (#1 y #3). [Ficha E06](REGISTRO_EJECUCION_E06.md), [preparación/comandos](SUPABASE_TESTING_CALIDAD.md) y [evidencias](evidencias/e06/resumen-ci.json). Frontend 788/1.277 sentencias (61,7071 %; Vitest informa 61,70 %); backend 1.254/1.471 (85,25 %); nuevo frontend 30/30 y backend 15/17 contra base fija `531996f…`; duplicación 427/11.141 (3,83 %). No cambiaron los filtros de cobertura. E07 es la siguiente etapa; despliegue/smoke, cargas y cierre académico permanecen pendientes. Esta actualización prevalece sobre los estados históricos de integración omitida o pendiente.

Corte verificado: E01–E04, 21/10/2026. Preparación en [E01](REGISTRO_EJECUCION_E01.md), pipeline en [E02](REGISTRO_EJECUCION_E02.md), lectura completa en [E03](REGISTRO_EJECUCION_E03.md) y gates en [E04](REGISTRO_EJECUCION_E04.md). Los controles locales tienen su equivalente remoto en [GitHub Actions](.github/workflows/quality-ci.yml), con [guía operativa](quality/README.md).

La suite vigente aprueba **101 frontend y 61 backend**, con una integración externa omitida; infraestructura aporta otras **41 aprobadas**. Cobertura frontend 791/1.280 (Vitest 61,79 %). Los gates están integrados al resumen y tienen [comando independiente](REGISTRO_EJECUCION_E04.md). OBS-COB-001 está cerrada. Despliegue, integración real y cargas continúan pendientes. Los comandos/versiones de preparación se conservan.

## 1. Herramientas y preparación

Usar **Node 22.23.2**, **npm 11.21.1** y **CPython 3.12.14 de 64 bits**. La instalación Python se comprobó con **pip 25.0.1**. `.nvmrc` y `back/.python-version` identifican las versiones; no instalan por sí mismos las herramientas. Verificar el intérprete seleccionado antes de crear el entorno.

```powershell
node --version
python --version
python -c "import platform; print(platform.python_implementation(), platform.architecture()[0])"
npx --yes --package=npm@11.21.1 npm --version
```

`python` debe resolver al CPython indicado. Si el equipo tiene varios intérpretes, usar el ejecutable correspondiente en el comando de creación. Las instrucciones no dependen de una ruta privada de esta máquina.

Los comandos `npx --yes --package=npm@11.21.1 npm ...` ejecutan la versión exacta de npm sin cambiar la instalación global. Si ya se tiene npm 11.21.1, se puede usar `npm ...` directamente. npm 10.9.8 presentó un fallo de resolución durante esta actualización: no es la versión elegida para reproducir el lock final.

La instalación requiere acceso al registro npm y PyPI. El build también requiere Google Fonts por `next/font/google`. No se requieren cuentas de la cartera real para las pruebas aisladas ni el build local. Las configuraciones existentes de Supabase se preservan; sus secretos se guardan fuera de Git.

## 2. Frontend, desde `front`

```powershell
cd front
npx --yes --package=npm@11.21.1 npm ci
npx --yes --package=npm@11.21.1 npm ls --all
npx --yes --package=npm@11.21.1 npm run test:coverage
npx --yes --package=npm@11.21.1 npm run lint
npx --yes --package=npm@11.21.1 npm run build
npx --yes --package=npm@11.21.1 npm run quality:duplicates
npx --yes --package=npm@11.21.1 npm run quality:complexity
npx --yes --package=npm@11.21.1 npm audit
npx --yes --package=npm@11.21.1 npm audit --omit=dev
```

Ejecutar cada comando y revisar su salida. En PowerShell, consultar `$LASTEXITCODE` inmediatamente después de cada control; en bash, `$?`. No encadenar ignorando errores. Para una instalación estable utilizar `ci`, no regenerar el lock con `install` como paso habitual.

Resultados E01: 33 aprobadas y 1 omitida; lint/build aprobados; duplicación 4,24 %. La auditoría completa **devuelve 1** por cinco altos de desarrollo conocidos; la productiva devuelve 0. Ese fallo y su tratamiento están documentados como OBS-DEP-001. Un resultado diferente requiere revisión, no aprobación automática.

Cobertura actual frontend: **586/1.275 sentencias = 45,96 %**, por debajo del mínimo de 60 %. El reporte incluye los mismos 54 archivos del alcance anterior; Vitest 4 cambió el mapeo V8. Conservar el JSON y atender OBS-COB-001 antes de cerrar E04. No utilizar 60,43 % histórico como resultado de esta versión.

Salidas: `front/coverage/` para cobertura; `.quality/jscpd/jscpd-report.json` y `.quality/jscpd/jscpd-complexity.json` para métricas. `quality:duplicates` mide, pero todavía no implementa el bloqueo del 5 % de E04.

## 3. Backend, desde `back`

En Windows, partiendo de la raíz del repositorio y de un intérprete correcto:

```powershell
cd back
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -m pytest --cov --cov-report=term-missing --cov-report=json --cov-report=html
.\.venv\Scripts\python.exe -m ruff check ETL api services --output-format concise
```

Usar una carpeta de entorno vacía para comprobar una instalación nueva; no hace falta eliminar un entorno de trabajo que se quiera conservar. No ejecutar el ETL real para validar esta etapa.

Consultar `.\.venv\Scripts\python.exe -m pip --version`. Si el entorno trae una versión distinta y se necesita reproducir exactamente la herramienta de instalación de este corte, fijarla primero con `.\.venv\Scripts\python.exe -m pip install pip==25.0.1`.

En Linux, el equivalente comprobado por E02 es:

```bash
cd back
python -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pip check
.venv/bin/python -m pytest --cov --cov-report=term-missing --cov-report=json --cov-report=html
.venv/bin/python -m ruff check ETL api services --output-format concise
```

Los comandos Windows se comprobaron en un entorno nuevo. **La ejecución Linux quedó comprobada en E02**, con Ubuntu 24.04, CPython 3.12.14 y `uvloop==0.23.0` instalado. Las versiones directas son exactas y `requirements.txt` incorpora `constraints.txt`, con los pins transitivos y la dependencia condicional `uvloop`. No usar `--no-deps`: deben evaluarse también los requisitos condicionales de la plataforma.

Resultados E01: 61 pruebas aprobadas, una advertencia Starlette/TestClient, 85,25 % de sentencias y 68,07 % de ramas. Ruff normal devuelve 0 con tres excepciones locales TRY004 justificadas. Para auditarlas, este comando debe mostrar exactamente esas tres observaciones y devolver 1:

```powershell
.\.venv\Scripts\python.exe -m ruff check ETL api services --ignore-noqa --output-format concise
```

No incorporar ese ensayo de inspección como un falso fallo de regresión. `pip check` comprueba compatibilidad de dependencias; **no analiza vulnerabilidades**. En esta etapa no se ejecutó un auditor de vulnerabilidades Python.

## 4. Alcance, actualizaciones y criterio de aceptación

La cobertura frontend incluye `app/`, `components/`, `lib/` y excluye `.d.ts`; `proxy.ts` permanece fuera del alcance histórico. Backend mide `ETL`, `api` y `services`, con ramas. jscpd usa las tres carpetas frontend y las tres backend, mínimos de 5 líneas y 50 tokens. Los umbrales automáticos y la cobertura sobre código nuevo corresponden a E04.

Una actualización deliberada requiere revisar avisos y compatibilidad, cambiar pins/locks, instalar desde cero y ejecutar los controles afectados. No adoptar un `pip freeze` ajeno sin revisar paquetes condicionales ni asumir compatibilidad Linux porque funciona en Windows. No borrar avisos mediante filtros globales o códigos de salida ignorados.

Los reportes locales de partida son [evidencias/e01](evidencias/e01/resumen-2026-10-21.json). Los resultados remotos, SHA, artefactos y comprobaciones Linux están en [evidencias/e02](evidencias/e02/ejecuciones-2026-10-21.json). El commit de cierre documental de cada etapa se consulta en el historial de su ficha.

## E07 — Preview y smoke automático

Ver [configuración por rama y secreto](CONFIGURACION_VERCEL_E07.md) y [ejecución aceptada](REGISTRO_EJECUCION_E07.md). Desde `front`: `npm exec --no -- playwright install chromium`; luego `npm run test:smoke -- --deployment ../.quality/preview/deployment.json --output ../.quality/smoke-repeticion`. Usar un directorio nuevo y secretos externos; el manifiesto exige CI/SHA/URL correctos. El flujo de `quality/tp-testing` se ejecuta automáticamente después del CI obligatorio y disponibilidad del Preview. Un fallo devuelve salida 1 y conserva diagnóstico.

## E08 — Cargas aisladas reproducibles

[Preparación y comandos completos](RENDIMIENTO_CALIDAD.md). Con el entorno Python fijado activo: `python quality/load/install.py`; luego `python quality/load/run.py stress --output .quality/e08/stress-repeticion` o `python quality/load/run.py soak --output .quality/e08/soak-repeticion`. Sin credenciales cloud; salida nueva obligatoria. El workflow genera datos/reportes nuevos, requiere CI del mismo SHA y conserva evidencia incluso con fallo.
