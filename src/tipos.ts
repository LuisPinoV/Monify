import type { Rol, TipoCuenta } from './modulos/autorizacion/roles';

export type Identificador = string;

export type EstadoVerificacion =
  | 'pendiente'
  | 'en_revision'
  | 'verificada'
  | 'rechazada';

export type EstadoSolicitudCredito =
  | 'recibida'
  | 'en_evaluacion'
  | 'aprobada'
  | 'rechazada';

// Perfil completo: solo lo recibe su titular (los datos originales se recuperan de la bóveda).
export interface PerfilCuenta {
  id: Identificador;
  cuenta: TipoCuenta;
  rol: Rol;
  nombre: string;
  rut: string;
  correo: string;
  numeroCelular?: string;
  esMayorEdad?: boolean;
  tramoRenta?: string;
  tramoRentaEtiqueta?: string;
  bloqueada: boolean;
  creadoEn: string;
}

// Vista para el personal: solo seudónimos y banderas, sin datos personales ni financieros.
export interface ResumenCuenta {
  id: Identificador;
  cuenta: TipoCuenta;
  rol: Rol;
  nombre: string;
  bloqueada: boolean;
  estadoCuenta: string;
  creadoEn: string;
}

export interface TarjetaVista {
  id: Identificador;
  bancoId: Identificador;
  banco: string;
  numeroEnmascarado: string;
  saldo: number;
}

export interface Billetera {
  usuarioId: Identificador;
  saldo: number;
  tarjetas: TarjetaVista[];
}

export interface Banco {
  id: Identificador;
  nombre: string;
}

export interface Transaccion {
  id: Identificador;
  usuarioId: Identificador;
  tarjetaId: Identificador;
  monto: number;
  creadaEn: string;
  evidenciaId?: string;
}

export interface SolicitudCredito {
  id: Identificador;
  usuarioId: Identificador;
  creditoId: Identificador;
  montoSolicitado: number;
  estado: EstadoSolicitudCredito;
  creadaEn: string;
  evidenciaId?: string;
  evidenciaResolucionId?: string;
}

export interface Deuda {
  id: Identificador;
  usuarioId: Identificador;
  monto: number;
  creadaEn: string;
}

export interface CasoVerificacion {
  id: Identificador;
  usuarioId: Identificador;
  estado: EstadoVerificacion;
  metodo?: string;
  fechaVerificacion?: string;
  fechaExpiracion?: string;
}

// Los tiempos se guardan por tramos y no existe el monto de deuda (minimización).
export interface ConsultaRiesgo {
  id: Identificador;
  usuarioId: Identificador;
  score?: number;
  // Actividad 6: el titular se opuso al score; el valor se conserva pero queda bloqueado.
  scoreBloqueado?: boolean;
  morosidad: boolean;
  tiempoDeMorosidad?: string;
  tiempoDeMorosidadEtiqueta?: string;
  tiempoEnDeuda?: string;
  tiempoEnDeudaEtiqueta?: string;
  consultadaEn: string;
}

export interface Credito {
  id: Identificador;
  monto: number;
  tasaInteres: number;
}
