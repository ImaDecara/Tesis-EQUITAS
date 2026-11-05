# Privacidad de la selección de municipio y objeto en la DAL

Corrección de noche 5, vinculada a ALIGN-019 y al traspaso de ALIGN-052.
La revisión independiente del cambio actual sigue pendiente; la aprobación
histórica de ALIGN-019 no la reemplaza.

## Problema y decisión

La forma numérica de `equitas_tenant_id` no demuestra que sea un ID autorizado.
Antes, el filtro `tenant=eq.<cookie>` se enviaba a PostgREST antes de verificar
la membresía y Kong conservaba ese valor en la URL. El rechazo de acceso
posterior no evitaba esa retención. Es un defecto de privacidad, aunque no se
haya observado acceso a otro municipio.

La sonda local previa reprodujo la misma retención con el `debtorId` numérico
del formulario de decisiones: la acción rechazó el objeto inexistente, pero
la consulta previa ya lo había enviado a Kong. Por eso se incluyó la corrección
acotada de `case-review-snapshot.ts` en esta unidad.

`front/lib/auth/tenant-access.ts` compara la selección en memoria contra las
membresías visibles del usuario de aplicación resuelto desde Auth. La consulta
usa solamente ese ID de servidor, conserva la sesión y RLS, y pagina por `id`
hasta una respuesta vacía. Leer una página corta no termina la búsqueda. Un
error, una clave de paginación inválida o una página posterior fallida deniega
la resolución completa. Se siguen comprobando estado del usuario, membresía,
municipio y nombre exacto del rol. Las membresías múltiples exigen selección;
una selección ajena o inexistente no autoriza. Las membresías inactivas visibles
se distinguen de una selección inexistente; RLS puede ocultarlas y entonces el
resultado es ausencia de membresía.

Los IDs de municipio y rol obtenidos de la membresía comprobada sí pueden usarse
en consultas siguientes. No se desactivan logs ni se modifica Kong, los permisos,
las políticas del producto o la compatibilidad E06 `tp_operator`: solo lectura
de cartera. No se agrega una clave administrativa al frontend.

Para recalcular una decisión se leen primero los objetos del municipio autorizado,
con paginación completa. El ID recibido se compara en memoria, se comprueba también
el municipio de la fila y recién después su ID canónico filtra las relaciones.
El mapeador recibe únicamente ese objeto. Un objeto inexistente o ajeno no llega
a las consultas de relaciones ni al registro de la decisión. Se conserva la
lectura del corte antes de las deudas/contactos y su revalidación en la función
de escritura, incluida la protección frente a importaciones concurrentes.

## Costo y límites

Con selección, cada validación lee todas las membresías visibles del usuario:
O(M) filas y memoria. El lector pide hasta 1000 por página, pero continúa hasta
una página vacía aunque el servidor reduzca el límite. El número de solicitudes
depende de ese límite. Sin selección se mantiene el conteo exacto de activas y
la lectura paginada de opciones cuando hay varias. No se agregó caché entre
solicitudes ni se midió capacidad o latencia municipal.

La resolución del objeto agrega O(N) filas y memoria por recálculo, donde N son
los objetos visibles del municipio. Las consultas posteriores conservan los
filtros por objeto verificado. No es una búsqueda indexada por el dato recibido;
para escalar habrá que medir este costo y diseñar otro transporte que evite
valores arbitrarios en URLs, sin perder la autorización.

Esta corrección limita lo que la aplicación introduce en las URLs salientes;
no borra logs previos ni impide que alguien consulte directamente la Data API.
Los identificadores canónicos, cursores e identidad validada pueden seguir
apareciendo en los logs. No equivale a anonimización de registros ni a una
auditoría de todos los parámetros del producto. Tampoco certifica proxies,
Vercel, otros despliegues o múltiples máquinas.
La selección de una revisión al aprobar (`caseReviewId`, en
`case-review-service.ts`) también enviaba el dato del formulario a la URL.
La sonda adicional del padre lo reprodujo sobre el commit `c3b6df8`: la acción
rechazó la revisión inexistente, pero el centinela apareció una vez en Kong.
Ahora se leen las revisiones del municipio autorizado con columnas explícitas
y paginación completa; se compara el ID en memoria y se verifica el municipio
de la fila antes de consultar cadenas o escribir. Las consultas siguientes usan
su ID canónico. Una página posterior fallida no permite aprobar desde un prefijo.
Este recorrido agrega O(R) filas y memoria, donde R son las revisiones visibles
del municipio. Conserva la revalidación del corte y las restricciones de escritura.

## Evidencia y repetición

La evidencia nueva vive fuera de git en el paquete del plan:
`execution/evidence/correccion-privacidad-noche-5/`. Contiene la prueba negativa
previa, control positivo de captura, resultados reales y aislados, hashes del
diff, comandos, límites y limpieza. Los logs crudos y las credenciales quedan
en temporales privados y se retiran; solo se conserva evidencia depurada.

`scripts/local.py` ejecuta la sonda contra el worktree indicado por su cwd:
compila una página temporal que importa las acciones existentes, la retira,
toma el lock local, reconstruye y siembra datos sintéticos, arranca su propio
Next, captura Kong/REST/Auth/Postgres/Next y finalmente detiene su servidor,
reconstruye la base y libera exclusivamente su lock. `probe.mjs` exige una
lectura real de membresías y cartera, además de un centinela de control que
debe aparecer en Kong. Una captura vacía o fallida no aprueba.

La entrega inicial sin commit quedó preservada sin cambios en `c3b6df8`.
Su campaña 022 original rechazó correctamente el árbol sucio. Los controles
posteriores deben usar el commit limpio correspondiente, sin alterar el validador.
El padre debe repetir la sonda y la campaña 022 sobre el SHA integrado; hasta
entonces, los resultados de esta rama no certifican la integración.
