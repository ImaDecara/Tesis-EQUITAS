# WhatsApp: guía para completar el proveedor

Para quien vaya a conectar un proveedor de WhatsApp. Hoy **no hay proveedor ni punto de envío**: la aplicación arma un borrador en el navegador y la persona lo copia. Nada sale de EQUITAS.

## Qué existe

- **Botón «Preparar mensaje»** en la ficha del caso (`front/components/case/whatsapp-draft-panel.tsx`). Abre un panel con:
  - el caso y la acción de la que sale el mensaje (decisión registrada o, si no hay, recomendación automática, rotulada como tal);
  - la elección explícita de persona y de teléfono cuando hay más de uno (con una sola opción se elige sola);
  - el texto editable, que parte de la plantilla de las reglas activas (`mensaje_borrador.plantilla_id`, `contracts/decision-rules.v1.1.json` → `mensajes_borrador.plantillas`);
  - la lista de impedimentos, cada uno con su explicación, y el botón «Copiar borrador», deshabilitado mientras haya alguno;
  - el estado fijo «Integración de WhatsApp pendiente» y tres aclaraciones: un teléfono cargado no acredita WhatsApp activo, verificación ni consentimiento; el borrador no se guarda ni sale por la red ni registra decisión o aprobación; EQUITAS no envía el mensaje.
- **Lógica pura** con pruebas (`front/lib/whatsapp/draft.ts`, `front/tests/unit/whatsapp-draft.test.ts`): elección de la plantilla, completado de marcadores, detección de teléfonos, impedimentos del caso, de la elección y del texto.
- **Contrato tipado** (`front/lib/whatsapp/contract.ts`): `WhatsAppSubmission` (entrada), `WhatsAppSubmissionResult` y `WhatsAppErrorCode` (resultado y errores), `WhatsAppProvider` (punto de extensión), `PENDING_PROVIDER` (lo que hay hoy: rechaza todo con `PROVIDER_NOT_CONFIGURED`) y `SERVER_CHECKS` (lo que el servidor tiene que repetir).

## Qué falta

1. Elegir proveedor y revisar **sus políticas sobre cobro de deudas** antes de escribir código. La posibilidad de intimaciones automáticas se evalúa por separado: este canal no prepara intimaciones ni derivaciones (intensidad 3 o 4), aprobadas o no.
2. Un **permiso explícito** para comunicar. Hoy no existe: ni ADMIN ni USER lo tienen por su rol. Definirlo con el municipio.
3. **Registro de consentimiento y verificación** del número. Hoy la base no tiene ninguno de los dos; sin ellos el servidor responde `CONSENT_NOT_RECORDED` o `CONTACT_NOT_VERIFIED`.
4. **Plantillas aprobadas**: las de las reglas están marcadas «borrador sujeto a validación jurídica» y además el proveedor las tiene que aprobar.
5. Una **ruta de servidor** que reciba `WhatsAppSubmission`, haga los controles y llame a `WhatsAppProvider.submit`. No existe y no hay que inventarla en la pantalla: el panel solo copia.
6. **Registro de accesos**: cada pedido deja rastro con `recordAccessAudit` (la acción `CHANNEL_LINK` u otra nueva), con la misma regla de la aplicación: sin registro, no se entrega.
7. **Idempotencia** guardada en la base: la misma `idempotencyKey` devuelve el mismo resultado y nunca un segundo mensaje.

## Qué tiene que validar el servidor (aunque la pantalla ya lo haya hecho)

La lista vive en `SERVER_CHECKS`. En resumen:

- **Autorización:** sesión válida; municipio y persona usuaria salen de la sesión, nunca del pedido. Rol con el permiso de comunicar. La base tiene el módulo de decisiones.
- **Pertenencia:** el caso es del municipio; la persona está vinculada al caso; el contacto es suyo, activo y telefónico.
- **Vigencia:** hay una decisión registrada vigente (no «sobre datos anteriores», no rechazada, pospuesta ni derivada). Fecha de la cartera, versión de reglas y decisión coinciden con las de `basis`; si no, `BASIS_OUTDATED`.
- **Aprobación:** lo que requiere aprobación de otra persona no sale por este canal.
- **Texto:** la plantilla es la que las reglas asignan a la acción decidida; el texto pasa `validateDraftText` (no vacío, hasta 1.024 caracteres, sin marcadores pendientes, sin los términos de `prohibido_en_texto`, sin enlaces).
- **Idempotencia:** clave no usada, o el mismo resultado de la vez anterior.

## Qué no hacer

- No mostrar «enviado», «entregado» ni «intimado». `ACCEPTED` significa que el proveedor recibió el pedido, no que llegó.
- No abrir `wa.me` ni presentar el canal como un bot o una persona.
- No mandar el borrador a ningún servicio desde el navegador ni guardarlo en la base sin la ruta de servidor de arriba.
- No usar la analítica (clusters ni el experimento supervisado) para decidir a quién escribir: no autorizan comunicaciones ni reemplazan la revisión humana.
- No preparar mecanismos para eludir las restricciones del proveedor sobre cobro de deudas.
- No tomar la recomendación automática como si fuera una decisión: el servidor exige decisión registrada (`DECISION_REQUIRED`). En una base sin el módulo de decisiones (nivel BASE) el panel arma el borrador desde la recomendación, lo dice, y no registra nada.
