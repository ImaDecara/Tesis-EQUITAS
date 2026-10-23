# Primer ensayo desplegado de E07

CI 39953038356 y smoke 39953222752 aprobados por el runner para `4906c9b`. La revisión visual detectó que `personas.png` todavía mostraba Objetos de deuda: el nombre A también existe en esa tabla y la aserción podía pasar antes de terminar la navegación.

Se conserva el resultado original sin modificar. **Este ensayo no se usa como prueba de navegación a personas ni como cierre de E07.** La corrección exige URL `/people` y título exacto antes de validar la fila y capturar. La ejecución posterior debe aprobar ese criterio. No se identificó un defecto de navegación del producto en este ensayo.
