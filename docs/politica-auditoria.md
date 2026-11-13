# Politica de auditoria e incidentes de Monify

## Acceso a la bitacora

- El Auditor analiza `UserLogs` y `EvidenciaNoRepudio` en modo de solo lectura.
- El Admin solo puede consultar esos registros con una autorizacion vigente de un Auditor.
- No existe una operacion de eliminacion de logs en la API.
- Todo acceso a la bitacora queda registrado con actor, accion, resultado, fecha, canal, dispositivo, recurso y motivo cuando corresponde.

## Informacion excluida

Los registros no contienen contrasenas, tokens, codigos de autenticacion ni
claves criptograficas. La frase "no almacenar hashes" se interpreta como no
almacenar hashes de credenciales. Si se almacenan `hashPrevio`, `hashRegistro` y
huellas tecnicas para verificar integridad y no repudio.

## Retencion

| Tipo de evento | Plazo minimo operativo | Tratamiento posterior |
|---|---:|---|
| Inicio de sesion | 30 dias | Archivo cifrado de solo lectura y revision de integridad |
| Consentimiento | 1 ano | Archivo cifrado de solo lectura y revision de integridad |
| Transacciones, credito y cumplimiento | Segun obligacion legal aplicable | Conservacion con datos anonimizados cuando corresponda |

Los plazos no implican borrar una fila individual de `UserLogs`: la tabla es
inmutable y encadenada por hashes. El archivo debe conservar la cadena completa,
un punto de control firmado y la cadena de custodia. Hasta que exista un proceso
automatizado de rotacion de archivos, no se permite borrar manualmente ningun
registro.

## Indicadores y gravedad

- **Gravedad 1:** tres intentos fallidos de login bloquean temporalmente la
  cuenta y generan una alerta al titular. No se continua operando con esa cuenta
  hasta que se habilite de forma controlada.
- **Gravedad 2:** acceso desde un dispositivo nuevo o consulta de datos sin
  motivo. Se registra, se revisa y puede requerir autorizacion adicional.
- **Gravedad 3:** multiples accesos sospechosos, exposicion de credenciales o
  transacciones fuera de patron. Se escalan al Auditor y al responsable tecnico.
- **Gravedad 4:** compromiso confirmado o exposicion de datos personales,
  financieros o credenciales. Se contienen las cuentas afectadas, se preservan
  evidencias, se notifica a los responsables y se inicia la comunicacion a los
  titulares y a la autoridad cuando corresponda.

## Respuesta a incidentes

1. **Preparacion:** responsables y suplentes, respaldos cifrados y mecanismos
   para invalidar sesiones y bloquear cuentas.
2. **Deteccion y analisis:** clasificar la senal como alerta, evento sospechoso o
   incidente confirmado; determinar alcance, gravedad e impacto.
3. **Contencion:** revocar sesiones, suspender cuentas o roles comprometidos,
   aislar el componente afectado y congelar transacciones sospechosas.
4. **Preservacion:** exportar los registros relevantes a almacenamiento de solo
   lectura, calcular su huella SHA-256 y registrar quien realizo la copia.
5. **Erradicacion y recuperacion:** corregir la causa, rotar secretos, forzar
   cambios de contrasena, restaurar respaldos limpios y validar la cadena de
   hashes y los datos criticos.
6. **Notificacion y cierre:** comunicar que ocurrio, cuando se detecto, que datos
   fueron afectados, causas, medidas tomadas, recomendaciones y canal de
   contacto. El cierre exige causa raiz documentada, controles corregidos y
   evidencias preservadas.
