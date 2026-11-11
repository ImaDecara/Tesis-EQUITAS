# Recorrido de prueba y manifiesto — demo local V1

Con la demo en marcha (`start`) y las contraseñas de `~/.equitas-demo/cuentas.txt`. Duración: 30–60 min.

## Cartera demo (manifiesto)

Archivo: [`database/demo/cartera-demo-v1/manifiesto-demo.json`](../../../database/demo/cartera-demo-v1/manifiesto-demo.json),
generado por [`scripts/demo/cartera_demo.py`](../../../scripts/demo/cartera_demo.py) sin azar (cada importe y
fecha está escrito en el generador) y comprobado byte a byte por `back/tests/test_demo_local.py`.

| Dato | Valor |
|---|---|
| Versión | `cartera-demo-v1` |
| Corte | 2026-09-30 |
| Perfil de mapeo | `contracts/source-mapping.sintetico-v1.json` (formato TSV sintético) |
| Hash del dataset | `2a69af35af21417f2bc8d2320c10da83cd4e2393ed3ee0264989cbb5c28f48ee` |
| Objetos / obligaciones / personas | 15 / 29 / 15 (16 relaciones objeto–persona) |
| Importe total actualizado | ARS 11.665.250,00 (pendiente 11.570.100; pagada 48.000; suspendida 47.150) |
| Por tipo | 6 rodados, 6 conexiones de agua, 3 inmuebles |
| Sin contacto utilizable | `DEMO6-3-60004` (sin datos) y `DEMO6-6-60005` (marcadores `0`, `-`, `NO POSEE`) |
| Con obligación pendiente vencida al corte | 14 objetos; `DEMO6-3-60011` vence después del corte |
| Validación esperada | VALIDADO, 15 aceptados, 0 en cuarentena |

Casos con faltantes o rarezas a propósito: dos titulares 50/50 (`DEMO6-1-60006`), una persona con dos
objetos (`60007`/`60008`), atraso de más de cinco años (`60009`), estados de origen pagada y suspendida
(`60012`), persona jurídica (`60013`), sin estado, porcentaje, intereses ni domicilio (`60014`) y objeto
inactivo en origen (`60015`).

Observado en esta versión con las reglas v1.0.0 (lo calcula la app, no el manifiesto): colas «Mejorar datos» 2,
«Revisión jurídica» 1, «Contacto y plan» 4, «Recordatorio» 5 y «Seguimiento» 3.

## Recorrido manual

1. **Consulta** (`consulta`): ingresar → tablero. Comprobar «Corte del manifiesto: 2026-09-30», Deuda total
   **$ 11.665.250**, 14 casos vencidos, 2 sin contacto y «15 de 15 objetos con dato». El panel «Reportes CSV»
   ofrece 3 reportes (cola, calidad de datos, decisiones). En «Objetos de deuda», filtro Contacto = Faltante:
   aparecen exactamente `DEMO6-3-60004` y `DEMO6-6-60005`. En «Casos prioritarios», elegir una cola y abrir
   una ficha. En `DEMO6-3-60014` → «Personas asociadas» el porcentaje dice «No informado» (no se inventa 100).
2. **Operador** (`operador`): abrir una ficha → pestaña «Revisión» → «Modificar la acción», elegir una acción
   de intensidad 3. Sin motivo y sin lista de control, la app no registra nada. Con motivo y lista, muestra
   «Requiere aprobación de un supervisor». Recargar: la propuesta sigue ahí. El operador no puede aprobar.
3. **Supervisor** (`supervisor`): misma ficha → aprobar. Sin lista de control no registra; con lista muestra
   «Aprobada por un supervisor». Recargar: sigue aprobada. El supervisor no puede registrar propuestas.
4. **Reportes** (`supervisor`): el panel ofrece los 5 CSV. Cola: 15 filas de detalle y total ARS 11.665.250
   con corte 2026-09-30; decisiones: la propuesta con aprobación `APRUEBA`; accesos: aperturas y descargas.
   En «Casos prioritarios» con un filtro (por ejemplo Contacto = Faltante) el botón descarga solo esa selección.
   Con `consulta`, `/api/reports/supervision` y `/api/reports/access` responden 403; con `importador`, los 5.
5. **Acceso**: «Cerrar sesión» y volver a una URL protegida → vuelve a `/login`. `ajeno` entra a un tablero
   vacío y no ve objetos `DEMO6-`; `sin-membresia` no obtiene cartera; `importador` ve «Datos no disponibles».
6. **Persistencia**: `stop --stack`, luego `start`. La cartera, la propuesta y la aprobación siguen.
   `init` repetido informa «ya publicada» y no cambia nada.

El recorrido automatizado de cierre dejó en `DEMO6-1-60003` una propuesta del operador (`MODIFICA`,
intensidad 3, motivo `DATOS_INCOMPLETOS`) aprobada por el supervisor: sirve para ver una decisión ya aprobada.
Para la prueba propia conviene elegir otro caso de «Contacto y plan», por ejemplo `DEMO6-1-60013` o
`DEMO6-1-60006`.

## Recorrido automatizado

Desde `front/`, con la demo en marcha (escribe solo una propuesta, una aprobación y registros de auditoría):

```sh
node tests/smoke/demo-local-walkthrough.mjs --mode recorrido --case <IDENTIFICADOR sin decisiones> --output <carpeta nueva>
# después de stop/start:
node tests/smoke/demo-local-walkthrough.mjs --mode persistencia --case <mismo> --expect <carpeta>/report.json --output <otra carpeta nueva>
```

Navegador Chromium real (Playwright 1.64.1), solicitudes limitadas a 127.0.0.1, sin respuestas simuladas.
El informe `report.json` no contiene contraseñas ni claves; las capturas nunca muestran la pantalla de ingreso.

Limitación conocida, preexistente en `efad967`: el rol `importador` (sin lectura de cartera) ve «Datos no
disponibles» y el navegador registra el error genérico de producción de React #441. El recorrido lo trata
aparte y falla ante cualquier otro error de consola.
