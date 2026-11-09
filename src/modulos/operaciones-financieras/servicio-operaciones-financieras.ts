import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BaseDatos, type Ejecutor } from '../../base-datos';
import { PersistenciaCifrada } from '../../seguridad/persistencia-cifrada';
import { ServicioHash } from '../../seguridad/servicio-hash';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { etiquetaTramoDias, etiquetaTramoRenta, tramoDias } from '../../utilidades/tramos';
import type { CasoVerificacion, ConsultaRiesgo, Credito, Deuda, EstadoSolicitudCredito, EstadoVerificacion, SolicitudCredito, Transaccion } from '../../tipos';
import { ServicioNoRepudio } from '../auditoria/servicio-no-repudio';
import { acotarAlcance, condicionAlcance } from '../autorizacion/alcance';
import type { Sesion } from '../autorizacion/roles';
import type { Alcance } from '../autorizacion/servicio-autorizacion';
import { ServicioBilleteras } from '../billeteras/servicio-billeteras';
import { ServicioConsentimientos } from '../terminos/servicio-consentimientos';
import { ServicioOposiciones, TRATAMIENTOS_OPONIBLES, type TratamientoOponible } from '../terminos/servicio-oposiciones';

const ESTADOS_VERIFICACION: EstadoVerificacion[] = ['pendiente', 'en_revision', 'verificada', 'rechazada'];
const ESTADOS_RESOLUCION: EstadoSolicitudCredito[] = ['en_evaluacion', 'aprobada', 'rechazada'];
const ESTADOS_FINALES: EstadoSolicitudCredito[] = ['aprobada', 'rechazada'];
const MONTO_MAXIMO = 1_000_000_000;

export interface InformacionFinanciera {
  usuarioId: string;
  tramoRenta?: string;
  tramoRentaEtiqueta?: string;
  saldoTotal: number;
  ultimaConsultaRiesgo?: ConsultaRiesgo;
  // Actividad 6: tratamientos a los que el titular se opuso (por ejemplo, el score): la evaluación debe prescindir de ellos.
  oposiciones: { tratamiento: TratamientoOponible; nombre: string }[];
  creditosVigentes: number;
  solicitudesEnCurso: number;
}

export interface ObligacionesPendientes {
  deudas: number;
  creditosVigentes: number;
  solicitudesEnCurso: number;
}

function montoValido(valor: unknown, nombre: string): number {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor <= 0 || valor > MONTO_MAXIMO) {
    throw new BadRequestException(`${nombre} debe ser un entero mayor que cero (CLP, sin decimales)`);
  }
  return valor;
}

@Injectable()
export class ServicioOperacionesFinancieras {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly persistenciaCifrada: PersistenciaCifrada,
    private readonly hash: ServicioHash,
    private readonly billeteras: ServicioBilleteras,
    private readonly consentimientos: ServicioConsentimientos,
    private readonly noRepudio: ServicioNoRepudio,
    private readonly oposiciones: ServicioOposiciones
  ) {}

  // ---------------------------------------------------------------- transacciones

  async listarTransacciones(alcance: Alcance, usuarioId?: number): Promise<Transaccion[]> {
    // BDD v5: la transacción pertenece a una tarjeta; el titular se obtiene a través de su billetera.
    const filtro = condicionAlcance(acotarAlcance(alcance, usuarioId), 'b."idUsuario"', 1);
    const resultado = await this.baseDatos.consultar<TransaccionRow>(`
      SELECT t."idTransaccion" AS id, b."idUsuario" AS "usuarioId", t."idTarjeta" AS "tarjetaId", t."montoTransaccion" AS monto,
             t."fechaTransaccion" AS "creadaEn", t."idEvidencia" AS "evidenciaId"
      FROM "Transaccion" t JOIN "Billetera" b ON b."idTarjeta" = t."idTarjeta"
      WHERE ${filtro.sql} AND NOT t."isBlocked" ORDER BY t."fechaTransaccion" DESC, t."idTransaccion" DESC
    `, filtro.parametros);
    return resultado.rows.map((fila) => this.mapearTransaccion(fila));
  }

  async crearTransaccion(sesion: Sesion, datos: { tarjetaId: number; tipo: 'abono' | 'cargo'; monto: number }, confirmacion: unknown, contexto: ContextoCliente): Promise<Transaccion & { saldoTarjeta: number }> {
    this.noRepudio.exigirConfirmacion(confirmacion);
    const monto = montoValido(datos.monto, 'monto');
    await this.consentimientos.exigirConsentimiento(sesion.id);
    return this.baseDatos.transaccion(async (tx) => {
      const saldo = await this.billeteras.saldoTarjetaPropia(sesion.id, datos.tarjetaId, tx);
      const movimiento = datos.tipo === 'cargo' ? -monto : monto;
      const nuevoSaldo = saldo + movimiento;
      if (nuevoSaldo < 0) throw new ConflictException('saldo insuficiente: el saldo de la tarjeta no puede quedar negativo');
      const evidencia = await this.noRepudio.registrar({
        actor: sesion, accion: 'transaccion.crear', recurso: `tarjeta:${datos.tarjetaId}`,
        datos: { tarjetaId: datos.tarjetaId, tipo: datos.tipo, monto }, contexto
      }, tx);
      const resultado = await tx.consultar<TransaccionRow>(`
        INSERT INTO "Transaccion" ("idTarjeta", "montoTransaccion", "idEvidencia") VALUES ($2, $3, $4)
        RETURNING "idTransaccion" AS id, $1::int AS "usuarioId", "idTarjeta" AS "tarjetaId", "montoTransaccion" AS monto,
                  "fechaTransaccion" AS "creadaEn", "idEvidencia" AS "evidenciaId"
      `, [sesion.id, datos.tarjetaId, this.persistenciaCifrada.protegerCampo(movimiento), evidencia.id]);
      await this.billeteras.actualizarSaldo(datos.tarjetaId, nuevoSaldo, tx);
      return { ...this.mapearTransaccion(resultado.rows[0]), saldoTarjeta: nuevoSaldo };
    });
  }

  // ---------------------------------------------------------------- deudas

  async listarDeudas(alcance: Alcance, usuarioId?: number): Promise<Deuda[]> {
    const filtro = condicionAlcance(acotarAlcance(alcance, usuarioId), '"idUsuario"', 1);
    const resultado = await this.baseDatos.consultar<DeudaRow>(
      `SELECT "idDeuda" AS id, "idUsuario" AS "usuarioId", "montoDeuda" AS monto, "fechaDeuda" AS "creadaEn" FROM "Deuda" WHERE ${filtro.sql} AND NOT "isBlocked" ORDER BY "fechaDeuda" DESC`,
      filtro.parametros
    );
    return resultado.rows.map((fila) => this.mapearDeuda(fila));
  }

  async crearDeuda(usuarioId: number, monto: number): Promise<Deuda> {
    montoValido(monto, 'monto');
    const resultado = await this.insertarConUsuario<DeudaRow>(
      'INSERT INTO "Deuda" ("idUsuario", "montoDeuda") VALUES ($1, $2) RETURNING "idDeuda" AS id, "idUsuario" AS "usuarioId", "montoDeuda" AS monto, "fechaDeuda" AS "creadaEn"',
      [usuarioId, this.persistenciaCifrada.protegerCampoAsimetrico(monto)]
    );
    return this.mapearDeuda(resultado.rows[0]);
  }

  // ---------------------------------------------------------------- verificación de identidad (KYC)

  async listarVerificaciones(alcance: Alcance, usuarioId?: number): Promise<CasoVerificacion[]> {
    const filtro = condicionAlcance(acotarAlcance(alcance, usuarioId), '"idUsuario"', 1);
    const resultado = await this.baseDatos.consultar<VerificacionRow>(`
      SELECT "idVerificacion" AS id, "idUsuario" AS "usuarioId", "estadoVerificacion" AS estado, "metodoDeVerificacion" AS metodo,
             "fechaVerificacion", "fechaExpiracion"
      FROM "VerificadorDeIdentidad" WHERE ${filtro.sql} AND NOT "isBlocked" ORDER BY "idVerificacion"
    `, filtro.parametros);
    return resultado.rows.map(mapearVerificacion);
  }

  async crearVerificacion(datos: {
    usuarioId: number; estado: EstadoVerificacion; metodo?: string; fechaVerificacion?: string; fechaExpiracion?: string; comprobante?: string;
  }): Promise<CasoVerificacion> {
    if (!ESTADOS_VERIFICACION.includes(datos.estado)) {
      throw new BadRequestException(`estado debe ser uno de: ${ESTADOS_VERIFICACION.join(', ')}`);
    }
    // Del comprobante entregado por el verificador externo solo se conserva su hash.
    const hashComprobante = datos.comprobante ? await this.hash.hash(datos.comprobante) : null;
    const resultado = await this.insertarConUsuario<VerificacionRow>(`
      INSERT INTO "VerificadorDeIdentidad" ("idUsuario", "estadoVerificacion", "metodoDeVerificacion", "fechaVerificacion", "fechaExpiracion", "hashDeVerificacion")
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING "idVerificacion" AS id, "idUsuario" AS "usuarioId", "estadoVerificacion" AS estado, "metodoDeVerificacion" AS metodo,
                "fechaVerificacion", "fechaExpiracion"
    `, [datos.usuarioId, datos.estado, datos.metodo ?? null, datos.fechaVerificacion ?? null, datos.fechaExpiracion ?? null, hashComprobante]);
    return mapearVerificacion(resultado.rows[0]);
  }

  // ---------------------------------------------------------------- riesgo

  // Con una oposición vigente al score, el score queda bloqueado: no se muestra ni se usa. Solo la copia de acceso del
  // propio titular (incluirBloqueados) lo incluye, porque el derecho de acceso alcanza también a los datos bloqueados.
  async listarConsultasRiesgo(alcance: Alcance, usuarioId?: number, opciones: { incluirBloqueados?: boolean } = {}): Promise<ConsultaRiesgo[]> {
    const filtro = condicionAlcance(acotarAlcance(alcance, usuarioId), '"idUsuario"', 1);
    const resultado = await this.baseDatos.consultar<RiesgoRow>(`
      SELECT "idConsulta" AS id, "idUsuario" AS "usuarioId", "scoreDeRiesgo" AS score, "morosidad", "tiempoDeMorosidad",
             "tiempoEnDeuda", "fechaConsulta" AS "consultadaEn"
      FROM "ConsultaDeRiesgo" WHERE ${filtro.sql} AND NOT "isBlocked" ORDER BY "fechaConsulta" DESC, "idConsulta" DESC
    `, filtro.parametros);
    const consultas = resultado.rows.map((fila) => this.mapearRiesgo(fila));
    if (opciones.incluirBloqueados || consultas.length === 0) return consultas;
    const opuestos = await this.oposiciones.titularesOpuestos('score_comportamiento', [...new Set(consultas.map((c) => Number(c.usuarioId)))]);
    return consultas.map((consulta) => opuestos.has(Number(consulta.usuarioId))
      ? { ...consulta, score: undefined, scoreBloqueado: true }
      : consulta);
  }

  // El monto de deuda no se almacena y los tiempos se reducen a tramos antes de persistirse.
  async crearConsultaRiesgo(datos: {
    usuarioId: number; score?: number; morosidad: boolean; diasMorosidad?: number; diasEnDeuda?: number;
  }): Promise<ConsultaRiesgo> {
    if (datos.score !== undefined && (typeof datos.score !== 'number' || !Number.isFinite(datos.score) || datos.score < 0)) {
      throw new BadRequestException('score debe ser un número no negativo');
    }
    if (datos.score !== undefined && await this.oposiciones.estaOpuesto(datos.usuarioId, 'score_comportamiento')) {
      throw new ConflictException('el titular se opuso al tratamiento "score de comportamiento financiero": registra la consulta sin score');
    }
    const protegerTramo = (dias: number | undefined) => {
      if (dias === undefined) return null;
      if (typeof dias !== 'number' || !Number.isFinite(dias) || dias < 0) throw new BadRequestException('los días deben ser un número no negativo');
      return this.persistenciaCifrada.protegerCampoAsimetrico(tramoDias(dias));
    };
    const resultado = await this.insertarConUsuario<RiesgoRow>(`
      INSERT INTO "ConsultaDeRiesgo" ("idUsuario", "scoreDeRiesgo", "morosidad", "tiempoDeMorosidad", "tiempoEnDeuda")
      VALUES ($1, $2, $3, $4, $5)
      RETURNING "idConsulta" AS id, "idUsuario" AS "usuarioId", "scoreDeRiesgo" AS score, "morosidad", "tiempoDeMorosidad",
                "tiempoEnDeuda", "fechaConsulta" AS "consultadaEn"
    `, [
      datos.usuarioId,
      datos.score === undefined ? null : this.persistenciaCifrada.protegerCampoAsimetrico(datos.score),
      this.persistenciaCifrada.protegerCampoAsimetrico(datos.morosidad),
      protegerTramo(datos.diasMorosidad),
      protegerTramo(datos.diasEnDeuda)
    ]);
    return this.mapearRiesgo(resultado.rows[0]);
  }

  async informacionFinanciera(usuarioId: number): Promise<InformacionFinanciera> {
    const usuario = await this.baseDatos.consultar<{ tramoRenta: string | null; estadoCuenta: string }>(
      'SELECT "rangoRentaMensual" AS "tramoRenta", "estadoCuenta" FROM "Usuario" WHERE "idUsuario" = $1', [usuarioId]
    );
    if (usuario.rows.length === 0) throw new NotFoundException('usuario no encontrado');
    const tramo = this.persistenciaCifrada.revelarCampo<string>(usuario.rows[0].tramoRenta) ?? undefined;
    const ultima = await this.listarConsultasRiesgo({ tipo: 'ids', ids: [usuarioId] });
    const obligaciones = await this.obligacionesPendientes(usuarioId, this.baseDatos);
    const oposiciones = await this.oposiciones.vigentes(usuarioId);
    return {
      usuarioId: String(usuarioId),
      tramoRenta: tramo,
      tramoRentaEtiqueta: etiquetaTramoRenta(tramo),
      saldoTotal: await this.billeteras.saldoTotal(usuarioId),
      ultimaConsultaRiesgo: ultima[0],
      oposiciones: oposiciones.map((tratamiento) => ({ tratamiento, nombre: TRATAMIENTOS_OPONIBLES[tratamiento].nombre })),
      creditosVigentes: obligaciones.creditosVigentes,
      solicitudesEnCurso: obligaciones.solicitudesEnCurso
    };
  }

  // ---------------------------------------------------------------- créditos

  async listarCreditos(): Promise<Credito[]> {
    const resultado = await this.baseDatos.consultar<CreditoRow>('SELECT "idCredito" AS id, "montoCredito" AS monto, "tasaInteres" FROM "Credito" ORDER BY "idCredito"');
    return resultado.rows.map((fila) => this.mapearCredito(fila));
  }

  async crearCredito(monto: number, tasaInteres: number): Promise<Credito> {
    const resultado = await this.baseDatos.consultar<CreditoRow>(
      'INSERT INTO "Credito" ("montoCredito", "tasaInteres") VALUES ($1, $2) RETURNING "idCredito" AS id, "montoCredito" AS monto, "tasaInteres"',
      [this.persistenciaCifrada.protegerCampoAsimetrico(monto), this.persistenciaCifrada.protegerCampoAsimetrico(tasaInteres)]
    );
    return this.mapearCredito(resultado.rows[0]);
  }

  async listarSolicitudes(alcance: Alcance, usuarioId?: number): Promise<SolicitudCredito[]> {
    const filtro = condicionAlcance(acotarAlcance(alcance, usuarioId), 'uc."idUsuario"', 1);
    const resultado = await this.baseDatos.consultar<SolicitudRow>(`
      SELECT s."idSolicitudCredito" AS id, uc."idUsuario" AS "usuarioId", s."idCredito" AS "creditoId", uc."montoFinal" AS "montoSolicitado",
             e."estadoSolicitud" AS estado, s."fechaSolicitud" AS "creadaEn", s."idEvidencia" AS "evidenciaId",
             s."idEvidenciaResolucion" AS "evidenciaResolucionId"
      FROM "SolicitudCredito" s
      JOIN "UsuarioCredito" uc ON uc."idSolicitudCredito" = s."idSolicitudCredito"
      JOIN "EstadoSolicitud" e ON e."idEstadoSolicitud" = s."idEstadoSolicitud"
      WHERE ${filtro.sql} ORDER BY s."fechaSolicitud" DESC, s."idSolicitudCredito" DESC
    `, filtro.parametros);
    return resultado.rows.map((fila) => this.mapearSolicitud(fila));
  }

  async crearSolicitud(sesion: Sesion, datos: {
    creditoId: number; montoSolicitado: number;
  }, confirmacion: unknown, contexto: ContextoCliente): Promise<SolicitudCredito> {
    this.noRepudio.exigirConfirmacion(confirmacion);
    const monto = montoValido(datos.montoSolicitado, 'montoSolicitado');
    // Incluye la finalidad "evaluacion_crediticia", obligatoria desde la Actividad 5.
    await this.consentimientos.exigirConsentimiento(sesion.id);
    const credito = await this.baseDatos.consultar('SELECT 1 FROM "Credito" WHERE "idCredito" = $1', [datos.creditoId]);
    if (credito.rowCount === 0) throw new NotFoundException('crédito no encontrado');

    return this.baseDatos.transaccion(async (tx) => {
      const evidencia = await this.noRepudio.registrar({
        actor: sesion, accion: 'solicitud_credito.crear', recurso: `credito:${datos.creditoId}`,
        datos: { creditoId: datos.creditoId, montoSolicitado: monto }, contexto
      }, tx);
      const solicitud = await tx.consultar<{ id: number; creadaEn: Date }>(`
        INSERT INTO "SolicitudCredito" ("idCredito", "idEstadoSolicitud", "idEvidencia")
        SELECT $1, "idEstadoSolicitud", $2 FROM "EstadoSolicitud" WHERE "estadoSolicitud" = 'recibida'
        RETURNING "idSolicitudCredito" AS id, "fechaSolicitud" AS "creadaEn"
      `, [datos.creditoId, evidencia.id]);
      await tx.consultar(
        'INSERT INTO "UsuarioCredito" ("idSolicitudCredito", "idUsuario", "montoFinal") VALUES ($1, $2, $3)',
        [solicitud.rows[0].id, sesion.id, this.persistenciaCifrada.protegerCampoAsimetrico(monto)]
      );
      return {
        id: String(solicitud.rows[0].id), usuarioId: String(sesion.id), creditoId: String(datos.creditoId), montoSolicitado: monto,
        estado: 'recibida' as const, creadaEn: new Date(solicitud.rows[0].creadaEn).toISOString(), evidenciaId: evidencia.id
      };
    });
  }

  async resolverSolicitud(sesion: Sesion, id: number, estado: EstadoSolicitudCredito, confirmacion: unknown, contexto: ContextoCliente): Promise<SolicitudCredito> {
    if (!ESTADOS_RESOLUCION.includes(estado)) {
      throw new BadRequestException(`estado debe ser uno de: ${ESTADOS_RESOLUCION.join(', ')}`);
    }
    const esDecisionFinal = ESTADOS_FINALES.includes(estado);
    if (esDecisionFinal) this.noRepudio.exigirConfirmacion(confirmacion);

    await this.baseDatos.transaccion(async (tx) => {
      const actual = await tx.consultar<{ estado: EstadoSolicitudCredito }>(`
        SELECT e."estadoSolicitud" AS estado FROM "SolicitudCredito" s
        JOIN "EstadoSolicitud" e ON e."idEstadoSolicitud" = s."idEstadoSolicitud"
        WHERE s."idSolicitudCredito" = $1 FOR UPDATE OF s
      `, [id]);
      if (actual.rows.length === 0) throw new NotFoundException('solicitud de crédito no encontrada');
      if (ESTADOS_FINALES.includes(actual.rows[0].estado)) throw new ConflictException('la solicitud ya tiene una resolución final');

      const evidencia = esDecisionFinal
        ? await this.noRepudio.registrar({
          actor: sesion, accion: 'solicitud_credito.resolver', recurso: `solicitud:${id}`, datos: { solicitudId: id, estado }, contexto
        }, tx)
        : undefined;
      await tx.consultar(`
        UPDATE "SolicitudCredito" SET
          "idEstadoSolicitud" = (SELECT "idEstadoSolicitud" FROM "EstadoSolicitud" WHERE "estadoSolicitud" = $2),
          "idAdminRiesgo" = $3, "idUsuarioGestor" = $4, "idEvidenciaResolucion" = COALESCE($5, "idEvidenciaResolucion")
        WHERE "idSolicitudCredito" = $1
      `, [id, estado, sesion.cuenta === 'administrador_riesgo' ? sesion.id : null, sesion.cuenta === 'usuario' ? sesion.id : null, evidencia?.id ?? null]);
    });
    const solicitudes = await this.listarSolicitudes({ tipo: 'todos' });
    return solicitudes.find((solicitud) => solicitud.id === String(id))!;
  }

  // Obligaciones que impiden cerrar la cuenta (ver Términos y Condiciones, sección 7).
  async obligacionesPendientes(usuarioId: number, ejecutor: Ejecutor): Promise<ObligacionesPendientes> {
    const deudas = await ejecutor.consultar<{ total: string }>('SELECT count(*) AS total FROM "Deuda" WHERE "idUsuario" = $1', [usuarioId]);
    const solicitudes = await ejecutor.consultar<{ estado: string; montoAcumulado: string | null; montoFinal: string | null }>(`
      SELECT e."estadoSolicitud" AS estado, uc."montoAcumulado", uc."montoFinal"
      FROM "UsuarioCredito" uc
      JOIN "SolicitudCredito" s ON s."idSolicitudCredito" = uc."idSolicitudCredito"
      JOIN "EstadoSolicitud" e ON e."idEstadoSolicitud" = s."idEstadoSolicitud"
      WHERE uc."idUsuario" = $1
    `, [usuarioId]);
    let creditosVigentes = 0;
    let solicitudesEnCurso = 0;
    for (const fila of solicitudes.rows) {
      if (fila.estado === 'recibida' || fila.estado === 'en_evaluacion') solicitudesEnCurso += 1;
      if (fila.estado === 'aprobada') {
        const acumulado = Number(this.persistenciaCifrada.revelarCampo<number>(fila.montoAcumulado) ?? 0);
        const total = Number(this.persistenciaCifrada.revelarCampo<number>(fila.montoFinal) ?? 0);
        if (acumulado < total) creditosVigentes += 1;
      }
    }
    return { deudas: Number(deudas.rows[0].total), creditosVigentes, solicitudesEnCurso };
  }

  // ---------------------------------------------------------------- utilidades

  private async insertarConUsuario<T extends import('pg').QueryResultRow>(consulta: string, parametros: unknown[]) {
    try {
      return await this.baseDatos.consultar<T>(consulta, parametros);
    } catch (error) {
      if ((error as { code?: string }).code === '23503') throw new NotFoundException('usuario no encontrado');
      throw error;
    }
  }

  private mapearTransaccion(fila: TransaccionRow): Transaccion {
    return {
      id: String(fila.id), usuarioId: String(fila.usuarioId), tarjetaId: String(fila.tarjetaId),
      monto: this.numero(fila.monto) ?? 0, creadaEn: fecha(fila.creadaEn), evidenciaId: fila.evidenciaId ?? undefined
    };
  }

  private mapearDeuda(fila: DeudaRow): Deuda {
    return { id: String(fila.id), usuarioId: String(fila.usuarioId), monto: this.numero(fila.monto) ?? 0, creadaEn: fecha(fila.creadaEn) };
  }

  private mapearRiesgo(fila: RiesgoRow): ConsultaRiesgo {
    const tiempoDeMorosidad = this.persistenciaCifrada.revelarCampo<string>(fila.tiempoDeMorosidad) ?? undefined;
    const tiempoEnDeuda = this.persistenciaCifrada.revelarCampo<string>(fila.tiempoEnDeuda) ?? undefined;
    return {
      id: String(fila.id), usuarioId: String(fila.usuarioId), score: this.numero(fila.score),
      morosidad: this.persistenciaCifrada.revelarCampo<boolean>(fila.morosidad) ?? false,
      tiempoDeMorosidad, tiempoDeMorosidadEtiqueta: etiquetaTramoDias(tiempoDeMorosidad),
      tiempoEnDeuda, tiempoEnDeudaEtiqueta: etiquetaTramoDias(tiempoEnDeuda),
      consultadaEn: fecha(fila.consultadaEn)
    };
  }

  private mapearCredito(fila: CreditoRow): Credito {
    return { id: String(fila.id), monto: this.numero(fila.monto) ?? 0, tasaInteres: this.numero(fila.tasaInteres) ?? 0 };
  }

  private mapearSolicitud(fila: SolicitudRow): SolicitudCredito {
    return {
      id: String(fila.id), usuarioId: String(fila.usuarioId), creditoId: String(fila.creditoId),
      montoSolicitado: this.numero(fila.montoSolicitado) ?? 0, estado: fila.estado, creadaEn: fecha(fila.creadaEn),
      evidenciaId: fila.evidenciaId ?? undefined, evidenciaResolucionId: fila.evidenciaResolucionId ?? undefined
    };
  }

  private numero(valor: string | null): number | undefined {
    const resultado = this.persistenciaCifrada.revelarCampo<number>(valor);
    return resultado === null ? undefined : Number(resultado);
  }
}

interface TransaccionRow { id: number; usuarioId: number; tarjetaId: number; monto: string; creadaEn: Date | string; evidenciaId: string | null; }
interface DeudaRow { id: number; usuarioId: number; monto: string; creadaEn: Date | string; }
interface VerificacionRow { id: number; usuarioId: number; estado: EstadoVerificacion; metodo: string | null; fechaVerificacion: Date | null; fechaExpiracion: Date | null; }
interface RiesgoRow { id: number; usuarioId: number; score: string | null; morosidad: string | null; tiempoDeMorosidad: string | null; tiempoEnDeuda: string | null; consultadaEn: Date | string; }
interface CreditoRow { id: number; monto: string; tasaInteres: string; }
interface SolicitudRow { id: number; usuarioId: number; creditoId: number; montoSolicitado: string; estado: EstadoSolicitudCredito; creadaEn: Date | string; evidenciaId: string | null; evidenciaResolucionId: string | null; }

function mapearVerificacion(fila: VerificacionRow): CasoVerificacion {
  return {
    id: String(fila.id), usuarioId: String(fila.usuarioId), estado: fila.estado, metodo: fila.metodo ?? undefined,
    fechaVerificacion: fila.fechaVerificacion ? fecha(fila.fechaVerificacion) : undefined,
    fechaExpiracion: fila.fechaExpiracion ? fecha(fila.fechaExpiracion) : undefined
  };
}

function fecha(valor: Date | string): string {
  return new Date(valor).toISOString();
}
