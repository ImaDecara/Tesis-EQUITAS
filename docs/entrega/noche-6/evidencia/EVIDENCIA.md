# Evidencia seleccionada — noche 6 (2026-11-09)

Copia depurada de la evidencia completa, que vive en el paquete local del plan
(`execution/evidence/noches/noche-6-*`, fuera de Git). Sin contraseñas, claves, JWT ni datos personales:
solo la cartera sintética de la demo.

| Archivo | Qué es |
|---|---|
| [`recorrido-final.json`](recorrido-final.json) | Recorrido real de la demo definitiva sobre `f6e2a4d2`, árbol limpio: 12/12 |
| [`persistencia-final.json`](persistencia-final.json) | Mismo recorrido tras `stop --stack` y `start`: 7/7, misma decisión y aprobación |
| [`01-consulta-tablero.png`](01-consulta-tablero.png) | Tablero de `consulta`: corte 2026-09-30, deuda total $ 11.665.250, panel de 3 CSV |
| [`02-supervisor-aprobacion.png`](02-supervisor-aprobacion.png) | Ficha `DEMO6-1-60003`, pestaña Revisión: propuesta del operador aprobada por el supervisor |

## Resultados registrados

| Control | Código | Resultado |
|---|---|---|
| Gates del repositorio (`quality/ci.py` frontend y backend, `summary`, `gates.py`) | `f6e2a4d2` | `passed=true`; frontend 1910/1910, backend 1967/1967; `npm audit` 0 total / 0 producción, sin excepción; líneas nuevas cubiertas 97,95 % FE / 96,53 % BE; duplicación 1,67 % |
| Recorrido ALIGN-029 real (CLI + navegador) | `7189171` | 15/15, consola 0 |
| Campaña ALIGN-022 + `validate --sha` | `7189171` | 75/75, aprobada |
| E06 con adaptación local declarada (originales intactos) | `7189171` | 12/12 |
| SMOKE-01 local | `7189171` | 5/5 |
| ALIGN-028 reportes por HTTP | `7189171` | 908/912: las 4 fallas son preexistentes; un control negativo sobre una copia exacta de `efad967` da el mismo resultado |
| Demo definitiva: `init`, recorrido, `stop --stack` + `start`, persistencia, `init` y `init --republicar` | `f6e2a4d2` | aprobados; la base quedó idéntica tras repetir la carga |

`7189171` y `f6e2a4d2` tienen el mismo código de aplicación (el último ciclo solo cambió el lanzador, pruebas
y documentación), por eso las campañas no se repitieron.

## Revisión independiente

Codex `gpt-6-astra`, otro proveedor que el autor (Claude Opus 5.5): revisión inicial de `5d8e175` con cambios
pedidos (un bloqueante y dos mayores); ciclo 1 sobre `7189171` con un bloqueante residual; ciclo 2 sobre
`f6e2a4d2` **aprobado** sin defectos nuevos. Se usaron los 2 ciclos globales autorizados. Se excluyó la
recreación destructiva automática (`recrear`) porque no se puede demostrar la pertenencia de todo lo que borra
un `db reset`.

Las corridas de ensayo de esa noche sobre árboles con cambios sin confirmar fueron de desarrollo y no se
presentan como evidencia final.
