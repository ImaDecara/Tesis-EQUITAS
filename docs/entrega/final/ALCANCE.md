# EQUITAS — entrega final: alcance actualizado

Fecha: 11/11/2026. Rama de integración: `delivery/entrega-final`, creada desde `delivery/noche-7-entrega@a4a2a05`.

Este documento registra qué entra en la entrega y con qué permisos se trabajó. **No describe resultados.** Los resultados están en los demás documentos de esta carpeta, y cada uno dice sobre qué commit y en qué entorno se comprobó lo que afirma.

## Qué entra

1. Consulta de la cartera de la base original desde la aplicación publicada, con sesión, membresía activa y alcance municipal resueltos en el servidor.
2. Interfaz: lo útil de `main` recuperado sobre la versión de la noche 7, sin cifras inventadas ni afirmaciones sin respaldo.
3. Clustering descriptivo de la cartera, con resultados visibles en la aplicación.
4. Un experimento supervisado con datos sintéticos, con resultados visibles y rotulado como «Experimento con datos sintéticos; no predice pagos reales de La Falda».
5. Preparación de WhatsApp en la ficha del caso: borrador, validaciones y contrato para que otra persona complete el proveedor. No envía mensajes.
6. La carga de CSV desde el navegador, que sigue disponible solo en el entorno local autorizado.
7. Integración a `main`, publicación y verificación del despliegue.

## Qué se autorizó

Quien encargó esta entrega autorizó, el 10 y el 11/11/2026: cambios de código, pruebas y documentación; instalar y declarar scikit-learn de forma reproducible; leer la base original y procesar sus variables en la aplicación para el clustering descriptivo; experimentos supervisados con datos sintéticos; publicar resultados agregados, sin identificadores personales, con acceso autenticado sobre la infraestructura existente; merge y push a `main`, CI y despliegue; verificación posterior y reversión si aparece una regresión grave. El inicio de sesión normal está permitido; no autoriza escrituras sobre la cartera.

## Qué no se autorizó

- Cambiar datos, tablas, funciones, roles, membresías, políticas o configuración del Supabase remoto.
- Migraciones, seeds, resets, cargas o llamadas remotas que escriban.
- Enviar mensajes reales.
- Transferir datos municipales a proveedores externos de entrenamiento o de IA.
- Publicar datos personales, secretos o artefactos identificables.
- Servicios pagos.
- Que la analítica modifique decisiones operativas.
- Saltear protecciones de ramas, controles de seguridad o comprobaciones obligatorias.

La base de producción tiene que quedar intacta.

## Analítica: qué es y qué no es

`docs/tesis/protocolo-analitica-v1.md` sigue siendo un **borrador pendiente de aprobación**. Esta entrega no lo aprueba, no lo modifica y no lo ejecuta completo. Lo único que se implementa es lo de los puntos 3 y 4 de arriba; cualquier otro experimento que figure en ese protocolo no se hizo.

- El clustering lo calcula la aplicación en el servidor, al abrir la pantalla de analítica, con la sesión y el municipio de quien consulta. No se guarda en la base ni en el repositorio. scikit-learn es la implementación de referencia contra la que se valida el cálculo, sobre una tabla sintética versionada.
- El experimento supervisado se corre fuera de la aplicación, con Python y scikit-learn, sobre datos generados. Al repositorio solo va un archivo de métricas. El modelo no se aplica a contribuyentes reales.
- Ninguno de los dos cambia prioridades, grupos de trabajo, intensidades, aprobaciones ni mensajes.

El repositorio es público: por eso ningún dato, agregado ni parámetro derivado de la cartera real se versiona.

## Cambio del 11/11: publicación sin comprobación con sesión

No hubo una sesión disponible contra la base original durante esta entrega. Quien la encargó decidió publicar en `main` igualmente y que el administrador conecte y compruebe después. En consecuencia, estos cuatro estados se informan por separado y ninguno se presenta como otro:

| Estado | Qué significa |
|---|---|
| Funciona en local | Probado en el entorno local con datos sintéticos. |
| Compatibilidad ensayada en local | Probado contra una base local armada como la original. No es la original. |
| Validación remota pendiente | Lo que solo se puede comprobar con una cuenta real: datos visibles, permisos con sesión, correspondencia de la cartera con La Falda, cantidades, tiempos y el clustering sobre la cartera real. |
| Publicado y verificado | Lo que se observó en la URL pública después del despliegue. |

## Qué queda fuera

Más experimentos de ML, administración de usuarios, multitenencia nueva, otros canales de contacto, el proveedor de WhatsApp y el envío real de mensajes.
