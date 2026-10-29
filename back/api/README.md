# FastAPI interna — reglas v1 (ALIGN-015)

Este servicio **no se despliega sin autenticación** y la web no lo consume.
Hasta integrar ALIGN-052, su único uso admitido es local con datos sintéticos,
escucha en `127.0.0.1` y el destino local permitido por la guardia de ALIGN-025.
CORS no sustituye autenticación, autorización ni aislamiento por municipio.
La API todavía carece de esas garantías: véase [ADR-001](../../docs/tesis/adr-001-reglas-y-capas.md).

## Reglas y corte

`services.decision_rules_v1.evaluate(entrada)` es puro: lee los parámetros y
textos de `contracts/decision-rules.v1.json` y devuelve exactamente la estructura
del golden compartido. No usa Supabase, el reloj ni los demás objetos del lote.
La simulación puede importar ese núcleo directamente. El llamador conserva
`RULES_VERSION`, el id y `as_of` junto a cada decisión.

Las rutas de scoring exigen `as_of=YYYY-MM-DD`. Un corte ausente o inválido
produce HTTP 422 antes de consultar datos. No se sustituye por la fecha de hoy.
La respuesta declara `version_reglas`, `as_of` y, por caso, la procedencia del
corte: declarado por el llamador; el corte municipal sigue no integrado.

| Ruta GET | Resultado |
|---|---|
| `/health` | Estado del proceso; no consulta datos |
| `/case-groups/definitions` | Intervenciones y colas del JSON v1 |
| `/case-groups?as_of=2026-09-30` | Casos con decisión v1 completa y metadatos |
| `/case-groups/summary?as_of=2026-09-30` | Conteos de colas, bandas de severidad y contacto |

Filtros: `group_key` (código de intervención), `severity_band` (`BAJA`, `MEDIA`,
`ALTA`, `NO_DISPONIBLE`), `tag` (bandera v1) y `search` (referencias del objeto).
`limit` admite 1–500 y `offset` es no negativo. La paginación de la respuesta
se aplica **después** de completar, evaluar, agrupar y ordenar la cartera.

Las colas se concatenan en el orden declarado por `intervenciones` en el JSON;
no se comparan prioridades entre colas. Dentro de cada cola se usa prioridad
descendente, monto descendente, vencimiento más antiguo ascendente e id textual
por punto de código; los nulos van al final. La severidad no disponible se cuenta
en su propia banda y conserva prioridad null, nunca cero.

## Lectura y adaptación del esquema

- Se leen todos los objetos `debtor`, incluso sin perfil persistido. Los perfiles
  activos solo aportan su id de referencia; si hay varios, se referencia el id
  mayor. Sus totales, riesgo, antigüedad y contactos v0 no intervienen en v1.
- Todas las lecturas usan orden ascendente por `id`, `id > cursor` y límite
  solicitado 1000. Se continúa hasta una página vacía, incluso si el servidor
  devuelve menos filas. Los filtros de ids se dividen en lotes de 200 y se
  paginan también. Un cursor repetido, desordenado o inválido es un error.
- `debt.current_amount` y `due_date` alimentan las reglas al corte declarado.
  El adaptador distingue ausencia, campo no integrado y dato inválido; conserva
  el cero observado. Solo acepta `updated_amount` como alias cuando la columna
  `current_amount` no existe; nunca usa capital como respaldo. Las consultas
  del esquema vigente seleccionan `current_amount`.
- Contactos: relaciones activas, contactos activos y valor no vacío; se deduplica
  por persona, canal y valor sin distinguir mayúsculas. Contacto cargado no
  significa validado. No se usa el conteo persistido de perfiles.
- Los porcentajes declarados se conservan sin normalizar. El tipo se resuelve
  por claves explícitas de catálogo (`FISICA`/`INDIVIDUAL`,
  `JURIDICA`/`LEGAL_PERSON`, `UNKNOWN`); claves no homologadas son `INVALIDO` y
  solo activan una bandera. No se consulta nombre, documento ni domicilio.
- `period`, `status` e `issue_date` heredados no se presentan como período
  fiscal, estado de origen ni actualización de lote: esas entradas son
  `NO_INTEGRADO`. Vulnerabilidad permanece `NO_INFORMADO_EN_ORIGEN`.
- Una lectura fallida invalida la solicitud: HTTP 503 `READ_INCOMPLETE` y nombre
  de tabla, sin payload remoto ni resultados parciales. No se trata como una
  cartera vacía ni como ausencia de deuda/contacto.

La paginación por cursor necesita un lote estable; no crea un snapshot
transaccional entre consultas. La aprobación municipal de la política v1 y la
integración del corte y los catálogos de origen siguen pendientes de sus tickets.
El ETL heredado pudo persistir inválidos como cero: este servicio no puede
reconstruir la ausencia que ya se perdió en origen (ALIGN-024/026).

## Incompatibilidad deliberada con v0

Se retiraron `classify_risk_band`, `calculate_priority_score`, `build_case_tags`
y `assign_case_group` del servicio. Su archivo histórico es
`back/services/scoring_service.py` en `b5bc9ab7db990000b68232f4f7e86386ed7684e9`
y su descripción está en PY01–PY03 del contrato. No existe un selector de
fórmula v0 en ejecución. `risk_band` se reemplaza por `severity_band`; no se
devuelve `socioeconomic_risk_level` ni se imprime un porcentaje de riesgo.

Las cargas E08/E11 y sus fixtures pertenecen a sus SHA históricos, no validan
este contrato HTTP ni estas lecturas. Repetirlas exige una fixture v1 y una
nueva campaña; [nota de rendimiento](../../RENDIMIENTO_CALIDAD.md).

## Verificación sin red

Desde `back/`, con las dependencias fijadas:

```sh
.venv/bin/python -m pytest --cov
.venv/bin/python -m ruff check ETL api services
```

Los golden, contrafactuales, ordenamientos y pruebas de paginación son sintéticos.
Las pruebas inyectan clientes falsos: no necesitan credenciales ni bases remotas.
La CLI requiere un corte explícito (`python -m services.scoring_service
--as-of YYYY-MM-DD`) y muestra solo conteos; su ejecución con cliente real sigue
sujeta a las restricciones locales de este documento y de ALIGN-025.
