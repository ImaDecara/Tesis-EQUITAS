# Inicialización sintética (una vez) — demo local V1

La inicialización es **explícita** y está separada del arranque. Crea, si faltan, los catálogos del ETL,
las cuentas sintéticas con sus membresías y la cartera demo publicada por la ETL real. Es idempotente:
repetirla no duplica datos, no cambia contraseñas y no borra decisiones.

Todos los comandos se ejecutan desde la raíz del repositorio.

## 1. Requisitos (versiones fijadas)

| Componente | Versión | Nota |
|---|---|---|
| Docker | Docker Desktop (probado con 29.1.5) | debe estar abierto antes de empezar |
| Supabase CLI | `2.108.0` vía `npx --yes supabase@2.108.0` | la versión elige las imágenes; no usar `latest` |
| Node / npm | 22.23.2 / 11.21.1 | `.nvmrc` y `front/package.json` (`engines`) |
| Python | 3.12 (`back/.python-version`) | se usa el venv `back/.venv` |
| uv | cualquier versión reciente | solo para crear el venv |

Plataforma efectivamente probada: macOS (Apple Silicon) con Docker Desktop. Linux debería funcionar
(el lanzador usa `/proc` o `lsof` para identificar su proceso), pero **no se probó**; Windows no se probó.

La primera vez la CLI descarga unas 13 imágenes (~9 GB) y npm/pip descargan las dependencias fijadas.

## 2. Dependencias del proyecto (una vez por copia del repositorio)

```sh
# npm 11.21.1 sin tocar el npm global, si hace falta:  npx --yes npm@11.21.1 --version
cd front && npm ci --ignore-scripts && cd ..
uv venv back/.venv --python 3.12
VIRTUAL_ENV=$PWD/back/.venv uv pip install -r back/requirements-dev.txt -c back/constraints.txt
VIRTUAL_ENV=$PWD/back/.venv uv pip install pip==25.0.1   # lo exigen los controles de calidad del backend
```

`npm ci` respeta `front/package-lock.json` (incluida la remediación de `minimatch`). No usar `npm install`
para "actualizar": cambia versiones.

## 3. Destino: solo el Supabase local

El lanzador se niega a seguir (sin mostrar valores) si:

- alguna variable de entorno nombra un proyecto Supabase remoto (`supabase.co`, original o testing);
- el repositorio está vinculado a un proyecto remoto (`supabase/.temp/project-ref`);
- la API no es `http://127.0.0.1:54321` o el stack no es `equitas-tp-testing` (`supabase/config.toml`).

Nunca ejecutar `supabase link`, `login`, `db push` ni opciones `--linked`/`--db-url` remotas.

## 4. Inicializar

```sh
back/.venv/bin/python scripts/demo/equitas_demo.py init
```

Qué hace, en orden:

1. Si Supabase local está detenido, lo inicia con la CLI fijada (no resetea).
2. Lee las claves locales con `supabase status -o env` y las guarda en la carpeta privada (0600).
3. Toma el turno de base compartido (`/tmp/equitas-local-db/lock`) para no chocar con una campaña.
4. Comprueba que las migraciones aplicadas sean exactamente las de `supabase/migrations/`. Si faltan,
   indica `npx --yes supabase@2.108.0 migration up --local`; si hay migraciones desconocidas, no toca nada.
5. Inventario: lo que no reconoce como propio (otros municipios, cuentas, lotes u objetos) se **conserva**
   y se informa. Si el municipio 1 (el que usa el ETL) tiene objetos o lotes ajenos, se detiene.
6. Catálogos del ETL (`database/testing/etl-compat-catalogs.sql`, idempotente).
7. Cuentas propias y membresías ([CUENTAS-Y-VARIABLES.md](CUENTAS-Y-VARIABLES.md)). Una cuenta existente
   conserva su contraseña; una membresía existente con otro rol detiene el proceso sin cambios.
8. Cartera: verifica los hashes de `database/demo/cartera-demo-v1` contra su manifiesto. Si ese mismo lote
   ya está publicado, no lo recarga. Si no, ejecuta `ETL.validate_source` (debe dar VALIDADO) y
   `ETL.run_etl --execute` con un JWT de `equitas_import_server` de 1 h emitido en el momento.
9. Compara la base con el manifiesto (15 objetos, 29 obligaciones, ARS 11.665.250,00, publicación atómica).

Opciones:

- `--rotar-claves`: regenera las contraseñas de las cuentas demo (por ejemplo, si se perdió el archivo privado).
- `--republicar`: vuelve a ejecutar el ETL con el mismo lote. Sirve para comprobar su idempotencia: no crea
  eventos ni publicaciones nuevas.

## 5. Recreación destructiva (solo si se pide)

```sh
back/.venv/bin/python scripts/demo/equitas_demo.py recrear --confirmar RECREAR-DEMO
```

Borra la base local con `db reset --local` y vuelve a ejecutar `init`. Solo procede si el inventario
muestra **exclusivamente** recursos de la demo; si encuentra cualquier dato ajeno, no borra nada. Se
pierden las decisiones y aprobaciones de la demo y se generan contraseñas nuevas.

## 6. Qué no hace

- No carga datos reales ni copia esta base a otro entorno.
- No toca los proyectos Supabase original ni testing.
- No arranca la app: eso es [ARRANQUE.md](ARRANQUE.md).
