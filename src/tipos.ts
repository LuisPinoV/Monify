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

export interface Usuario {
  id: Identificador;
  tipoUsuario: string;
  nombre: string;
  rut: string;
  fechaNacimiento: string;
  saldo: number;
  rentaMensual?: number;
  numeroCelular?: string;
  correo: string;
  creadoEn: string;
}

export interface Billetera {
  id: Identificador;
  usuarioId: Identificador;
  saldo: number;
}

export interface Transferencia {
  id: Identificador;
  billeteraOrigenId: Identificador;
  billeteraDestinoId: Identificador;
  monto: number;
  estado: 'creada';
  creadaEn: string;
}

export interface CasoVerificacion {
  id: Identificador;
  usuarioId: Identificador;
  estado: EstadoVerificacion;
  creadoEn: string;
}

export interface SolicitudCredito {
  id: Identificador;
  usuarioId: Identificador;
  creditoId: Identificador;
  montoSolicitado: number;
  estado: EstadoSolicitudCredito;
  creadaEn: string;
}

export interface Transaccion {
  id: Identificador;
  usuarioId: Identificador;
  monto: number;
  creadaEn: string;
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
  creadoEn: string;
}

export interface ConsultaRiesgo {
  id: Identificador;
  usuarioId: Identificador;
  score?: number;
  morosidad: boolean;
  tiempoDeMorosidad?: string;
  cantidadDeuda?: number;
  tiempoEnDeuda?: string;
  consultadaEn: string;
}

export interface Credito {
  id: Identificador;
  monto: number;
  tasaInteres: number;
}