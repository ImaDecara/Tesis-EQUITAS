# Guía breve de revisión de casos

Para quien revisa casos en EQUITAS. Ticket ALIGN-021. Detalle de diseño en [`wireframe-revision.md`](wireframe-revision.md).

## Encontrar un caso

1. Entra a **Casos prioritarios**. Cada cola es una intervención: Mejorar datos, Revisión jurídica, Contacto y plan, Recordatorio y Seguimiento.
2. Filtra si hace falta. El contador de cada cola respeta los filtros.
3. Dentro de una cola los casos se ordenan por su prioridad. **No compares la prioridad de colas distintas:** cada cola tiene su propia escala.
4. **Abrir revisión** lleva a la pestaña Revisión del objeto.

## Revisar

Lee en este orden, que es el de la pantalla:

1. **Hechos:** corte, importes, vencimientos, banderas y faltantes. "Vulnerabilidad: no informada" significa que el sistema no tiene ese dato; no significa que no exista.
2. **Sugerencia:** qué propone el sistema, por qué, con qué reglas y qué corte. Es una sugerencia heurística: no calcula probabilidades ni afirma que una deuda sea exigible.
3. **Tu decisión**, si tu rol es `operador`.
4. **Historial:** lo decidido antes, por quién (solo el rol) y con qué datos.

Si la ficha avisa que su recomendación difiere de la sugerencia, vale la de la pestaña Revisión: usa el corte publicado, y las demás pestañas pueden usar otra fecha.

## Decidir

| Decisión | Cuándo | Qué pide |
|---|---|---|
| Aceptar | La sugerencia es correcta | Nada más |
| Modificar | Corresponde otra acción | Acción y motivo |
| Rechazar | No corresponde actuar como se sugiere | Motivo |
| Posponer | Falta algo para decidir | Motivo |
| Derivar | Lo tiene que ver otra área | Motivo; la acción es opcional |

- **No incluyas datos personales ni información del hogar** en el detalle del motivo. Admite hasta 500 caracteres, contando los espacios.
- La lista de motivos es **provisional**: todavía no tiene aprobación del municipio.
- Un error no se edita. Una decisión nueva reemplaza a la anterior, y las dos quedan en el historial.

## Intensidad 3 o 4

La intimación administrativa y la derivación a procuración o vía judicial son **propuestas**: no se ejecutan hasta que otra persona con rol de supervisor las apruebe. "Requiere aprobación de un supervisor" significa exactamente eso: todavía no está aprobada.

Para registrar la propuesta hace falta el motivo y la lista de control completa:

- situación del hogar consultada, o "no disponible";
- estado jurídico y posible prescripción verificados por quien corresponde;
- canal válido;
- alternativa asistida ofrecida.

La lista solo admite casillas y códigos.

## Si eres supervisor

La respuesta aparece en la decisión vigente de intensidad 3 o 4.

- **Aprobar** exige la lista de control completa y que los datos sigan siendo los de la propuesta.
- **Objetar** exige un motivo y sigue disponible aunque haya una carga en curso.
- Quien propuso no puede aprobar su propia propuesta.

## Avisos que puedes ver

| Aviso | Qué hacer |
|---|---|
| Los datos o las reglas cambiaron | Revisa la sugerencia vigente y vuelve a elegir tu decisión. Nada quedó confirmado |
| No hay un corte publicado y vigente | Hay una carga en curso. No es un error tuyo: vuelve cuando termine |
| Ya hay otra decisión registrada | Recarga el caso y mira la nueva antes de continuar |
| La aplicación se actualizó o falló la conexión | Recarga la página. Si ya había quedado guardado, no se duplica |

## Qué no hace esta pantalla

No envía mensajes, no gestiona planes de pago y no edita decisiones. Registrar una decisión no ejecuta la acción.
