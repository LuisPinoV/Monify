import { Injectable, NotFoundException } from '@nestjs/common';
import { BaseDatos } from '../../base-datos';
import { PersistenciaCifrada } from '../../seguridad/persistencia-cifrada';
import type { CasoVerificacion, ConsultaRiesgo, Credito, Deuda, EstadoSolicitudCredito, SolicitudCredito, Transaccion } from '../../tipos.js';

@Injectable()
export class ServicioOperacionesFinancieras {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly persistenciaCifrada: PersistenciaCifrada
  ) {}

  async listarTransacciones(): Promise<Transaccion[]> {
    const resultado = await this.baseDatos.consultar<TransaccionRow>('SELECT "idTransaccion" AS id, "idUsuario" AS "usuarioId", "montoTransaccion" AS monto, "fechaTransaccion" AS "creadaEn" FROM "Transaccion" ORDER BY "fechaTransaccion" DESC');
    return resultado.rows.map((fila) => {
      return { id: String(fila.id), usuarioId: String(fila.usuarioId), monto: descifrarNumero(fila.monto, this.persistenciaCifrada) ?? 0, creadaEn: fecha(fila.creadaEn) };
    });
  }

  async crearTransaccion(usuarioId: string, monto: number): Promise<Transaccion> {
    const resultado = await this.baseDatos.consultar<TransaccionRow>('INSERT INTO "Transaccion" ("idUsuario", "montoTransaccion") VALUES ($1, $2) RETURNING "idTransaccion" AS id, "idUsuario" AS "usuarioId", "montoTransaccion" AS monto, "fechaTransaccion" AS "creadaEn"', [Number(usuarioId), this.persistenciaCifrada.protegerCampo(monto)]);
    const fila = resultado.rows[0];
    return { id: String(fila.id), usuarioId: String(fila.usuarioId), monto, creadaEn: fecha(fila.creadaEn) };
  }

  async listarDeudas(): Promise<Deuda[]> {
    const resultado = await this.baseDatos.consultar<DeudaRow>('SELECT "idDeuda" AS id, "idUsuario" AS "usuarioId", "montoDeuda" AS monto, "fechaDeuda" AS "creadaEn" FROM "Deuda" ORDER BY "fechaDeuda" DESC');
    return resultado.rows.map((fila) => {
      return { id: String(fila.id), usuarioId: String(fila.usuarioId), monto: descifrarNumero(fila.monto, this.persistenciaCifrada) ?? 0, creadaEn: fecha(fila.creadaEn) };
    });
  }

  async crearDeuda(usuarioId: string, monto: number): Promise<Deuda> {
    const resultado = await this.baseDatos.consultar<DeudaRow>('INSERT INTO "Deuda" ("idUsuario", "montoDeuda") VALUES ($1, $2) RETURNING "idDeuda" AS id, "idUsuario" AS "usuarioId", "montoDeuda" AS monto, "fechaDeuda" AS "creadaEn"', [Number(usuarioId), this.persistenciaCifrada.protegerCampo(monto)]);
    const fila = resultado.rows[0];
    return { id: String(fila.id), usuarioId: String(fila.usuarioId), monto, creadaEn: fecha(fila.creadaEn) };
  }

  async listarVerificaciones(): Promise<CasoVerificacion[]> {
    const resultado = await this.baseDatos.consultar<VerificacionRow>('SELECT "idVerificacion" AS id, "idUsuario" AS "usuarioId", "estadoVerificacion" AS estado, "metodoDeVerificacion" AS metodo, "fechaVerificacion", "fechaExpiracion", "fechaVerificacion" AS "creadoEn" FROM "VerificadorDeIdentidad" ORDER BY "idVerificacion"');
    return resultado.rows.map((fila) => mapearVerificacion(fila, this.persistenciaCifrada));
  }

  async crearVerificacion(datos: Omit<CasoVerificacion, 'id' | 'creadoEn'>): Promise<CasoVerificacion> {
    const camposCifrados = {
      metodo: datos.metodo === undefined ? null : this.persistenciaCifrada.protegerCampo(datos.metodo),
      fechaVerificacion: datos.fechaVerificacion === undefined ? null : this.persistenciaCifrada.protegerCampo(datos.fechaVerificacion),
      fechaExpiracion: datos.fechaExpiracion === undefined ? null : this.persistenciaCifrada.protegerCampo(datos.fechaExpiracion)
    };
    const resultado = await this.baseDatos.consultar<VerificacionRow>('INSERT INTO "VerificadorDeIdentidad" ("idUsuario", "estadoVerificacion", "metodoDeVerificacion", "fechaVerificacion", "fechaExpiracion") VALUES ($1, $2, $3, $4, $5)', [Number(datos.usuarioId), datos.estado, camposCifrados.metodo, camposCifrados.fechaVerificacion, camposCifrados.fechaExpiracion]);
    return mapearVerificacion(resultado.rows[0], this.persistenciaCifrada);
  }

  async listarConsultasRiesgo(): Promise<ConsultaRiesgo[]> {
    const resultado = await this.baseDatos.consultar<RiesgoRow>('SELECT "idConsulta" AS id, "idUsuario" AS "usuarioId", "ScoreDeRiesgo" AS score, "morosidad", "tiempoDeMorosidad", "cantidadDeuda", "tiempoEnDeuda", "fechaConsulta" AS "consultadaEn" FROM "ConsultaDeRiesgo" ORDER BY "fechaConsulta" DESC');
    return resultado.rows.map((fila) => mapearRiesgo(fila, this.persistenciaCifrada));
  }

  async crearConsultaRiesgo(datos: Omit<ConsultaRiesgo, 'id' | 'consultadaEn'>): Promise<ConsultaRiesgo> {
    const resultado = await this.baseDatos.consultar<RiesgoRow>('INSERT INTO "ConsultaDeRiesgo" ("idUsuario", "ScoreDeRiesgo", "morosidad", "tiempoDeMorosidad", "cantidadDeuda", "tiempoEnDeuda") VALUES ($1, $2, $3, $4, $5, $6) RETURNING "idConsulta" AS id, "idUsuario" AS "usuarioId", "ScoreDeRiesgo" AS score, "morosidad", "tiempoDeMorosidad", "cantidadDeuda", "tiempoEnDeuda", "fechaConsulta" AS "consultadaEn"', [Number(datos.usuarioId), this.persistenciaCifrada.protegerCampo(datos.score), this.persistenciaCifrada.protegerCampo(datos.morosidad), datos.tiempoDeMorosidad === undefined ? null : this.persistenciaCifrada.protegerCampo(datos.tiempoDeMorosidad), datos.cantidadDeuda === undefined ? null : this.persistenciaCifrada.protegerCampo(datos.cantidadDeuda), datos.tiempoEnDeuda === undefined ? null : this.persistenciaCifrada.protegerCampo(datos.tiempoEnDeuda)]);
    return mapearRiesgo(resultado.rows[0], this.persistenciaCifrada);
  }

  async listarCreditos(): Promise<Credito[]> {
    const resultado = await this.baseDatos.consultar<CreditoRow>('SELECT "idCredito" AS id, "montoCredito" AS monto, "tasaInteres" AS "tasaInteres" FROM "Credito" ORDER BY "idCredito"');
    return resultado.rows.map((fila) => mapearCredito(fila, this.persistenciaCifrada));
  }

  async crearCredito(monto: number, tasaInteres: number): Promise<Credito> {
    const resultado = await this.baseDatos.consultar<CreditoRow>('INSERT INTO "Credito" ("montoCredito", "tasaInteres") VALUES ($1, $2) RETURNING "idCredito" AS id, "montoCredito" AS monto, "tasaInteres" AS "tasaInteres"', [this.persistenciaCifrada.protegerCampo(monto), this.persistenciaCifrada.protegerCampo(tasaInteres)]);
    return mapearCredito(resultado.rows[0], this.persistenciaCifrada);
  }

  async listarSolicitudes(): Promise<SolicitudCredito[]> {
    const resultado = await this.baseDatos.consultar<SolicitudRow>('SELECT s."idSolicitudCredito" AS id, uc."idUsuario" AS "usuarioId", s."idCredito" AS "creditoId", uc."montoFinal" AS "montoSolicitado", e."estadoSolicitud" AS estado, s."fechaSolicitud" AS "creadaEn" FROM "SolicitudCredito" s JOIN "UsuarioCredito" uc ON uc."idSolicitudCredito" = s."idSolicitudCredito" JOIN "EstadoSolicitud" e ON e."idEstadoSolicitud" = s."idEstadoSolicitud" ORDER BY s."fechaSolicitud" DESC');
    return resultado.rows.map((fila) => mapearSolicitud(fila, this.persistenciaCifrada));
  }

  async crearSolicitud(usuarioId: string, creditoId: string, montoSolicitado: number): Promise<SolicitudCredito> {
    const credito = await this.baseDatos.consultar('SELECT 1 FROM "Credito" WHERE "idCredito" = $1', [Number(creditoId)]);
    if (credito.rowCount === 0) throw new NotFoundException('crédito no encontrado');
    const solicitud = await this.baseDatos.consultar<SolicitudRow>('INSERT INTO "SolicitudCredito" ("idCredito", "idEstadoSolicitud") SELECT $1, "idEstadoSolicitud" FROM "EstadoSolicitud" WHERE "estadoSolicitud" = \'recibida\' RETURNING "idSolicitudCredito" AS id, "idCredito" AS "creditoId", "fechaSolicitud" AS "creadaEn"', [Number(creditoId)]);
    const fila = solicitud.rows[0];
    await this.baseDatos.consultar('INSERT INTO "UsuarioCredito" ("idSolicitudCredito", "idUsuario", "montoFinal") VALUES ($1, $2, $3)', [fila.id, Number(usuarioId), this.persistenciaCifrada.protegerCampo(montoSolicitado)]);
    return { id: String(fila.id), usuarioId, creditoId, montoSolicitado, estado: 'recibida', creadaEn: fecha(fila.creadaEn) };
  }

  async actualizarEstadoSolicitud(id: string, estado: EstadoSolicitudCredito): Promise<SolicitudCredito> {
    const resultado = await this.baseDatos.consultar<SolicitudRow>('UPDATE "SolicitudCredito" s SET "idEstadoSolicitud" = e."idEstadoSolicitud" FROM "EstadoSolicitud" e WHERE s."idSolicitudCredito" = $1 AND e."estadoSolicitud" = $2 RETURNING s."idSolicitudCredito" AS id, e."estadoSolicitud" AS estado, s."fechaSolicitud" AS "creadaEn", s."idCredito" AS "creditoId"', [Number(id), estado]);
    if (resultado.rowCount === 0) throw new NotFoundException('solicitud de crédito no encontrada');
    const usuario = await this.baseDatos.consultar<SolicitudUsuarioRow>('SELECT "idUsuario" AS "usuarioId", "montoFinal" AS "montoSolicitado" FROM "UsuarioCredito" WHERE "idSolicitudCredito" = $1', [Number(id)]);
    const fila = resultado.rows[0];
    return { id, usuarioId: String(usuario.rows[0].usuarioId), creditoId: String(fila.creditoId), montoSolicitado: descifrarNumero(usuario.rows[0].montoSolicitado, this.persistenciaCifrada) ?? 0, estado, creadaEn: fecha(fila.creadaEn) };
  }
}

interface TransaccionRow { id: number; usuarioId: number; monto: string | number | null; creadaEn: Date | string; }
interface DeudaRow { id: number; usuarioId: number; monto: string | number | null; creadaEn: Date | string; }
interface VerificacionRow { id: number; usuarioId: number; estado: CasoVerificacion['estado']; metodo: string | null; fechaVerificacion: Date | string | null; fechaExpiracion: Date | string | null; creadoEn: Date | string | null; }
interface RiesgoRow { id: number; usuarioId: number; score: string | number | null; morosidad: boolean | null; tiempoDeMorosidad: Date | string | null; cantidadDeuda: string | number | null; tiempoEnDeuda: Date | string | null; consultadaEn: Date | string; }
interface CreditoRow { id: number; monto: string | number | null; tasaInteres: string | number | null; }
interface SolicitudRow { id: number; usuarioId: number; creditoId: number; montoSolicitado: string | number | null; estado: EstadoSolicitudCredito; creadaEn: Date | string; }
interface SolicitudUsuarioRow { usuarioId: number; montoSolicitado: string | number | null; }
function mapearVerificacion(fila: VerificacionRow, persistenciaCifrada: PersistenciaCifrada): CasoVerificacion {
  return { id: String(fila.id), usuarioId: String(fila.usuarioId), estado: fila.estado, metodo: descifrarTexto(fila.metodo, persistenciaCifrada), fechaVerificacion: descifrarTexto(fila.fechaVerificacion, persistenciaCifrada), fechaExpiracion: descifrarTexto(fila.fechaExpiracion, persistenciaCifrada), creadoEn: opcional(fila.creadoEn) ?? new Date().toISOString() };
}
function mapearRiesgo(fila: RiesgoRow, persistenciaCifrada: PersistenciaCifrada): ConsultaRiesgo {
  return { id: String(fila.id), usuarioId: String(fila.usuarioId), score: descifrarNumero(fila.score, persistenciaCifrada), morosidad: descifrarBooleano(fila.morosidad, persistenciaCifrada), tiempoDeMorosidad: descifrarTexto(fila.tiempoDeMorosidad, persistenciaCifrada), cantidadDeuda: descifrarNumero(fila.cantidadDeuda, persistenciaCifrada), tiempoEnDeuda: descifrarTexto(fila.tiempoEnDeuda, persistenciaCifrada), consultadaEn: fecha(fila.consultadaEn) };
}
function mapearCredito(fila: CreditoRow, persistenciaCifrada: PersistenciaCifrada): Credito {
  return { id: String(fila.id), monto: descifrarNumero(fila.monto, persistenciaCifrada) ?? 0, tasaInteres: descifrarNumero(fila.tasaInteres, persistenciaCifrada) ?? 0 };
}
function mapearSolicitud(fila: SolicitudRow, persistenciaCifrada: PersistenciaCifrada): SolicitudCredito {
  return { id: String(fila.id), usuarioId: String(fila.usuarioId), creditoId: String(fila.creditoId), montoSolicitado: descifrarNumero(fila.montoSolicitado, persistenciaCifrada) ?? 0, estado: fila.estado, creadaEn: fecha(fila.creadaEn) };
}
function descifrarTexto(value: string | Date | null, persistenciaCifrada: PersistenciaCifrada): string | undefined { const result = persistenciaCifrada.revelarCampo<string>(value === null ? null : String(value)); return result ?? undefined; }
function descifrarNumero(value: string | number | null, persistenciaCifrada: PersistenciaCifrada): number | undefined { const result = persistenciaCifrada.revelarCampo<number>(value === null ? null : String(value)); return result === null ? undefined : Number(result); }
function descifrarBooleano(value: boolean | string | null, persistenciaCifrada: PersistenciaCifrada): boolean { const result = persistenciaCifrada.revelarCampo<boolean>(value === null ? null : String(value)); return result ?? false; }
function fecha(valor: Date | string): string { return new Date(valor).toISOString(); }
function opcional(valor: Date | string | null): string | undefined { return valor === null ? undefined : fecha(valor); }