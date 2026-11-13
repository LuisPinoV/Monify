import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BaseDatos } from '../../base-datos';
import { PersistenciaCifrada } from '../../seguridad/persistencia-cifrada';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import type { Sesion } from '../autorizacion/roles';
import { MAXIMO_INTENTOS_FALLIDOS, MINUTOS_BLOQUEO_TEMPORAL } from '../terminos/terminos';
import { ServicioAuditoria, type ActorAuditoria } from './servicio-auditoria';

/**
 * Actividad 7, punto 4: alertas de acceso anómalo.
 *  A1  3 logins fallidos en 15 min en la misma cuenta, o 10 fallos en cuentas distintas desde el mismo dispositivo en 10 min
 *      -> bloqueo temporal y aviso al titular. La cuenta queda bloqueada 15 minutos (se levanta sola) y el dispositivo, 10 minutos.
 *  A2  Un operador o administrador de riesgo consulta más de 20 titulares distintos en 10 min -> alerta al Auditor y revisión de sesión.
 *  A3  Login desde un canal o dispositivo nuevo seguido de una operación sensible en menos de 30 min -> verificación adicional
 *      (el titular debe volver a ingresar su contraseña; para el personal, alerta al Auditor).
 *  A4  5 o más accesos denegados (403) del mismo actor en 10 min -> alerta al Auditor.
 * Las reglas se calculan sobre la propia bitácora (UserLogs), así que no necesitan contadores aparte.
 */
export const REGLAS_ALERTA = {
  A1: { nombre: 'Fuerza bruta en el login', severidad: 'media' as const, fallosCuenta: MAXIMO_INTENTOS_FALLIDOS, minutosCuenta: MINUTOS_BLOQUEO_TEMPORAL, fallosDispositivo: 10, minutosDispositivo: 10 },
  A2: { nombre: 'Consulta masiva de perfiles', severidad: 'alta' as const, maximoTitulares: 20, minutos: 10 },
  A3: { nombre: 'Operación sensible desde un dispositivo nuevo', severidad: 'media' as const, minutos: 30 },
  A4: { nombre: 'Accesos denegados repetidos', severidad: 'media' as const, minimoDenegados: 5, minutos: 10 }
};

export type CodigoAlerta = keyof typeof REGLAS_ALERTA;
const ROLES_ACCESO_MASIVO = ['operador_financiero', 'administrador_riesgo'];

export interface Alerta {
  id: string;
  codigo: string;
  nombre: string;
  severidad: string;
  usuarioId: string | null;
  adminRiesgoId: string | null;
  canal: string;
  dispositivo: string;
  descripcion: string;
  accionTomada: string;
  evidencia: Record<string, unknown> | null;
  estado: string;
  creadaEn: string;
  revisadaEn: string | null;
  revisadaPor: string | null;
  notaRevision: string | null;
}

interface FilaAlerta {
  idAlerta: string; codigo: string; severidad: string; idUsuario: number | null; idAdminRiesgo: number | null; canal: string; dispositivo: string;
  descripcion: string; accionTomada: string; evidencia: string | null; estado: string; creadaEn: Date; revisadaEn: Date | null;
  revisadaPor: string | null; notaRevision: string | null;
}

const columnaActor = (actor: ActorAuditoria) => (actor.cuenta === 'usuario' ? '"idUsuario"' : '"idAdminRiesgo"');

@Injectable()
export class ServicioAlertas {
  private readonly logger = new Logger(ServicioAlertas.name);

  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly persistenciaCifrada: PersistenciaCifrada,
    private readonly auditoria: ServicioAuditoria
  ) {}

  // ---------------------------------------------------------------- A1: login

  // Bloqueo temporal por dispositivo: 10 fallos de login en cuentas distintas desde el mismo dispositivo en 10 minutos.
  async dispositivoBloqueado(contexto: ContextoCliente): Promise<Date | null> {
    const regla = REGLAS_ALERTA.A1;
    const r = await this.baseDatos.consultar<{ cuentas: number; primero: Date | null }>(`
      SELECT count(DISTINCT COALESCE('u' || "idUsuario", 'a' || "idAdminRiesgo", "uniqueID"::text))::int AS cuentas, min("fechaAccion") AS primero
      FROM "UserLogs"
      WHERE "accion" = 'auth.login' AND "resultado" = 'fallo' AND "dispositivo" = $1
        AND "fechaAccion" > now() - make_interval(mins => $2)
    `, [contexto.dispositivo, regla.minutosDispositivo]);
    const fila = r.rows[0];
    if (!fila || fila.cuentas < regla.fallosDispositivo || !fila.primero) return null;
    return new Date(new Date(fila.primero).getTime() + regla.minutosDispositivo * 60_000);
  }

  // Bloqueo temporal de la cuenta: 3 fallos en 15 minutos posteriores al último login exitoso. Devuelve hasta cuándo dura.
  async rafagaFallosCuenta(actor: ActorAuditoria): Promise<Date | null> {
    const regla = REGLAS_ALERTA.A1;
    const columna = columnaActor(actor);
    const r = await this.baseDatos.consultar<{ fechaAccion: Date }>(`
      SELECT "fechaAccion" FROM "UserLogs"
      WHERE "accion" = 'auth.login' AND "resultado" = 'fallo' AND ${columna} = $1
        AND "fechaAccion" > now() - make_interval(mins => $2)
        AND "secuencia" > COALESCE((SELECT max("secuencia") FROM "UserLogs" WHERE "accion" = 'auth.login' AND "resultado" = 'exito' AND ${columna} = $1), 0)
      ORDER BY "secuencia" DESC LIMIT $3
    `, [actor.id, regla.minutosCuenta, regla.fallosCuenta]);
    if (r.rows.length < regla.fallosCuenta) return null;
    const tercero = r.rows[regla.fallosCuenta - 1].fechaAccion;
    return new Date(new Date(tercero).getTime() + regla.minutosCuenta * 60_000);
  }

  // Se llama después de registrar cada login fallido.
  async evaluarLoginFallido(actor: ActorAuditoria | null, contexto: ContextoCliente): Promise<void> {
    try {
      const regla = REGLAS_ALERTA.A1;
      if (actor) {
        const hasta = await this.rafagaFallosCuenta(actor);
        if (hasta) {
          await this.crear('A1', actor, contexto, {
            descripcion: `${regla.fallosCuenta} o más logins fallidos en ${regla.minutosCuenta} minutos en la misma cuenta`,
            accionTomada: `Cuenta bloqueada temporalmente hasta ${hasta.toISOString()} (se levanta sola a los ${regla.minutosCuenta} minutos); aviso al titular por correo (simulado: el proyecto no tiene servidor de correo)`,
            evidencia: { regla: 'cuenta', bloqueadaHasta: hasta.toISOString() }, ventanaMinutos: regla.minutosCuenta
          });
          if (actor.cuenta === 'usuario') {
            await this.auditoria.intentarRegistrar({ actor, accion: 'alerta.aviso_titular', resultado: 'exito', contexto, detalle: { alerta: 'A1', medio: 'correo (simulado)' } });
          }
        }
      }
      const hastaDispositivo = await this.dispositivoBloqueado(contexto);
      if (hastaDispositivo) {
        await this.crear('A1', null, contexto, {
          descripcion: `${regla.fallosDispositivo} o más logins fallidos en cuentas distintas desde el mismo dispositivo en ${regla.minutosDispositivo} minutos`,
          accionTomada: `Dispositivo bloqueado temporalmente para iniciar sesión hasta ${hastaDispositivo.toISOString()}`,
          evidencia: { regla: 'dispositivo', bloqueadoHasta: hastaDispositivo.toISOString() }, ventanaMinutos: regla.minutosDispositivo
        });
      }
    } catch (error) {
      this.logger.error(`No se pudo evaluar la alerta A1: ${(error as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- A3: dispositivo nuevo

  // Último login exitoso de la cuenta, si fue hace menos de 30 minutos desde un canal/dispositivo nunca usado antes
  // por esa cuenta (y la cuenta ya tenía logins previos) y todavía no pasó la verificación adicional.
  async loginNuevoSinVerificar(actor: ActorAuditoria): Promise<{ secuencia: string; fecha: Date; canal: string; dispositivo: string } | null> {
    const columna = columnaActor(actor);
    const r = await this.baseDatos.consultar<{ secuencia: string; fechaAccion: Date; canal: string; dispositivo: string; previos: number; mismo: number; verificado: number }>(`
      WITH ultimo AS (
        SELECT "secuencia", "fechaAccion", "canal", "dispositivo" FROM "UserLogs"
        WHERE "accion" = 'auth.login' AND "resultado" = 'exito' AND ${columna} = $1
        ORDER BY "secuencia" DESC LIMIT 1
      )
      SELECT u."secuencia", u."fechaAccion", u."canal", u."dispositivo",
        (SELECT count(*) FROM "UserLogs" l WHERE l."accion" = 'auth.login' AND l."resultado" = 'exito' AND l.${columna} = $1 AND l."secuencia" < u."secuencia")::int AS previos,
        (SELECT count(*) FROM "UserLogs" l WHERE l."accion" = 'auth.login' AND l."resultado" = 'exito' AND l.${columna} = $1 AND l."secuencia" < u."secuencia"
           AND l."canal" = u."canal" AND l."dispositivo" = u."dispositivo")::int AS mismo,
        (SELECT count(*) FROM "UserLogs" l WHERE l."accion" = 'auth.verificacion_adicional' AND l."resultado" = 'exito' AND l.${columna} = $1
           AND l."secuencia" > u."secuencia")::int AS verificado
      FROM ultimo u WHERE u."fechaAccion" > now() - make_interval(mins => $2)
    `, [actor.id, REGLAS_ALERTA.A3.minutos]);
    const fila = r.rows[0];
    if (!fila || fila.previos === 0 || fila.mismo > 0 || fila.verificado > 0) return null;
    return { secuencia: String(fila.secuencia), fecha: new Date(fila.fechaAccion), canal: fila.canal, dispositivo: fila.dispositivo };
  }

  // Titular: transacción, alta de tarjeta, solicitud de crédito o cambio de datos tras un login desde un dispositivo nuevo.
  async exigirVerificacionAdicional(sesion: Sesion, contexto: ContextoCliente, operacion: string): Promise<void> {
    const login = await this.loginNuevoSinVerificar(sesion);
    if (!login) return;
    await this.crearA3(sesion, contexto, login, operacion, 'Operación detenida hasta que el titular vuelva a ingresar su contraseña (POST /auth/verificacion-adicional)');
    throw new ForbiddenException({
      statusCode: 403, error: 'Forbidden', codigo: 'VERIFICACION_ADICIONAL_REQUERIDA',
      message: 'iniciaste sesión desde un dispositivo nuevo: confirma tu contraseña para realizar esta operación'
    });
  }

  // ---------------------------------------------------------------- A4: accesos denegados

  // Se llama después de registrar un acceso denegado (403) de una sesión.
  async evaluarDenegaciones(actor: ActorAuditoria, contexto: ContextoCliente): Promise<void> {
    try {
      const regla = REGLAS_ALERTA.A4;
      const columna = columnaActor(actor);
      const r = await this.baseDatos.consultar<{ denegados: number }>(`
        SELECT count(*)::int AS denegados FROM "UserLogs"
        WHERE ${columna} = $1 AND "resultado" = 'denegado' AND "accion" <> 'auth.login' AND "fechaAccion" > now() - make_interval(mins => $2)
      `, [actor.id, regla.minutos]);
      const denegados = r.rows[0]?.denegados ?? 0;
      if (denegados >= regla.minimoDenegados) {
        await this.crear('A4', actor, contexto, {
          descripcion: `${denegados} accesos denegados (403) del mismo actor en ${regla.minutos} minutos (umbral ${regla.minimoDenegados})`,
          accionTomada: 'Alerta al Auditor para revisar si el actor intenta acceder a datos o funciones que su rol no permite',
          evidencia: { denegados, ventanaMinutos: regla.minutos }, ventanaMinutos: regla.minutos
        });
      }
    } catch (error) {
      this.logger.error(`No se pudo evaluar la alerta A4: ${(error as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- A2 y A3 del personal

  // Se llama después de registrar un acceso del personal a datos de un titular.
  async evaluarAccesoPersonal(sesion: Sesion, contexto: ContextoCliente, operacion: string): Promise<void> {
    if (!ROLES_ACCESO_MASIVO.includes(sesion.rol)) return;
    try {
      const regla = REGLAS_ALERTA.A2;
      const columna = columnaActor(sesion);
      const r = await this.baseDatos.consultar<{ titulares: number }>(`
        SELECT count(DISTINCT substring("recurso" from 'titular:([0-9]+)'))::int AS titulares FROM "UserLogs"
        WHERE ${columna} = $1 AND "recurso" LIKE '%titular:%' AND "fechaAccion" > now() - make_interval(mins => $2)
      `, [sesion.id, regla.minutos]);
      const titulares = r.rows[0]?.titulares ?? 0;
      if (titulares > regla.maximoTitulares) {
        await this.crear('A2', sesion, contexto, {
          descripcion: `${sesion.rol === 'operador_financiero' ? 'Operador financiero' : 'Administrador de riesgo'} consultó ${titulares} titulares distintos en ${regla.minutos} minutos (máximo ${regla.maximoTitulares})`,
          accionTomada: 'Alerta al Auditor y revisión de la sesión; el Admin puede revocar las sesiones y bloquear la cuenta (POST /admin/contencion)',
          evidencia: { titulares, ventanaMinutos: regla.minutos }, ventanaMinutos: regla.minutos
        });
      }
      const login = await this.loginNuevoSinVerificar(sesion);
      if (login) await this.crearA3(sesion, contexto, login, operacion, 'Alerta al Auditor: el personal accede a datos de titulares desde un dispositivo nuevo');
    } catch (error) {
      this.logger.error(`No se pudo evaluar A2/A3: ${(error as Error).message}`);
    }
  }

  private async crearA3(actor: ActorAuditoria, contexto: ContextoCliente, login: { secuencia: string; fecha: Date; canal: string; dispositivo: string }, operacion: string, accionTomada: string) {
    // Una sola alerta A3 por login.
    const columna = columnaActor(actor);
    const existe = await this.baseDatos.consultar(
      `SELECT 1 FROM "AlertaSeguridad" WHERE "codigo" = 'A3' AND ${columna} = $1 AND "creadaEn" >= $2`, [actor.id, login.fecha]
    );
    if ((existe.rowCount ?? 0) > 0) return;
    const minutos = Math.round((Date.now() - login.fecha.getTime()) / 60_000);
    await this.crear('A3', actor, contexto, {
      descripcion: `Login desde un canal o dispositivo nuevo (${login.canal} / ${login.dispositivo}) seguido de una operación sensible (${operacion}) a los ${minutos} minutos`,
      accionTomada, evidencia: { loginSecuencia: login.secuencia, operacion }
    });
  }

  // ---------------------------------------------------------------- registro y consulta

  private async crear(codigo: CodigoAlerta, actor: ActorAuditoria | null, contexto: ContextoCliente, datos: {
    descripcion: string; accionTomada: string; evidencia?: Record<string, unknown>; ventanaMinutos?: number;
  }): Promise<void> {
    const usuarioId = actor?.cuenta === 'usuario' ? actor.id : null;
    const adminId = actor?.cuenta === 'administrador_riesgo' ? actor.id : null;
    if (datos.ventanaMinutos) {
      // No se repite la misma alerta abierta para el mismo actor (o dispositivo) dentro de la ventana de la regla.
      const repetida = await this.baseDatos.consultar(`
        SELECT 1 FROM "AlertaSeguridad"
        WHERE "codigo" = $1 AND "estado" = 'abierta' AND "creadaEn" > now() - make_interval(mins => $2)
          AND "idUsuario" IS NOT DISTINCT FROM $3 AND "idAdminRiesgo" IS NOT DISTINCT FROM $4 AND ($3::int IS NOT NULL OR $4::int IS NOT NULL OR "dispositivo" = $5)
      `, [codigo, datos.ventanaMinutos, usuarioId, adminId, contexto.dispositivo]);
      if ((repetida.rowCount ?? 0) > 0) return;
    }
    const r = await this.baseDatos.consultar<{ id: string }>(`
      INSERT INTO "AlertaSeguridad" ("codigo", "severidad", "idUsuario", "idAdminRiesgo", "canal", "dispositivo", "descripcion", "accionTomada", "evidencia")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING "idAlerta" AS id
    `, [codigo, REGLAS_ALERTA[codigo].severidad, usuarioId, adminId, contexto.canal, contexto.dispositivo, datos.descripcion, datos.accionTomada,
      datos.evidencia ? this.persistenciaCifrada.protegerCampo(datos.evidencia) : null]);
    await this.auditoria.intentarRegistrar({
      actor, accion: `alerta.${codigo}`, resultado: 'exito', contexto, recurso: `alerta:${r.rows[0].id}`, detalle: { regla: REGLAS_ALERTA[codigo].nombre }
    });
  }

  async listar(filtros: { estado?: string; codigo?: string; limite?: number } = {}): Promise<Alerta[]> {
    const r = await this.baseDatos.consultar<FilaAlerta>(`
      SELECT * FROM "AlertaSeguridad"
      WHERE ($1::varchar IS NULL OR "estado" = $1) AND ($2::varchar IS NULL OR "codigo" = $2)
      ORDER BY "idAlerta" DESC LIMIT $3
    `, [filtros.estado ?? null, filtros.codigo ?? null, Math.min(Math.max(Math.trunc(filtros.limite ?? 200), 1), 500)]);
    return r.rows.map((f) => this.vista(f));
  }

  async revisar(sesion: Sesion, id: number, datos: { estado?: unknown; nota?: unknown }): Promise<Alerta> {
    if (datos.estado !== 'revisada' && datos.estado !== 'cerrada') throw new BadRequestException("estado debe ser 'revisada' o 'cerrada'");
    if (datos.nota !== undefined && typeof datos.nota !== 'string') throw new BadRequestException('nota debe ser texto');
    try {
      const r = await this.baseDatos.consultar<FilaAlerta>(`
        UPDATE "AlertaSeguridad" SET "estado" = $2, "revisadaEn" = now(), "revisadaPor" = $3, "notaRevision" = COALESCE($4, "notaRevision")
        WHERE "idAlerta" = $1 RETURNING *
      `, [id, datos.estado, `${sesion.rol}:${sesion.id}`, typeof datos.nota === 'string' ? datos.nota.slice(0, 500) : null]);
      if (r.rows.length === 0) throw new NotFoundException('alerta no encontrada');
      return this.vista(r.rows[0]);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ConflictException((error as Error).message.split('\n')[0]);
    }
  }

  private vista(f: FilaAlerta): Alerta {
    const iso = (v: Date | null) => (v ? new Date(v).toISOString() : null);
    return {
      id: String(f.idAlerta), codigo: f.codigo, nombre: REGLAS_ALERTA[f.codigo as CodigoAlerta]?.nombre ?? f.codigo, severidad: f.severidad,
      usuarioId: f.idUsuario === null ? null : String(f.idUsuario), adminRiesgoId: f.idAdminRiesgo === null ? null : String(f.idAdminRiesgo),
      canal: f.canal, dispositivo: f.dispositivo, descripcion: f.descripcion, accionTomada: f.accionTomada,
      evidencia: this.persistenciaCifrada.revelarCampo<Record<string, unknown>>(f.evidencia), estado: f.estado,
      creadaEn: iso(f.creadaEn)!, revisadaEn: iso(f.revisadaEn), revisadaPor: f.revisadaPor, notaRevision: f.notaRevision
    };
  }
}

export class BloqueoTemporalException extends HttpException {
  constructor(mensaje: string, hasta: Date) {
    super({ statusCode: 429, error: 'Too Many Requests', codigo: 'BLOQUEO_TEMPORAL', bloqueadoHasta: hasta.toISOString(), message: mensaje }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
