/**
 * Actividad 7, punto 1: catálogo formal de los eventos que se auditan y de los campos de cada registro.
 *
 * Todos los eventos se guardan en "UserLogs" con los mismos campos: uniqueID, secuencia, actor (idUsuario o
 * idAdminRiesgo, nunca el nombre ni el correo), fechaAccion, sistema, accion, resultado (exito | denegado | fallo),
 * canal (web | movil | api), dispositivo declarado, recurso (método + ruta y, si aplica, "titular:<id>") y detalle
 * cifrado con AES-256-GCM. Cada fila encadena el hash de la anterior (hashPrevio / hashRegistro).
 * Nunca se guardan los datos personales mismos: ni el cuerpo de la petición ni la respuesta.
 */
export interface EventoAuditado {
  evento: string;
  actor: string;
  datosRegistrados: string;
  datosExcluidos: string;
}

export const CAMPOS_REGISTRO = [
  'uniqueID y secuencia', 'actor (idUsuario o idAdminRiesgo)', 'fechaAccion', 'sistema', 'accion', 'resultado (exito, denegado o fallo)',
  'canal (web, movil o api)', 'dispositivo declarado', 'recurso (método, ruta y titular:<id> si se accede a datos de un titular)',
  'detalle cifrado (código HTTP, parámetros de ruta, motivo, contadores)', 'hashPrevio y hashRegistro (cadena de integridad)'
];

const BASE = 'Actor, resultado, fecha, canal, dispositivo';

export const CATALOGO_EVENTOS: EventoAuditado[] = [
  // Autenticación y sesiones
  { evento: 'auth.login', actor: 'Titular o personal (también intentos con cuentas inexistentes)', datosRegistrados: `${BASE}, motivo del fallo y número de intento`, datosExcluidos: 'Correo y contraseña ingresados, token' },
  { evento: 'auth.cuenta_bloqueada', actor: 'Sistema (3 fallos en 15 min: bloqueo temporal de 15 min)', datosRegistrados: `${BASE}, número de intentos y fin del bloqueo`, datosExcluidos: 'Contraseña' },
  { evento: 'auth.verificacion_adicional', actor: 'Titular tras un login desde un dispositivo nuevo (alerta A3)', datosRegistrados: `${BASE}, código HTTP`, datosExcluidos: 'Contraseña' },
  { evento: 'acceso_denegado', actor: 'Cualquier sesión', datosRegistrados: `${BASE}, ruta, acción requerida o motivo (rol, consentimiento, verificación)`, datosExcluidos: 'Cuerpo de la petición' },
  { evento: 'sesiones.revocar / incidente.contencion', actor: 'Admin', datosRegistrados: `${BASE}, cuenta afectada, motivo, alerta asociada, bloqueo`, datosExcluidos: 'Token revocado' },
  // Accesos a datos personales
  { evento: 'perfil.ver', actor: 'Titular (perfil propio)', datosRegistrados: `${BASE}, ruta`, datosExcluidos: 'Nombre, RUT, correo y celular devueltos' },
  { evento: 'actividad.ver', actor: 'Titular o personal (bitácora propia)', datosRegistrados: `${BASE}, ruta`, datosExcluidos: 'Contenido de la bitácora devuelta' },
  { evento: 'usuarios.listar', actor: 'Personal', datosRegistrados: `${BASE}, ruta`, datosExcluidos: 'Listado (solo seudónimos)' },
  { evento: 'info_financiera.ver', actor: 'Titular, administrador de riesgo (por necesidad) u otro personal con autorización', datosRegistrados: `${BASE}, titular consultado`, datosExcluidos: 'Saldo, renta, score y créditos devueltos' },
  { evento: 'historial.ver / deuda.ver / billetera.ver', actor: 'Titular o personal según la matriz RBAC', datosRegistrados: `${BASE}, titular consultado`, datosExcluidos: 'Montos y números de tarjeta' },
  { evento: 'kyc.ver', actor: 'Titular o personal autorizado', datosRegistrados: `${BASE}, titular consultado`, datosExcluidos: 'Documento y comprobante de identidad' },
  { evento: 'solicitud_credito.ver', actor: 'Titular, administrador de riesgo u operador por necesidad', datosRegistrados: `${BASE}, titular consultado`, datosExcluidos: 'Montos solicitados' },
  { evento: 'acceso.por_necesidad', actor: 'Personal con regla "según necesidad"', datosRegistrados: `${BASE}, acción solicitada y motivo declarado (cifrado)`, datosExcluidos: 'Datos consultados' },
  { evento: 'logs.revisar', actor: 'Auditor (Admin solo con autorización)', datosRegistrados: `${BASE}, filtros usados (ruta y parámetros)`, datosExcluidos: 'Datos personales del log' },
  // Operaciones sobre datos personales
  { evento: 'cuenta.registrar / terminos.aceptar', actor: 'Titular', datosRegistrados: `${BASE}, rol, versión aceptada, evidencia firmada`, datosExcluidos: 'Nombre, RUT, correo, celular, fecha de nacimiento' },
  { evento: 'cuenta.crear / roles.gestionar / perfil.actualizar', actor: 'Admin', datosRegistrados: `${BASE}, cuenta afectada (ruta)`, datosExcluidos: 'Datos de la cuenta y contraseña' },
  { evento: 'transaccion.crear', actor: 'Titular', datosRegistrados: `${BASE}, tarjeta (id), evidencia de no repudio`, datosExcluidos: 'Número completo de tarjeta y monto en claro' },
  { evento: 'tarjeta.agregar', actor: 'Titular', datosRegistrados: `${BASE}, ruta`, datosExcluidos: 'Número de tarjeta' },
  { evento: 'solicitud_credito.crear / solicitud_credito.aprobar', actor: 'Titular / administrador de riesgo', datosRegistrados: `${BASE}, crédito o solicitud (id), evidencia firmada`, datosExcluidos: 'Montos' },
  { evento: 'riesgo.registrar / kyc.registrar', actor: 'Administrador de riesgo u operador', datosRegistrados: `${BASE}, titular afectado`, datosExcluidos: 'Score, morosidad y comprobante KYC' },
  { evento: 'consentimiento.gestionar / consentimiento.otorgar / consentimiento.revocar', actor: 'Titular', datosRegistrados: `${BASE}, finalidad, versión, evidencia (además de ConsentLogs)`, datosExcluidos: 'Datos personales' },
  { evento: 'autorizacion.gestionar', actor: 'Titular o Auditor', datosRegistrados: `${BASE}, beneficiario, ámbito y plazo (ruta)`, datosExcluidos: 'Datos del ámbito autorizado' },
  { evento: 'derechos.<tipo>.recibida | verificacion | verificada | ejecutada | rechazada | desistida | descargada', actor: 'Titular', datosRegistrados: `${BASE}, solicitud (id), nivel de verificación, campos rectificados, huella de la copia`, datosExcluidos: 'Código de verificación, contraseña y datos pedidos o entregados' },
  { evento: 'derechos.oposicion.levantada / derechos.supresion.propagada', actor: 'Titular / sistema', datosRegistrados: `${BASE}, tratamiento o destinos de la propagación`, datosExcluidos: 'Datos personales' },
  // Seguridad y conservación
  { evento: 'alerta.A1 | A2 | A3 | A4 / alerta.aviso_titular', actor: 'Sistema', datosRegistrados: `${BASE}, alerta (id), regla disparada y conteo`, datosExcluidos: 'Datos consultados por el actor' },
  { evento: 'auditoria.exportar', actor: 'Auditor', datosRegistrados: `${BASE}, filtros de la línea de tiempo y huella SHA-256`, datosExcluidos: 'Contenido exportado' },
  { evento: 'auditoria.depuracion', actor: 'Sistema (diario)', datosRegistrados: 'Tablas depuradas, registros eliminados y fecha de corte', datosExcluidos: 'Registros eliminados' }
];

/** Punto 3: plazo de conservación por tipo de registro. Ninguno es "para siempre". */
export const PLAZO_CONSERVACION_ANIOS = 5;

export const PLAZOS_CONSERVACION = [
  { registro: 'Bitácora de auditoría (UserLogs)', plazo: '5 años desde el evento', mecanismo: 'Depuración diaria automática (fn_depurar_registros_vencidos); la cadena de hashes continúa desde la constancia en DepuracionRegistros' },
  { registro: 'Log de consentimientos (ConsentLogs)', plazo: '5 años desde el evento', mecanismo: 'Depuración diaria automática' },
  { registro: 'Historial de solicitudes de derechos', plazo: '5 años desde el cambio de estado', mecanismo: 'Depuración diaria automática' },
  { registro: 'Alertas de seguridad', plazo: '5 años desde la alerta (salvo las ligadas a una contención)', mecanismo: 'Depuración diaria automática' },
  { registro: 'Revocaciones de sesión y constancias de depuración', plazo: '5 años', mecanismo: 'Se conservan como prueba de la contención y de cada depuración' },
  { registro: 'Evidencias de no repudio', plazo: 'Mientras exista la operación que prueban, con un máximo de 5 años desde que esta termina', mecanismo: 'Solo anexado; se eliminan junto con la operación respaldada' },
  { registro: 'Registros financieros bloqueados tras una supresión (transacciones, créditos, KYC)', plazo: 'Máximo 5 años desde el cierre de la cuenta', mecanismo: 'Quedan con isBlocked; se eliminan al vencer el plazo legal' }
];

export const BASE_LEGAL_CONSERVACION = 'Plazo: 5 años. La Ley 19.913 (UAF), art. 5, exige conservar al menos 5 años los registros de las operaciones; la Recomendación 11 del GAFI fija el mismo mínimo. La Ley 21.719 exige limitar la conservación al tiempo necesario, por eso no se conservan más allá de ese mínimo. (HIPAA es una ley de salud de EE. UU. y no aplica.)';

/** Punto 3: quién puede acceder a cada tipo de registro. */
export const PERMISOS_REGISTROS = [
  { registro: 'Bitácora completa, integridad, evidencias, alertas y línea de tiempo', quien: 'Auditor', excepciones: 'Admin solo con una autorización temporal otorgada por un Auditor; el resto de los roles recibe 403' },
  { registro: 'Bitácora propia (GET /usuarios/me/actividad)', quien: 'Cada cuenta, solo sus propios eventos', excepciones: '—' },
  { registro: 'Historial de consentimientos', quien: 'El propio titular', excepciones: 'El personal no tiene endpoint' },
  { registro: 'Solicitudes de derechos', quien: 'El propio titular (con datos y respuesta)', excepciones: 'Admin y Auditor: solo estados y plazos' },
  { registro: 'Revocación de sesiones y bloqueo de cuentas', quien: 'Admin', excepciones: '—' },
  { registro: 'Escritura directa en la base', quien: 'Nadie', excepciones: 'Triggers: UPDATE/DELETE rechazados; solo la depuración por plazo vencido borra' }
];
