# Wireframe de la revisión humana y de las colas por intervención

| Campo | Valor |
|---|---|
| Ticket | ALIGN-021, plan `2026-10-28-v2` |
| Pantallas | Pestaña "Revisión" de `/debtors/[debtorId]` y `/priority-cases` |
| Decisión que mejora | Revisar un caso con hechos primero, sugerencia después, y dejar decisión y motivo |
| Límite | Un formulario no garantiza supervisión efectiva `[P0219]`; lo acota ALIGN-038 |

## 1. Orden de la pestaña "Revisión"

El orden es la decisión de diseño: quien revisa lee los hechos antes de ver qué sugiere el sistema, para reducir el sesgo de automatización `[P0219]`–`[P0220]`.

```text
Ficha del objeto (encabezado y tarjetas existentes)
[Resumen] [Personas] [Contactos] [Deudas] [Perfil] [Recomendación] [Revisión]
┌ 1. Hechos del caso ───────────────────────────────────────────────┐
│ Corte 30/10/2026 · Vulnerabilidad: no informada                    │
│ Monto actualizado · Obligaciones vencidas al corte · Atraso máximo │
│ Banderas · Faltantes · Tabla: monto, vencimiento, estado           │
└────────────────────────────────────────────────────────────────────┘
┌ 2. Sugerencia del sistema ────────────────────────────────────────┐
│ Contacto y plan · Intensidad 2 · Reglas v1.0.0 · Corte 30/10/2026  │
│ Por qué: frase contrastiva. Severidad y factores en puntos         │
└────────────────────────────────────────────────────────────────────┘
┌ 3. Tu decisión (solo operador) ───────────────────────────────────┐
│ ( ) Aceptar ( ) Modificar ( ) Rechazar ( ) Posponer ( ) Derivar    │
│ Acción propuesta [lista]      solo Modificar y Derivar             │
│ Motivo [lista cerrada]        al discrepar y siempre con ≥3        │
│ Detalle opcional [texto]      advertencia y contador de 500        │
│ Lista de control              solo con intensidad ≥3               │
│ [Registrar decisión] o [Registrar propuesta]                       │
└────────────────────────────────────────────────────────────────────┘
┌ 4. Historial ─────────────────────────────────────────────────────┐
│ Vigente · Requiere aprobación de un supervisor                     │
│ Fecha, rol, decisión, acción, motivo, corte y versión              │
│ [Responder como supervisor] solo supervisor, sobre la vigente      │
└────────────────────────────────────────────────────────────────────┘
```

## 2. Qué ve cada rol

| Rol | Hechos y sugerencia | Formulario de decisión | Historial | Texto libre del motivo | Responder como supervisor |
|---|---|---|---|---|---|
| `operador` | Sí | Sí | Sí | Sí | No |
| `supervisor` | Sí | No | Sí | Sí | Sí |
| `consulta` | Sí | No | Sí | No | No |
| `tp_operator` (compatibilidad E06) | No: aviso de rol | No | No | No | No |
| `importador` | La ficha no abre: el rol no lee cartera | No | No | No | No |

La pantalla no decide permisos: los deriva de la misma tabla de la DAL y la acción de servidor los vuelve a comprobar en cada llamada.

## 3. Reglas del formulario

| Decisión | Acción propuesta | Motivo | Lista de control |
|---|---|---|---|
| Aceptar | No se muestra: copia la sugerencia | No se muestra | No |
| Modificar | Obligatoria, distinta de la sugerida | Obligatorio | Obligatoria con intensidad ≥3 |
| Rechazar | No se muestra | Obligatorio | No |
| Posponer | No se muestra | Obligatorio | No |
| Derivar | Opcional | Obligatorio | Obligatoria con intensidad ≥3 |

- **No se envía nada que no esté a la vista.** Si la persona cambia de decisión, lo que quedó oculto no viaja.
- **Intervención e intensidad son un solo control.** Así no se puede armar un par sin sentido, como una intimación de intensidad 1.
- **Con intensidad ≥3 el envío no sale del navegador sin la lista completa.** La acción y la base lo vuelven a exigir.
- **El detalle se guarda tal como se escribió.** El contador incluye espacios y cuenta caracteres, no unidades internas. Si queda vacío se envía `null`.

## 4. Estados y mensajes

| Situación | Qué se muestra | Formulario |
|---|---|---|
| `CUTOFF_NOT_AVAILABLE` al abrir | Aviso neutro: no hay corte publicado, revisar cuando termine la carga | No se ofrece |
| `CUTOFF_NOT_AVAILABLE` al confirmar | El mismo aviso, sin marcar campos: no es un error del usuario | Conserva lo escrito |
| `SUGGESTION_UNAVAILABLE` | Mensaje del contrato | No se ofrece |
| `SUGGESTION_OUTDATED` | Qué cambió y la sugerencia vigente completa | Borra la decisión elegida: hay que volver a elegirla. Nunca se confirma en silencio. También cubre `changed = ['CORTE']` |
| `REVIEW_CONFLICT`, `APPROVAL_CONFLICT` | Otra decisión entró primero, con botón para recargar el caso | Al recargar borra la decisión elegida: hay que mirar la nueva y volver a elegir |
| `created: false` | Éxito: "ya estaba registrada" | Se limpia |
| Falla de red o "Failed to find Server Action" | Aviso con botón de recarga completa | Conserva lo escrito |
| Código de rechazo con mensaje | `message` de la acción, sin valores | Marca el campo si el código corresponde a uno |

`pending_supervisor` se lee como "Requiere aprobación de un supervisor": falta una aprobación, no es una acción aprobada.

## 5. Respuesta del supervisor

- Se ofrece sobre la decisión vigente con intensidad ≥3. Una decisión reemplazada no se responde.
- **Objetar** sigue disponible con una carga en curso. **Aprobar** no: exige corte vigente y los mismos datos de la propuesta.
- Si los datos cambiaron desde la propuesta, el historial lo avisa y aprobar devuelve `SUGGESTION_OUTDATED`. Lo que queda es objetar, o que el operador registre una nueva.

## 6. Accesibilidad

| Control | Cómo se nombra y cómo informa errores |
|---|---|
| Decisión y situación del hogar | `fieldset` con `legend` y `role="radiogroup"`; flechas para moverse; error en `aria-describedby` |
| Listas y texto | `label` asociado; `aria-invalid` y `aria-describedby` con error y ayuda |
| Casillas | `label` envolvente; `aria-invalid` y error asociado |
| Resumen de errores | `role="alert"`, recibe el foco, con enlaces a cada campo |
| Resultado | `role="status"`, recibe el foco |
| Pestañas | `role="tablist"`, flechas, Inicio y Fin; solo la pestaña activa está en el orden de tabulación |

- Sin validación nativa (`noValidate`): los mensajes son los del contrato y se leen igual en todos los navegadores.
- El formulario usa `method="post"`: si se envía antes de hidratar, ningún motivo termina en la URL.
- Anchos verificados: 360, 768 y 1440 px, con comprobación automática de que las cajas no se superponen.

## 7. Colas de `/priority-cases`

```text
Casos prioritarios                                         [n casos]
Filtros operativos: buscar, riesgo, contacto, tipo, monto  [Aplicar] [Limpiar]
Colas: [Mejorar datos n] [Revisión jurídica n] [Contacto y plan n] [Recordatorio n] [Seguimiento n] [No disponible n]
Cola: Contacto y plan
Objeto | Tipo | Riesgo | Score / prioridad | Atraso | Deuda | Contacto | Recomendación | [Abrir revisión]
```

- Una cola es la intervención sugerida. Dentro de cada una se ordena por su prioridad; **entre colas no se compara**, por eso ya no hay un ranking único.
- Los filtros, la página y la cola viajan juntos en la URL. El contador de cada cola respeta los filtros. Elegir otra cola vuelve a la primera página.
- Sin `queue`, se abre la primera cola con casos. Un valor desconocido se trata igual.
- Si la pertenencia es desconocida porque falló una lectura, los contadores dicen "No disponible", nunca 0, y los objetos siguen visibles en el grupo "No disponible".
- La cola sale de la decisión calculada para las listas, con la fecha de cálculo si no hay corte integrado (ALIGN-010). La sugerencia a revisar es la del corte publicado y puede diferir: la pestaña lo avisa.

## 8. Lo que no resuelve

- **Catálogos sin aprobar.** No hay contrato aprobado de `reason_code` ni de códigos de intervención de intensidad 3 y 4. El formulario ofrece una lista cerrada **provisional**, y lo dice en pantalla. El servidor sigue validando solo el formato. Los nombres de las acciones 3 y 4 sí vienen de ALIGN-003; sus códigos son técnicos. Cuando exista el contrato, hay que llevarlo también al control de servidor.
- **Sin bandeja de pendientes.** El supervisor ve "pendiente" dentro de cada caso; no hay una lista de todos los pendientes del municipio.
- **Las colas no muestran la decisión vigente.** Un caso ya decidido sigue en su cola: esta pantalla no cruza las revisiones de toda la cartera.
- **Excluido por el ticket:** envío de mensajes, gestión de planes de pago y edición de decisiones. Una corrección es una decisión nueva que reemplaza a la anterior.
