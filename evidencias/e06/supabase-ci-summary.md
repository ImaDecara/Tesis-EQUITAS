# E06 - Integracion real Supabase

Proyecto: `iylwghgvtydpmwidojdo`.
SHA: `4bb783f1a34c25e9003ee6ece66825668b1c1106`. Fixtures: `e06-v1`.

Resultado: **aprobado**; {'passed': 12, 'failed': 0, 'skipped': 0}.

| Caso/variante | Resultado |
| --- | --- |
| SUP-AUTH-01: contexto productivo esperado del usuario a | passed |
| SUP-AUTH-01: contexto productivo esperado del usuario b | passed |
| SUP-AUTH-02: password incorrecto no crea sesion ni permite leer negocio | passed |
| SUP-DATA-02: filas, montos y riesgos conocidos de a mediante lector productivo | passed |
| SUP-DATA-02: filas, montos y riesgos conocidos de b mediante lector productivo | passed |
| SUP-RLS-01: anonimo recibe cero filas de todas las tablas | passed |
| SUP-RLS-02: identidad normal sin membresia recibe cero filas de negocio | passed |
| SUP-RLS-03: usuario a no puede consultar IDs del tenant b | passed |
| SUP-RLS-04: usuario b no puede consultar IDs del tenant a | passed |
| SUP-RLS-05: membresia inactiva permite diagnostico propio y niega negocio | passed |
| SUP-AUTH-03: logout elimina sesion del cliente y la siguiente lectura queda anonima | passed |
| SUP-WRITE-01: cliente normal no puede insertar, actualizar ni borrar negocio | passed |


El proyecto original no fue modificado. Logout prueba el cliente tras salir, no revocacion instantanea de JWT copiados.
