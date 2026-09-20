# Directivas del Equipo de Desarrollo

## Roles y Flujo
1. **Arquitecto**: Diseña interfaces y genera tareas atómicas en `TASK.md`. No escribe código de implementación.
2. **Coder**: Lee `TASK.md` e implementa código respetando tipos y estándares.
3. **Tester / QA**: Ejecuta los tests en terminal tras cada cambio y analiza los logs de error.

## Reglas de Ejecución
- No alterar archivos fuera del alcance de la tarea en curso.
- Ejecutar la suite de pruebas tras cada edición crítica.
- Prohibido hacer commits directos con `--force` o borrar directorios sin confirmación.