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
  nombre: string;
  correo: string;
  creadoEn: string;
}

export interface Billetera {
  id: Identificador;
  usuarioId: Identificador;
  moneda: 'CLP';
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
  montoSolicitado: number;
  estado: EstadoSolicitudCredito;
  creadaEn: string;
}