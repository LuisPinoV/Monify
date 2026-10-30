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
  // Actividad 5: ejercicio de derechos (acceso y portabilidad, rectificación, supresión)
  'derechos.ejercer',
  'derechos.supervisar'
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
  // La celda del auditor está vacía en el documento: se asume el mismo criterio que para el historial.
  'deuda.ver':                 fila('denegado', 'propio', 'permitido', 'autorizacion', 'necesidad'),
  'transaccion.crear':         fila('denegado', 'propio', 'denegado', 'denegado', 'denegado'),
  'solicitud_credito.crear':   fila('denegado', 'propio', 'denegado', 'denegado', 'denegado'),
  'solicitud_credito.aprobar': fila('denegado', 'denegado', 'permitido', 'denegado', 'necesidad'),
  'roles.gestionar':           fila('permitido', 'denegado', 'denegado', 'denegado', 'denegado'),
  'claves.acceder':            fila('denegado', 'denegado', 'denegado', 'denegado', 'denegado'),
  'cuenta.crear':              fila('permitido', 'denegado', 'denegado', 'denegado', 'denegado'),
  // El documento marca "Denegada" para el auditor, pero su definición es analizar los logs: se le permite.
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
  'derechos.supervisar':       fila('permitido', 'denegado', 'denegado', 'permitido', 'denegado')
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
