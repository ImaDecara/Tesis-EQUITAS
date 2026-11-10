# EQUITAS — requisitos pendientes para la base original y una aplicación publicada

Esta noche se cerró el recorrido en local y se **ensayó** la compatibilidad con la base original en un espejo local. No se leyó ni se escribió ninguna base remota, y no se publicó nada. Este documento dice qué falta, en qué orden conviene decidirlo y qué necesita cada paso.

## 1. Cuatro estados que no hay que confundir

| Estado | Dónde está hoy |
|---|---|
| 1. Recorrido funcional en local | **Cerrado.** Entrar, cargar un CSV, ver los datos, buscar, entender la prioridad, registrar una decisión y obtener un reporte funciona de punta a punta en el entorno local, con datos sintéticos. |
| 2. Compatibilidad ensayada localmente | **Avanzado.** Sobre un espejo local de la base original: la aplicación funciona sin ningún cambio de base (nivel base, sin escribir) y, con una propuesta mínima de base, registra decisiones y entrega reportes. |
| 3. Validación remota | **Pendiente.** Nada se comprobó contra la base original ni contra la de testing. |
| 4. Publicación autorizada y comprobada | **Pendiente.** No fue trabajo de esta noche. |

Un espejo no es producción. La lista de qué reproduce con evidencia y qué asume está en [anexos/espejo-comprobado-foto-desconocido.md](anexos/espejo-comprobado-foto-desconocido.md).

## 2. Lo que la aplicación hace hoy sobre una base como la original, sin tocarla

Se llama **nivel base** y se probó en el espejo, en navegador real, con cuentas ADMIN y USER:

- Funcionan el ingreso, el tablero, los listados, la búsqueda, los grupos de trabajo, el puntaje, la recomendación automática y la ficha del caso.
- **La aplicación no escribe nada**: los contadores de escritura de la base quedaron idénticos antes y después del recorrido.
- Como esa base no registra una fecha de corte, los cálculos usan la fecha del día y la línea de arriba lo dice: «Sin fecha de cartera registrada: se calcula con la fecha de hoy».
- Cargar CSV, la pestaña Decisión, Pendientes y Reportes dicen «no disponible en esta base», con la explicación. No aparecen como errores.
- El nivel se deduce de lo que la base tiene (faltan las cuatro tablas del módulo), en el servidor y en cada pedido. No hay ninguna bandera de configuración.

Consecuencia: **publicar esta candidata sobre la base original, sin ningún cambio de base, dejaría la consulta de la cartera funcionando y todo lo nuevo apagado y explicado.** No se probó contra la base real; es lo que muestra el espejo.

Dos cosas del nivel base que conviene saber:

- La apertura de un caso no deja registro, porque no existe dónde guardarlo. Es lo mismo que pasa hoy con `main`.
- Sin fecha de corte, el atraso de cada obligación crece con el calendario: los puntajes cambian de un día para otro sin que cambien los datos.

## 3. Para registrar decisiones y obtener reportes: una propuesta mínima de base

Detalle, impacto por objeto y evidencia: [anexos/espejo-paquete-minimo.md](anexos/espejo-paquete-minimo.md). Son tres piezas separadas.

| Pieza | Finalidad | Impacto | Cómo se comprueba |
|---|---|---|---|
| **Paquete mínimo** (`database/espejo/paquete-minimo.sql`) | Dónde guardar decisiones, aprobaciones y el registro de accesos, y las funciones que los escriben. | Cuatro tablas nuevas y vacías, nueve funciones, un tipo y dos roles sin inicio de sesión. **Un solo cambio sobre una tabla existente**: una restricción única en `debtor(tenant, id)`. Se puede repetir sin cambios y tiene reversa completa. | `paquete-minimo-verificar.sql`, de solo lectura, antes y después. En el espejo: mismas 146 columnas y 23 políticas en las tablas existentes; restricciones de 71 a 72. |
| **Registro de la cartera ya cargada** (`database/espejo/cartera-heredada.sql`) | Que cada decisión quede atada a una cartera con fecha. | Una fila en una tabla nueva, una sola vez por municipio. La huella y los conteos los calcula la base sobre el contenido real; **la fecha la declara una persona responsable** y se muestra como declarada. | `cartera-heredada-probar.sql`: todos los rechazos y el caso válido, dentro de una transacción que se deshace. |
| **Políticas de lectura** (`database/espejo/politicas-lectura.sql`) | Que cada cuenta lea solo su municipio también por la Data API. | **No es aditivo**: una cuenta sin membresía activa deja de leer. Puede diferirse. | `equitas_espejo.py probar-lectura`, por la Data API con la sesión de cada cuenta, antes y después. |

Además del script, para que la aplicación use el paquete hace falta **emitir la credencial de servidor** (`equitas_review_server`) en ese proyecto y configurarla en la aplicación publicada. Cómo se firma allá no se sabe todavía.

## 4. Para cargar CSV en una aplicación publicada: es otro proyecto

Detalle completo: [anexos/carga-desplegada-requisitos.md](anexos/carga-desplegada-requisitos.md). En resumen, la carga necesita:

- Un lugar donde corra el servicio de importación (hoy solo corre en la misma máquina que la aplicación) y una red definida entre ambos.
- Resolver los límites de tamaño del entorno publicado, que son mucho menores que los 25 MB por archivo de hoy.
- Una credencial de importación, que puede reemplazar una cartera entera.
- **Cambios sobre tablas que hoy tienen datos**: identidades en 14 tablas, una columna de `debt` que se borra y se recrea, columnas que dejan de ser obligatorias y disparadores sobre 10 tablas de la cartera.
- Decidir qué pasa con la cartera ya cargada: cada carga representa la cartera completa y reconoce los objetos por sus claves.
- Una decisión explícita para habilitar producción como destino: el cargador hoy lo rechaza a propósito, y esa guarda no se tocó.

## 5. Lo que hay que averiguar antes de cualquier paso remoto

Todo en solo lectura. Con una sola consulta en el editor SQL del proyecto original alcanza para casi todo (`PlanToFinish/…/evidence/revision-fable-ux/consulta-forma-de-produccion.sql` ya cubre los estados):

1. **El catálogo de estados y cuántas obligaciones tiene cada uno.** Sin esto no se sabe si la exclusión de pagadas cambia algún total real, ni si existe un estado de suspensión.
2. **Si las políticas de lectura siguen abiertas** y si Auth permite registrarse. Con las dos cosas, cualquier cuenta que se registre leería toda la cartera por la Data API.
3. **Cuántas cuentas y membresías hay**, por rol y estado (sin nombres).
4. Si los `id` tienen identidad y si `debt.updated_amount` es una columna generada.
5. La versión de Postgres y cómo firma las credenciales el proyecto.

## 6. Decisiones que necesitan una persona

| Decisión | Por qué no la puede tomar el sistema |
|---|---|
| Publicar o no la candidata en nivel base. | Cambia lo que ven las personas que hoy usan `main`. |
| Aplicar o no el paquete mínimo, y cuándo. | Es un cambio sobre la base original. |
| Qué fecha declarar para la cartera ya cargada. | Solo quien cargó esos datos sabe a qué día corresponden; no se puede corregir después. |
| Cambiar o no las políticas de lectura. | Deja sin lectura a las cuentas sin membresía activa. |
| Cómo se computa cada estado de obligación. | Es una definición del municipio. |
| Si una cuenta USER puede ver las decisiones registradas. | El encargo no lo define; hoy puede verlas, sin el texto libre. |
| Emprender o no la carga en producción. | Es un proyecto aparte, con cambios sobre tablas con datos. |

## 7. Rendimiento

Medido en el espejo a escala (2.900 objetos, 55.684 obligaciones): [anexos/rendimiento.md](anexos/rendimiento.md). Cada listado hace unas 95 consultas a la base, 57 de ellas una detrás de otra. En local tarda cerca de un segundo; en una aplicación publicada hay que medirlo. La ficha de un caso pasó de 98 consultas a 33. No se agregó ninguna caché; la propuesta, con sus condiciones, está en el anexo.
