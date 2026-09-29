import { Injectable, NotFoundException } from '@nestjs/common';
import { BaseDatos } from '../../base-datos';
import type { CasoVerificacion, ConsultaRiesgo, Credito, Deuda, EstadoSolicitudCredito, SolicitudCredito, Transaccion } from '../../tipos.js';

@Injectable()
export class ServicioOperacionesFinancieras {
  constructor(private readonly baseDatos: BaseDatos) {}

  async listarTransacciones(): Promise<Transaccion[]> {
    const resultado = await this.baseDatos.consultar<TransaccionRow>('SELECT "idTransaccion" AS id, "idUsuario" AS "usuarioId", "montoTransaccion" AS monto, "fechaTransaccion" AS "creadaEn" FROM "Transaccion" ORDER BY "fechaTransaccion" DESC');
    return resultado.rows.map((fila) => ({ id: String(fila.id), usuarioId: String(fila.usuarioId), monto: Number(fila.monto), creadaEn: fecha(fila.creadaEn) }));
  }

  async crearTransaccion(usuarioId: string, monto: number): Promise<Transaccion> {
    const resultado = await this.baseDatos.consultar<TransaccionRow>('INSERT INTO "Transaccion" ("idUsuario", "montoTransaccion") VALUES ($1, $2) RETURNING "idTransaccion" AS id, "idUsuario" AS "usuarioId", "montoTransaccion" AS monto, "fechaTransaccion" AS "creadaEn"', [Number(usuarioId), monto]);
    const fila = resultado.rows[0];
    return { id: String(fila.id), usuarioId: String(fila.usuarioId), monto: Number(fila.monto), creadaEn: fecha(fila.creadaEn) };
  }

  async listarDeudas(): Promise<Deuda[]> {
    const resultado = await this.baseDatos.consultar<DeudaRow>('SELECT "idDeuda" AS id, "idUsuario" AS "usuarioId", "montoDeuda" AS monto, "fechaDeuda" AS "creadaEn" FROM "Deuda" ORDER BY "fechaDeuda" DESC');
    return resultado.rows.map((fila) => ({ id: String(fila.id), usuarioId: String(fila.usuarioId), monto: Number(fila.monto), creadaEn: fecha(fila.creadaEn) }));
  }

  async crearDeuda(usuarioId: string, monto: number): Promise<Deuda> {
    const resultado = await this.baseDatos.consultar<DeudaRow>('INSERT INTO "Deuda" ("idUsuario", "montoDeuda") VALUES ($1, $2) RETURNING "idDeuda" AS id, "idUsuario" AS "usuarioId", "montoDeuda" AS monto, "fechaDeuda" AS "creadaEn"', [Number(usuarioId), monto]);
    const fila = resultado.rows[0];
    return { id: String(fila.id), usuarioId: String(fila.usuarioId), monto: Number(fila.monto), creadaEn: fecha(fila.creadaEn) };
  }

  async listarVerificaciones(): Promise<CasoVerificacion[]> {
    const resultado = await this.baseDatos.consultar<VerificacionRow>('SELECT "idVerificacion" AS id, "idUsuario" AS "usuarioId", "estadoVerificacion" AS estado, "metodoDeVerificacion" AS metodo, "fechaVerificacion", "fechaExpiracion", "fechaVerificacion" AS "creadoEn" FROM "VerificadorDeIdentidad" ORDER BY "idVerificacion"');
    return resultado.rows.map(mapearVerificacion);
  }

  async crearVerificacion(datos: Omit<CasoVerificacion, 'id' | 'creadoEn'>): Promise<CasoVerificacion> {
    const resultado = await this.baseDatos.consultar<VerificacionRow>('INSERT INTO "VerificadorDeIdentidad" ("idUsuario", "estadoVerificacion", "metodoDeVerificacion", "fechaVerificacion", "fechaExpiracion") VALUES ($1, $2, $3, $4, $5) RETURNING "idVerificacion" AS id, "idUsuario" AS "usuarioId", "estadoVerificacion" AS estado, "metodoDeVerificacion" AS metodo, "fechaVerificacion", "fechaExpiracion", "fechaVerificacion" AS "creadoEn"', [Number(datos.usuarioId), datos.estado, datos.metodo ?? null, datos.fechaVerificacion ?? null, datos.fechaExpiracion ?? null]);
    return mapearVerificacion(resultado.rows[0]);
  }

  async listarConsultasRiesgo(): Promise<ConsultaRiesgo[]> {
    const resultado = await this.baseDatos.consultar<RiesgoRow>('SELECT "idConsulta" AS id, "idUsuario" AS "usuarioId", "ScoreDeRiesgo" AS score, "morosidad", "tiempoDeMorosidad", "cantidadDeuda", "tiempoEnDeuda", "fechaConsulta" AS "consultadaEn" FROM "ConsultaDeRiesgo" ORDER BY "fechaConsulta" DESC');
    return resultado.rows.map(mapearRiesgo);
  }

  async crearConsultaRiesgo(datos: Omit<ConsultaRiesgo, 'id' | 'consultadaEn'>): Promise<ConsultaRiesgo> {
    const resultado = await this.baseDatos.consultar<RiesgoRow>('INSERT INTO "ConsultaDeRiesgo" ("idUsuario", "ScoreDeRiesgo", "morosidad", "tiempoDeMorosidad", "cantidadDeuda", "tiempoEnDeuda") VALUES ($1, $2, $3, $4, $5, $6) RETURNING "idConsulta" AS id, "idUsuario" AS "usuarioId", "ScoreDeRiesgo" AS score, "morosidad", "tiempoDeMorosidad", "cantidadDeuda", "tiempoEnDeuda", "fechaConsulta" AS "consultadaEn"', [Number(datos.usuarioId), datos.score ?? null, datos.morosidad, datos.tiempoDeMorosidad ?? null, datos.cantidadDeuda ?? null, datos.tiempoEnDeuda ?? null]);
    return mapearRiesgo(resultado.rows[0]);
  }

  async listarCreditos(): Promise<Credito[]> {
    const resultado = await this.baseDatos.consultar<CreditoRow>('SELECT "idCredito" AS id, "montoCredito" AS monto, "tasaInteres" AS "tasaInteres" FROM "Credito" ORDER BY "idCredito"');
    return resultado.rows.map(mapearCredito);
  }

  async crearCredito(monto: number, tasaInteres: number): Promise<Credito> {
    const resultado = await this.baseDatos.consultar<CreditoRow>('INSERT INTO "Credito" ("montoCredito", "tasaInteres") VALUES ($1, $2) RETURNING "idCredito" AS id, "montoCredito" AS monto, "tasaInteres" AS "tasaInteres"', [monto, tasaInteres]);
    return mapearCredito(resultado.rows[0]);
  }

  async listarSolicitudes(): Promise<SolicitudCredito[]> {
    const resultado = await this.baseDatos.consultar<SolicitudRow>('SELECT s."idSolicitudCredito" AS id, uc."idUsuario" AS "usuarioId", s."idCredito" AS "creditoId", uc."montoFinal" AS "montoSolicitado", e."estadoSolicitud" AS estado, s."fechaSolicitud" AS "creadaEn" FROM "SolicitudCredito" s JOIN "UsuarioCredito" uc ON uc."idSolicitudCredito" = s."idSolicitudCredito" JOIN "EstadoSolicitud" e ON e."idEstadoSolicitud" = s."idEstadoSolicitud" ORDER BY s."fechaSolicitud" DESC');
    return resultado.rows.map(mapearSolicitud);
  }

  async crearSolicitud(usuarioId: string, creditoId: string, montoSolicitado: number): Promise<SolicitudCredito> {
    const credito = await this.baseDatos.consultar('SELECT 1 FROM "Credito" WHERE "idCredito" = $1', [Number(creditoId)]);
    if (credito.rowCount === 0) throw new NotFoundException('crédito no encontrado');
    const solicitud = await this.baseDatos.consultar<SolicitudRow>('INSERT INTO "SolicitudCredito" ("idCredito", "idEstadoSolicitud") SELECT $1, "idEstadoSolicitud" FROM "EstadoSolicitud" WHERE "estadoSolicitud" = \'recibida\' RETURNING "idSolicitudCredito" AS id, "idCredito" AS "creditoId", "fechaSolicitud" AS "creadaEn"', [Number(creditoId)]);
    const fila = solicitud.rows[0];
    await this.baseDatos.consultar('INSERT INTO "UsuarioCredito" ("idSolicitudCredito", "idUsuario", "montoFinal") VALUES ($1, $2, $3)', [fila.id, Number(usuarioId), montoSolicitado]);
    return { id: String(fila.id), usuarioId, creditoId, montoSolicitado, estado: 'recibida', creadaEn: fecha(fila.creadaEn) };
  }

  async actualizarEstadoSolicitud(id: string, estado: EstadoSolicitudCredito): Promise<SolicitudCredito> {
    const resultado = await this.baseDatos.consultar<SolicitudRow>('UPDATE "SolicitudCredito" s SET "idEstadoSolicitud" = e."idEstadoSolicitud" FROM "EstadoSolicitud" e WHERE s."idSolicitudCredito" = $1 AND e."estadoSolicitud" = $2 RETURNING s."idSolicitudCredito" AS id, e."estadoSolicitud" AS estado, s."fechaSolicitud" AS "creadaEn", s."idCredito" AS "creditoId"', [Number(id), estado]);
    if (resultado.rowCount === 0) throw new NotFoundException('solicitud de crédito no encontrada');
    const usuario = await this.baseDatos.consultar<{ usuarioId: number; montoSolicitado: string }>('SELECT "idUsuario" AS "usuarioId", "montoFinal" AS "montoSolicitado" FROM "UsuarioCredito" WHERE "idSolicitudCredito" = $1', [Number(id)]);
    const fila = resultado.rows[0];
    return { id, usuarioId: String(usuario.rows[0].usuarioId), creditoId: String(fila.creditoId), montoSolicitado: Number(usuario.rows[0].montoSolicitado), estado, creadaEn: fecha(fila.creadaEn) };
  }
}

interface TransaccionRow { id: number; usuarioId: number; monto: string | number; creadaEn: Date | string; }
interface DeudaRow { id: number; usuarioId: number; monto: string | number; creadaEn: Date | string; }
interface VerificacionRow { id: number; usuarioId: number; estado: CasoVerificacion['estado']; metodo: string | null; fechaVerificacion: Date | string | null; fechaExpiracion: Date | string | null; creadoEn: Date | string | null; }
interface RiesgoRow { id: number; usuarioId: number; score: string | number | null; morosidad: boolean; tiempoDeMorosidad: Date | string | null; cantidadDeuda: string | number | null; tiempoEnDeuda: Date | string | null; consultadaEn: Date | string; }
interface CreditoRow { id: number; monto: string | number; tasaInteres: string | number; }
interface SolicitudRow { id: number; usuarioId: number; creditoId: number; montoSolicitado: string | number; estado: EstadoSolicitudCredito; creadaEn: Date | string; }

function mapearVerificacion(fila: VerificacionRow): CasoVerificacion { return { id: String(fila.id), usuarioId: String(fila.usuarioId), estado: fila.estado, metodo: fila.metodo ?? undefined, fechaVerificacion: opcional(fila.fechaVerificacion), fechaExpiracion: opcional(fila.fechaExpiracion), creadoEn: opcional(fila.creadoEn) ?? new Date().toISOString() }; }
function mapearRiesgo(fila: RiesgoRow): ConsultaRiesgo { return { id: String(fila.id), usuarioId: String(fila.usuarioId), score: fila.score === null ? undefined : Number(fila.score), morosidad: fila.morosidad, tiempoDeMorosidad: opcional(fila.tiempoDeMorosidad), cantidadDeuda: fila.cantidadDeuda === null ? undefined : Number(fila.cantidadDeuda), tiempoEnDeuda: opcional(fila.tiempoEnDeuda), consultadaEn: fecha(fila.consultadaEn) }; }
function mapearCredito(fila: CreditoRow): Credito { return { id: String(fila.id), monto: Number(fila.monto), tasaInteres: Number(fila.tasaInteres) }; }
function mapearSolicitud(fila: SolicitudRow): SolicitudCredito { return { id: String(fila.id), usuarioId: String(fila.usuarioId), creditoId: String(fila.creditoId), montoSolicitado: Number(fila.montoSolicitado), estado: fila.estado, creadaEn: fecha(fila.creadaEn) }; }
function fecha(valor: Date | string): string { return new Date(valor).toISOString(); }
function opcional(valor: Date | string | null): string | undefined { return valor === null ? undefined : fecha(valor); }