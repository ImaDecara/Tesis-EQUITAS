# E03 — Aceptacion previa de lectura completa

**Fecha:** 21/10/2026. **Responsable:** Axel Azcune. Requisito **R-DAT-01**, defecto **DEF-DAT-001**. Entrada: E02, commit `00bc9971a6b1a5a396c0b1624eab74735d9089d2`.

Antes de corregir se exige que las entradas productivas de objetos y personas recuperen todas las filas visibles para la sesion, sin limite total fijo, con orden estable por PK `id`. Las nueve tablas de estas rutas tienen PK bigint no nula en el snapshot observado. Se preservan los nombres y contratos de sus resultados.

No se presupone que pedir 3.000 filas haga que el servidor entregue 3.000: se verifican limites efectivos de 1.000 y 3.000, y luego uno inferior al tamano solicitado. El transporte de prueba utiliza el SDK Supabase instalado y simula unicamente respuestas HTTP. Una prueba del propio transporte confirma los parametros de limite, orden y cursor.

| Caso | Entrada / particion | Resultado de aceptacion |
| --- | --- | --- |
| DAT-01 | Tabla vacia. | Cero filas, sin advertencia de error ni consultas infinitas. |
| DAT-02 | Menos de una pagina efectiva. | Todas las filas, sin duplicados. |
| DAT-03 | Exactamente una pagina efectiva. | Todas las filas y terminacion correcta. |
| DAT-04 | Mas de una pagina, ultima parcial. | Total completo y orden estable. |
| DAT-05 | Multiplo exacto del tamano efectivo. | Total completo, sin omisiones, duplicados o bucle. |
| DAT-06 | **3.507 filas**, IDs no consecutivos y orden fisico inverso, en ambas rutas. | **3.507 recuperadas, 0 omitidas y 0 duplicadas** con limites de servidor de 1.000 y 3.000. |
| DAT-07 | Error informado o de transporte en una pagina posterior. | Descartar las filas parciales de esa tabla y devolver una advertencia explicita; conservar las otras tablas independientes. |
| DAT-08 | Deudas, relaciones, contactos y detalles de riesgo distribuidos en paginas posteriores. | Mapeo y agregados coherentes con el conjunto sintetico completo en objetos y personas. |

La terminacion debe funcionar aunque el servidor entregue menos filas que el limite solicitado. Un cursor que no avanza o una respuesta invalida debe terminar con advertencia, sin producir un listado parcial aparentemente correcto. Las lecturas entre requests no son una transaccion de snapshot: el ensayo supone datos estables; una escritura concurrente puede requerir refrescar o un futuro mecanismo transaccional.

Se conserva el contrato `rows + warning` por tabla: un error devuelve cero filas para esa tabla y una alerta visible. No se ocultan filas parciales bajo un resultado exitoso. La integracion real y la autorizacion RLS se verifican en E06; estas pruebas no acceden a la cartera real.

El primer commit de pruebas conserva el codigo anterior para ejecutar DAT-06 en rojo en CI. Tras obtener URL y reportes fallidos se implementara la correccion y se ejecutaran esos mismos casos sin debilitar sus aserciones, junto con los limites, negativos y relaciones definidos aqui. Las mediciones `E03_DAT_06` guardan esperadas/recuperadas/omitidas/duplicadas para comparar antes y despues.

Fuentes consultadas: [range y orden](https://supabase.com/docs/reference/javascript/using-modifiers-range), [limit](https://supabase.com/docs/reference/javascript/using-modifiers-limit), [changelog](https://supabase.com/changelog). Se mantienen las versiones del SDK fijadas en E01.
