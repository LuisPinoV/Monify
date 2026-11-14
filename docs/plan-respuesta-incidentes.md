# Plan de respuesta a incidentes

La severidad se conserva en texto (`alta`, `media`) y se mapea a Gravedad 1-4 para el plan operativo.

| Alerta | Regla | Gravedad | Respuesta automática | Responsable |
| --- | --- | ---: | --- | --- |
| A1 | Fuerza bruta en el login | 3 | Bloqueo temporal de cuenta o dispositivo | Auditor y sistema |
| A2 | Mas de 10 titulares distintos en 1 minuto | 2 | Revocación de sesiones y bloqueo inmediato de la cuenta | Sistema; Auditor revisa |
| A3 | Operación o acceso desde dispositivo nuevo | 3 | Exigir verificación adicional antes de continuar | Actor y Auditor |
| A4 | 5 o más accesos denegados en 10 minutos | 3 | Crear alerta para revisión | Auditor |

## Ciclo de una alerta

1. El sistema registra la alerta y la evidencia cifrada en `AlertaSeguridad` y `UserLogs`.
2. El Auditor la marca como `revisada`, registrando quién, cuándo y una nota.
3. El Auditor la marca como `cerrada` con la conclusión de la investigación.
4. La línea de tiempo exportada incluye al actor observado y al actor que ejecutó la contención cuando se proporcionan ambos identificadores.

La escala usa `1` como mayor gravedad y `4` como menor gravedad. La intención del actor no se infiere de los logs: debe determinarla la investigación del Auditor.
