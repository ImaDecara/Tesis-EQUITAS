# Espejo local de la base original

Un proyecto Supabase local aparte (`equitas-n7-espejo`, puertos 56321 y 56322, carpeta privada `~/.equitas-n7-espejo`) para ensayar compatibilidad con la base original **sin tocarla**. Reproduce lo comprobado y la foto del catálogo de octubre. **No es idéntico a producción**: ver `docs/entrega/noche-7/anexos/espejo-comprobado-foto-desconocido.md`.

Los datos son sintéticos y se cargan por SQL. Sirve para probar consultas, permisos y rendimiento. **No verifica la carga de archivos**: eso se acepta solo en el entorno de `scripts/local/equitas_local.py`.

Nada de lo que hay acá se aplica a una base remota.

## Comandos

Desde la raíz del repositorio, con el Python del backend (`back/.venv/bin/python scripts/espejo/equitas_espejo.py …`):

| Comando | Qué hace |
|---|---|
| `start` | Crea o arranca el espejo: esquema base, privilegios de la foto, catálogos y cinco cuentas sintéticas. |
| `stop` | Lo detiene y conserva los datos. |
| `status` | Estado, solo lectura. |
| `verificar-esquema` | Compara columnas, restricciones y políticas con la foto de octubre. |
| `cargar chico` | Los diez casos chicos de `contracts/portfolio-small-cases.v1.json`. |
| `cargar escala` | 2.900 objetos y 55.684 obligaciones, solo para medir. |
| `sql ARCHIVO [--solo-lectura] [--ajuste equitas.nombre=valor]` | Corre un archivo de `database/espejo/`. |
| `probar-lectura` | Qué lee cada cuenta por la Data API, con su propia sesión (solo conteos). |
| `recrear --confirmar equitas-n7-espejo` | Borra el espejo. Es descartable. |

Se niega a operar sobre los identificadores y carpetas de la demo de la noche 6 y del entorno de la noche 7.

## Archivos de `database/espejo/`

| Archivo | Para qué |
|---|---|
| `catalogos.sql` | Catálogos y municipios del espejo (roles 1 ADMIN y 2 USER; los ocho estados de `main`). |
| `datos-escala.sql` | Cartera sintética a escala. |
| `paquete-minimo.sql` | Propuesta mínima para registrar decisiones y obtener reportes. Lo genera `scripts/espejo/generar_paquete.py`. |
| `paquete-minimo-verificar.sql` | Solo lectura: se corre antes y después. |
| `paquete-minimo-revertir.sql` | Reversa completa. Se niega si hay filas, salvo `--ajuste equitas.confirmar_borrado=si`. |
| `cartera-heredada.sql` | Función que registra una sola vez la cartera ya cargada, con fecha declarada. |
| `cartera-heredada-probar.sql` | Prueba de esa función dentro de una transacción que se deshace. |
| `politicas-lectura.sql` | Cambio de políticas de lectura. **No es aditivo**: va aparte. |
| `politicas-lectura-verificar.sql`, `politicas-lectura-revertir.sql` | Verificación de solo lectura y reversa. |

Qué es cada pieza, su impacto y la evidencia: `docs/entrega/noche-7/anexos/espejo-paquete-minimo.md`.

## Secuencia que se ensayó

```
equitas_espejo.py start
equitas_espejo.py verificar-esquema                       # coincide con la foto
equitas_espejo.py cargar chico
equitas_espejo.py sql paquete-minimo-verificar.sql --solo-lectura     # antes
equitas_espejo.py sql paquete-minimo.sql
equitas_espejo.py sql paquete-minimo-verificar.sql --solo-lectura     # después
equitas_espejo.py sql paquete-minimo.sql                  # otra vez: sin cambios
equitas_espejo.py sql cartera-heredada.sql
equitas_espejo.py sql cartera-heredada-probar.sql         # no deja nada
equitas_espejo.py probar-lectura                          # antes de las políticas
equitas_espejo.py sql politicas-lectura.sql
equitas_espejo.py probar-lectura                          # después
```

## Apuntar una aplicación local al espejo

`start` deja en `~/.equitas-n7-espejo/app.env` las dos variables públicas que la compilación necesita (`NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Compilar y arrancar la aplicación con ellas, en otro puerto.

- **Nivel base** (la base sin el paquete): arrancar **sin** `EQUITAS_REVIEW_SERVER_JWT` y **sin** `EQUITAS_IMPORT_API_URL`. La aplicación muestra la cartera y no escribe nada.
- **Con el paquete**: hace falta `EQUITAS_REVIEW_SERVER_JWT`, un JWT con `role = equitas_review_server` firmado con el secreto del espejo.

Mediciones: `docs/entrega/noche-7/anexos/rendimiento.md`.
