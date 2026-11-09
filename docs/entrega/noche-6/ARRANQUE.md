# Arranque normal, parada y recuperación — demo local V1

El arranque **nunca** resetea, borra ni siembra datos. Si la base no tiene la cartera demo completa, se
detiene y pide ejecutar `init` de forma explícita ([INICIALIZACION.md](INICIALIZACION.md)).

Desde la raíz del repositorio:

| Acción | Comando |
|---|---|
| Abrir la demo | `back/.venv/bin/python scripts/demo/equitas_demo.py start` |
| Ver el estado (solo lectura) | `back/.venv/bin/python scripts/demo/equitas_demo.py status` |
| Detener la app | `back/.venv/bin/python scripts/demo/equitas_demo.py stop` |
| Detener app y Supabase (conserva datos) | `back/.venv/bin/python scripts/demo/equitas_demo.py stop --stack` |
| Credencial de servidor nueva y reinicio | `back/.venv/bin/python scripts/demo/equitas_demo.py renew` |

URL: **http://127.0.0.1:3000/login** (otro puerto: `start --puerto 3100`).

## Qué hace `start`

1. Si Docker no responde, lo indica y termina (abrir Docker Desktop y repetir).
2. Si Supabase local está detenido, lo inicia con `npx --yes supabase@2.108.0 start` (conserva el volumen),
   tomando antes el turno compartido de la base; `stop --stack` también lo toma. Con una campaña en curso, no
   arranca ni detiene el stack.
3. Espera a que Auth y la Data API respondan 200.
4. Verifica, en solo lectura, que la cartera demo coincida con su manifiesto.
5. Emite un JWT nuevo del rol `equitas_review_server` (24 h por defecto, `--horas` hasta 72), solo en
   memoria del proceso de la app. Nunca va al navegador ni a un archivo del repositorio.
6. Compila la app (`next build`) si cambió el commit o la configuración pública, y **siempre** que haya cambios
   sin confirmar en `front/` o `contracts/`.
7. Inicia `next start` en 127.0.0.1 (no en todas las interfaces) y espera a que `/login` responda.

Si la app ya está en marcha con una credencial vigente por más de 2 h y del mismo commit, `start` no hace
nada. Si la credencial está por vencer, la reinicia con una nueva.

## La credencial de servidor vence

El JWT de servidor tiene vencimiento a propósito (no se elimina la expiración). Si pasaron más de 24 h desde
el arranque, la ficha, las decisiones y las descargas CSV responden «no disponible». `status` muestra el
vencimiento; `renew` (o `start`) lo renueva y reinicia la app. Los datos no se tocan.

## Si la computadora se suspendió o se reinició

1. Abrir Docker Desktop y esperar a que esté listo.
2. `back/.venv/bin/python scripts/demo/equitas_demo.py start`.

Los datos viven en el volumen Docker `supabase_db_equitas-tp-testing`. Sobreviven a `stop`, a `stop --stack`
seguido de `start` (probado en N6) y, por cómo funciona un volumen de Docker, también deberían sobrevivir a un
reinicio de Docker o de la computadora (no probado). Se pierden con `db reset`, `stop --no-backup` o borrando
el volumen. El lanzador nunca ejecuta `db reset` ni `--no-backup`
([INICIALIZACION.md §5](INICIALIZACION.md#5-empezar-de-cero-no-hay-recreación-automática)).

## Procesos que crea

- `next-server` (app), lanzado con su propio grupo de procesos. Su PID, puerto y vencimiento de credencial
  quedan en `~/.equitas-demo/run/next.json`; el log en `~/.equitas-demo/run/next.log` (privado).
- Los contenedores `supabase_*_equitas-tp-testing` (Supabase CLI).

`stop` solo detiene el proceso registrado si sigue siendo `next-server` en este `front/`; nunca usa `pkill`
ni toca otros procesos. Si el puerto está ocupado por otro programa, `start` no lo cierra: pedirá otro puerto.

## Exposición en la red

La app escucha solo en 127.0.0.1. La CLI de Supabase publica sus puertos en todas las interfaces con claves
locales conocidas: usar la demo en redes de confianza y `stop --stack` al terminar.
