import type { Rol } from './roles';

/**
 * Reglas de la matriz RBAC (Actividad 4, parte 3):
 * - denegado:     el rol nunca puede ejecutar la acción.
 * - propio:       solo sobre recursos del propio titular.
 * - permitido:    sobre cualquier recurso.
 * - necesidad:    sobre recursos ajenos únicamente con un motivo explícito (queda en la auditoría).
 * - autorizacion: sobre recursos ajenos solo con una autorización expresa vigente.
 */
export type Regla = 'denegado' | 'propio' | 'permitido' | 'necesidad' | 'autorizacion';

export type AmbitoAutorizacion = 'financiera' | 'movimientos' | 'deuda' | 'logs';

export const ACCIONES = [
  // Filas de la matriz del documento
  'info_financiera.ver',
  'perfil.actualizar',
  'billetera.ver',
  'historial.ver',
  'deuda.ver',
  'transaccion.crear',
  'solicitud_credito.crear',
  'solicitud_credito.aprobar',
  'roles.gestionar',
  'claves.acceder',
  'cuenta.crear',
  'logs.revisar',
  // Acciones derivadas necesarias para operar el sistema
  'usuarios.listar',
  'tarjeta.agregar',
  'solicitud_credito.ver',
  'credito.gestionar',
  'riesgo.registrar',
  'kyc.ver',
  'kyc.registrar',
  'consentimiento.gestionar',
  'autorizacion.gestionar',
  // Actividades 5 y 6: ejercicio de derechos (acceso y portabilidad, rectificación, supresión y oposición)
  'derechos.ejercer',
  'derechos.supervisar',
  // Actividad 7: contención de incidentes (revocar sesiones y bloquear la cuenta)
  'sesiones.revocar'
] as const;
export type Accion = (typeof ACCIONES)[number];

type Fila = Record<Rol, Regla>;
const fila = (admin: Regla, usuario: Regla, administradorRiesgo: Regla, auditor: Regla, operadorFinanciero: Regla): Fila => ({
  admin, usuario, administrador_riesgo: administradorRiesgo, auditor, operador_financiero: operadorFinanciero
});

export const MATRIZ_PERMISOS: Record<Accion, Fila> = {
  //                            admin         usuario     adm. riesgo   auditor         operador
  'info_financiera.ver':       fila('denegado', 'propio', 'necesidad', 'autorizacion', 'autorizacion'),
  'perfil.actualizar':         fila('permitido', 'propio', 'denegado', 'denegado', 'denegado'),
  'billetera.ver':             fila('denegado', 'propio', 'denegado', 'denegado', 'denegado'),
  'historial.ver':             fila('denegado', 'propio', 'permitido', 'autorizacion', 'necesidad'),
  // El Auditor puede revisar movimientos y deudas según su autorización.
  'deuda.ver':                 fila('denegado', 'propio', 'permitido', 'autorizacion', 'necesidad'),
  'transaccion.crear':         fila('denegado', 'propio', 'denegado', 'denegado', 'denegado'),
  'solicitud_credito.crear':   fila('denegado', 'propio', 'denegado', 'denegado', 'denegado'),
  'solicitud_credito.aprobar': fila('denegado', 'denegado', 'permitido', 'denegado', 'necesidad'),
  'roles.gestionar':           fila('permitido', 'denegado', 'denegado', 'denegado', 'denegado'),
  'claves.acceder':            fila('denegado', 'denegado', 'denegado', 'denegado', 'denegado'),
  'cuenta.crear':              fila('permitido', 'denegado', 'denegado', 'denegado', 'denegado'),
  // El Auditor analiza los logs en solo lectura; el Admin requiere autorización vigente.
  'logs.revisar':              fila('autorizacion', 'denegado', 'denegado', 'permitido', 'denegado'),

  'usuarios.listar':           fila('permitido', 'denegado', 'permitido', 'permitido', 'permitido'),
  'tarjeta.agregar':           fila('denegado', 'propio', 'denegado', 'denegado', 'denegado'),
  'solicitud_credito.ver':     fila('denegado', 'propio', 'permitido', 'denegado', 'necesidad'),
  'credito.gestionar':         fila('denegado', 'denegado', 'permitido', 'denegado', 'denegado'),
  'riesgo.registrar':          fila('denegado', 'denegado', 'permitido', 'denegado', 'denegado'),
  'kyc.ver':                   fila('denegado', 'propio', 'permitido', 'denegado', 'necesidad'),
  'kyc.registrar':             fila('denegado', 'denegado', 'permitido', 'denegado', 'permitido'),
  'consentimiento.gestionar':  fila('denegado', 'propio', 'denegado', 'denegado', 'denegado'),
  'autorizacion.gestionar':    fila('denegado', 'propio', 'denegado', 'permitido', 'denegado'),
  // Solo el propio titular ejerce sus derechos; el Admin y el Auditor supervisan los plazos sin ver los datos pedidos.
  'derechos.ejercer':          fila('denegado', 'propio', 'denegado', 'denegado', 'denegado'),
  'derechos.supervisar':       fila('permitido', 'denegado', 'denegado', 'permitido', 'denegado'),
  // Actividad 7: el Auditor detecta y el Admin contiene (revoca sesiones y bloquea); nadie más.
  'sesiones.revocar':          fila('permitido', 'denegado', 'denegado', 'denegado', 'denegado')
};

export const AMBITO_POR_ACCION: Partial<Record<Accion, AmbitoAutorizacion>> = {
  'info_financiera.ver': 'financiera',
  'historial.ver': 'movimientos',
  'deuda.ver': 'deuda',
  'logs.revisar': 'logs'
};

export function reglaPara(rol: Rol, accion: Accion): Regla {
  return MATRIZ_PERMISOS[accion][rol];
}

export function esAccion(valor: unknown): valor is Accion {
  return typeof valor === 'string' && (ACCIONES as readonly string[]).includes(valor);
}
