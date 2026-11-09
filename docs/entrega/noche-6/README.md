# EQUITAS — entrega intermedia V1 persistente (noche 6)

Fecha: 2026-11-09. Procedencia: autorización N6-V1-PERSISTENTE del usuario (mensaje T3 del 2026-11-09T10:37Z),
registrada en el plan `2026-10-28-v2` (paquete local `PlanToFinish/`, fuera de Git). El índice operativo de
pendientes sigue siendo `execution/BACKLOG-UNICO.md` de ese paquete; [PENDIENTES.md](PENDIENTES.md) es un
resumen fechado, no un segundo plan.

## Qué es

Una versión local que se puede abrir, recorrer, detener y volver a arrancar sin perder datos:

cartera sintética publicada por la ETL real → tablero y colas → ficha → decisión del operador →
aprobación de otro supervisor → reportes CSV.

Es una **entrega intermedia V1**. No completa la importación web (055–058), el MVP v2, la analítica
experimental, el canal ni la tesis, y no es una operación real: ver [PENDIENTES.md](PENDIENTES.md).

## Versiones

| Dato | Valor |
|---|---|
| Rama | `delivery/noche-6-v1` (solo local; sin push) |
| Base | `efad96793048a495c53869c0126e8b5250cfb916` = `delivery/2026-10-28-v2` (última integración aceptada, ALIGN-029) |
| Código probado y SHA final | ver [§ Estado al cierre](#estado-al-cierre) |
| `main` | sin cambios (`36f35b4`) |

La rama conserva toda la integración anterior (`efad967` es ancestro) y agrega:

1. Remediación de GHSA-g3hv-75wg-m249: `minimatch` 11.0.5 fijado solo para `@typescript-eslint/typescript-estree`.
2. Accesos visibles a los cinco CSV existentes (panel por rol en el tablero; CSV de la cola con sus filtros).
3. Cartera demo determinista [`database/demo/cartera-demo-v1`](../../../database/demo/cartera-demo-v1) y su
   generador [`scripts/demo/cartera_demo.py`](../../../scripts/demo/cartera_demo.py).
4. Lanzador [`scripts/demo/equitas_demo.py`](../../../scripts/demo/equitas_demo.py): `init` (inicialización
   sintética explícita) separado de `start` (arranque normal que nunca borra ni siembra).
5. Recorrido automatizado [`front/tests/smoke/demo-local-walkthrough.mjs`](../../../front/tests/smoke/demo-local-walkthrough.mjs)
   y pruebas [`back/tests/test_demo_local.py`](../../../back/tests/test_demo_local.py).

## Por dónde empezar

1. [INICIALIZACION.md](INICIALIZACION.md): requisitos, instalación de dependencias fijadas e `init`.
2. [ARRANQUE.md](ARRANQUE.md): `start`, `stop`, `status`, `renew` y recuperación tras apagar o suspender.
3. [CUENTAS-Y-VARIABLES.md](CUENTAS-Y-VARIABLES.md): dónde están las cuentas (privadas) y qué variable usa cada proceso.
4. [RECORRIDO.md](RECORRIDO.md): qué probar, qué se debe ver y el manifiesto de la cartera.
5. [VERCEL.md](VERCEL.md): compatibilidad con el proyecto Vercel existente y lo que falta antes de publicar.

En una línea, desde la raíz del repositorio y con las dependencias instaladas:

```sh
back/.venv/bin/python scripts/demo/equitas_demo.py init    # una vez: cuentas y cartera
back/.venv/bin/python scripts/demo/equitas_demo.py start   # cada vez: abre http://127.0.0.1:3000/login
```

## Tres estados, separados

| Estado | Resultado |
|---|---|
| Funciona localmente | ver [§ Estado al cierre](#estado-al-cierre) |
| Compatibilidad de build/configuración con el Vercel existente | comprobada hasta el alcance descrito en [VERCEL.md](VERCEL.md); hay precondiciones del panel que no se pudieron verificar |
| Despliegue Vercel de esta candidata probado | **no realizado**: N6 no autoriza push ni despliegue |

«Local aprobado» no equivale a «producción aprobada».

## Estado al cierre

Se completa al cerrar la noche con el SHA final, las pruebas ejecutadas y sus resultados.
