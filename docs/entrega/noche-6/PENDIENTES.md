# Limitaciones y pendientes — resumen al 2026-11-09

Procedencia: `execution/BACKLOG-UNICO.md` del paquete local `PlanToFinish/DeliveryPlan/2026-10-28-v2`
(fuera de Git), actualizado al cerrar la noche 6. **Ese archivo es el índice operativo**; este resumen es
una foto fechada para quien solo tiene el repositorio y no se edita como plan.

## Lo que esta entrega no es

- **No es la importación web completa.** La carga y el mapeo desde el navegador (055/056) están en ramas
  separadas sin aceptación conjunta; la confirmación y la actualización del tablero desde la web (057/058)
  no están implementadas. En la V1, la cartera cambia solo publicando con la ETL por terminal.
- **No es el MVP v2 ni la tesis.** Analítica experimental, canal con el deudor (chat), simulación, API
  municipal y capítulos/validaciones académicas siguen pendientes o esperando aprobaciones humanas.
- **No es operación real.** Datos sintéticos; sin custodia, retención aprobada ni datos autorizados. Las pruebas
  de aislamiento con un segundo municipio sintético no habilitan operar con varios municipios reales.
- **No está publicada.** Ver [VERCEL.md](VERCEL.md): faltan una base remota con el esquema, la credencial de
  servidor de ese proyecto, verificar el panel y un Preview probado.

## Limitaciones conocidas de la demo

| Tema | Detalle |
|---|---|
| Rol importador en la web | Sin lectura de cartera: las páginas de cartera muestran «Datos no disponibles» y React registra su error genérico #441. Preexistente en `efad967` (control negativo en N6); mejora de UX pendiente |
| Credencial de servidor | Vence (24 h por defecto); renovar con `renew` |
| ETL | Publica solo en el municipio 1 y solo en loopback (diseño del plan) |
| Plataformas | Probado en macOS con Docker Desktop; Linux y Windows sin probar |
| Red local | Supabase CLI publica sus puertos en todas las interfaces con claves locales conocidas |
| Reglas y costos | Versionados y sin validación municipal o académica (034/037) |
| Identificador externo de obligación | La ficha muestra «No informado» aunque el archivo trae `DEUD_id` (comportamiento existente, no evaluado en N6) |

## Pendientes del plan que siguen abiertos (resumen)

- Importación web: 055/056 (ramas conservadas), adaptador 054↔056, 057, 058, campaña de seguridad 059, candidata 044.
- Ampliaciones: 060 (API municipal), 061–065/070 (analítica experimental), 066/071 (canal).
- Validaciones humanas: 034 (costos), 039 (trazabilidad), 047 (diseño del canal), 048 (protocolo), 043/063 (dependencias).
- Operación restringida: 005/045 (Supabase original, DEF-SUP-001), 046 (lote real), 050 (operación y restauración).
- Tesis: 036–038, 040–042, 051.
- Decisiones del usuario: catálogo de motivos, retención de 24 meses, custodio de la compatibilidad `tp_operator`,
  fecha límite, y la integración a `main`/publicación de esta candidata.
