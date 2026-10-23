# Ensayo manual de diagnóstico

El runner con espera explícita de `/people` llegó correctamente al listado y devolvió salida 1 por un selector ambiguo: la página contiene tabla de Top 5 y tabla operativa con la misma persona. Se acotó la aserción a la tabla que contiene la columna `Deuda total asociada`, verificando persona e importe.

Esta ejecución manual usa la aplicación desplegada `4906c9b` y el runner de trabajo posterior `348f446`; no es una ejecución del workflow ni un defecto funcional del producto. Conserva JSON/JUnit/captura y demuestra que el fallo del ensayo produce un resultado distinto de cero. El cierre requiere el nuevo workflow aprobado.
