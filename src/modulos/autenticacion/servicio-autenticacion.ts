import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { BaseDatos, type Ejecutor } from '../../base-datos';
import { PersistenciaCifrada } from '../../seguridad/persistencia-cifrada';
import { ServicioHash } from '../../seguridad/servicio-hash';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { ServicioAuditoria } from '../auditoria/servicio-auditoria';
import { rolDesdeCodigo, type Rol, type Sesion, type TipoCuenta } from '../autorizacion/roles';
import { ServicioConsentimientos } from '../terminos/servicio-consentimientos';
import { MAXIMO_INTENTOS_FALLIDOS } from '../terminos/terminos';

export const HORAS_VIGENCIA_CONTRASENA_ADMIN = 24;
const MENSAJE_CREDENCIALES = 'correo o contraseña incorrectos';

export interface RespuestaLogin {
  accessToken: string;
  usuario: { id: string; cuenta: TipoCuenta; rol: Rol };
  requiereAceptarTerminos: boolean;
  contrasenaExpiraEn?: string;
}

interface CredencialEncontrada {
  id: number;
  cuenta: TipoCuenta;
  rol: Rol;
  contrasenaHash: string;
  intentosFallidos: number;
  bloqueada: boolean;
  expiraEn?: Date;
}

interface FilaUsuarioLogin {
  id: number;
  codigoRol: string;
  contrasenaHash: string;
  intentosFallidos: number;
  bloqueada: boolean;
  estadoCuenta: string;
}

interface FilaAdminLogin {
  id: number;
  contrasenaHash: string;
  intentosFallidos: number;
  bloqueada: boolean;
  expiraEn: Date;
}

export function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

@Injectable()
export class ServicioAutenticacion {
  private hashFicticio?: string;

  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly hash: ServicioHash,
    private readonly jwt: JwtService,
    private readonly persistenciaCifrada: PersistenciaCifrada,
    private readonly auditoria: ServicioAuditoria,
    private readonly consentimientos: ServicioConsentimientos
  ) {}

  async crearCredencial(usuarioId: number, contrasena: string, ejecutor: Ejecutor = this.baseDatos): Promise<void> {
    const contrasenaHash = await this.hash.hash(contrasena);
    await ejecutor.consultar(`
      INSERT INTO "CredAuthUser" ("idUsuario", "contraseña")
      VALUES ($1, $2)
      ON CONFLICT ("idUsuario") DO UPDATE SET "contraseña" = EXCLUDED."contraseña", "intentosFallidos" = 0
    `, [usuarioId, contrasenaHash]);
  }

  // La contraseña del administrador de riesgo solo se conserva 24 horas.
  async crearCredencialAdministrador(adminId: number, contrasena: string, ejecutor: Ejecutor = this.baseDatos): Promise<void> {
    const contrasenaHash = await this.hash.hash(contrasena);
    await ejecutor.consultar(`
      INSERT INTO "CredAuthAdministrador" ("idAdminRiesgo", "contraseña", "expiraEn")
      VALUES ($1, $2, now() + make_interval(hours => $3))
      ON CONFLICT ("idAdminRiesgo") DO UPDATE
        SET "contraseña" = EXCLUDED."contraseña", "expiraEn" = EXCLUDED."expiraEn", "intentosFallidos" = 0
    `, [adminId, contrasenaHash, HORAS_VIGENCIA_CONTRASENA_ADMIN]);
  }

  async iniciarSesion(correo: string, contrasena: string, contexto: ContextoCliente): Promise<RespuestaLogin> {
    const credencial = await this.buscarCredencial(this.persistenciaCifrada.indiceBusqueda(normalizarCorreo(correo)));
    if (!credencial) {
      // Se compara contra un hash falso para que el tiempo de respuesta no revele si el correo existe.
      this.hashFicticio ??= await this.hash.hash(randomBytes(16).toString('hex'));
      await this.hash.compare(contrasena, this.hashFicticio);
      await this.auditoria.intentarRegistrar({ accion: 'auth.login', resultado: 'fallo', contexto, detalle: { motivo: 'cuenta_inexistente' } });
      throw new UnauthorizedException(MENSAJE_CREDENCIALES);
    }

    const actor = { id: credencial.id, cuenta: credencial.cuenta };
    const coincide = await this.hash.compare(contrasena, credencial.contrasenaHash);
    if (!coincide) {
      await this.registrarIntentoFallido(credencial, contexto);
      throw new UnauthorizedException(MENSAJE_CREDENCIALES);
    }
    if (credencial.bloqueada) {
      await this.auditoria.intentarRegistrar({ actor, accion: 'auth.login', resultado: 'denegado', contexto, detalle: { motivo: 'cuenta_bloqueada' } });
      throw new ForbiddenException('la cuenta está bloqueada; solicita su habilitación a un administrador');
    }
    if (credencial.expiraEn && credencial.expiraEn.getTime() <= Date.now()) {
      await this.auditoria.intentarRegistrar({ actor, accion: 'auth.login', resultado: 'denegado', contexto, detalle: { motivo: 'contrasena_expirada' } });
      throw new ForbiddenException('la contraseña expiró (vigencia de 24 horas); solicita un restablecimiento a un administrador');
    }

    await this.reiniciarIntentos(credencial);
    const accessToken = await this.jwt.signAsync({ sub: String(credencial.id), cuenta: credencial.cuenta, rol: credencial.rol });
    await this.auditoria.registrar({ actor, accion: 'auth.login', resultado: 'exito', contexto });
    return {
      accessToken,
      usuario: { id: String(credencial.id), cuenta: credencial.cuenta, rol: credencial.rol },
      requiereAceptarTerminos: credencial.rol === 'usuario' && !(await this.consentimientos.terminosVigentes(credencial.id)),
      contrasenaExpiraEn: credencial.expiraEn?.toISOString()
    };
  }

  // Resuelve la sesión con datos frescos de la base: un bloqueo o cambio de rol aplica de inmediato, aunque el token siga vigente.
  async resolverSesion(payload: { sub?: string; cuenta?: string }): Promise<Sesion | null> {
    const id = Number(payload.sub);
    if (!Number.isInteger(id)) return null;
    if (payload.cuenta === 'administrador_riesgo') {
      const admin = await this.baseDatos.consultar<{ flagAcc: boolean }>('SELECT "flagAcc" FROM "AdministradorRiesgo" WHERE "idAdminRiesgo" = $1', [id]);
      return admin.rows[0] && !admin.rows[0].flagAcc ? { id, cuenta: 'administrador_riesgo', rol: 'administrador_riesgo' } : null;
    }
    if (payload.cuenta !== 'usuario') return null;
    const usuario = await this.baseDatos.consultar<{ codigoRol: string; bloqueado: boolean; estadoCuenta: string }>(`
      SELECT r."codigoRol", u."isAccessBlocked" AS bloqueado, u."estadoCuenta"
      FROM "Usuario" u JOIN "Rol" r ON r."idRol" = u."idRol" WHERE u."idUsuario" = $1
    `, [id]);
    const fila = usuario.rows[0];
    const rol = fila ? rolDesdeCodigo(fila.codigoRol) : undefined;
    return fila && rol && !fila.bloqueado && fila.estadoCuenta === 'activa' ? { id, cuenta: 'usuario', rol } : null;
  }

  async verificarContrasena(sesion: Sesion, contrasena: string): Promise<boolean> {
    const tabla = sesion.cuenta === 'usuario'
      ? { nombre: 'CredAuthUser', columna: 'idUsuario' }
      : { nombre: 'CredAuthAdministrador', columna: 'idAdminRiesgo' };
    const resultado = await this.baseDatos.consultar<{ contrasenaHash: string }>(
      `SELECT "contraseña" AS "contrasenaHash" FROM "${tabla.nombre}" WHERE "${tabla.columna}" = $1`, [sesion.id]
    );
    return resultado.rows[0] ? this.hash.compare(contrasena, resultado.rows[0].contrasenaHash) : false;
  }

  private async buscarCredencial(hashCorreo: string): Promise<CredencialEncontrada | null> {
    const usuario = await this.baseDatos.consultar<FilaUsuarioLogin>(`
      SELECT u."idUsuario" AS id, r."codigoRol", c."contraseña" AS "contrasenaHash", c."intentosFallidos",
             u."isAccessBlocked" AS bloqueada, u."estadoCuenta"
      FROM "Usuario" u
      JOIN "CredAuthUser" c ON c."idUsuario" = u."idUsuario"
      JOIN "Rol" r ON r."idRol" = u."idRol"
      WHERE u."emailHash" = $1
    `, [hashCorreo]);
    const filaUsuario = usuario.rows[0];
    if (filaUsuario) {
      const rol = rolDesdeCodigo(filaUsuario.codigoRol);
      if (!rol || filaUsuario.estadoCuenta !== 'activa') return null;
      return {
        id: filaUsuario.id, cuenta: 'usuario', rol, contrasenaHash: filaUsuario.contrasenaHash,
        intentosFallidos: filaUsuario.intentosFallidos, bloqueada: filaUsuario.bloqueada
      };
    }
    const administrador = await this.baseDatos.consultar<FilaAdminLogin>(`
      SELECT a."idAdminRiesgo" AS id, c."contraseña" AS "contrasenaHash", c."intentosFallidos",
             a."flagAcc" AS bloqueada, c."expiraEn"
      FROM "AdministradorRiesgo" a
      JOIN "CredAuthAdministrador" c ON c."idAdminRiesgo" = a."idAdminRiesgo"
      WHERE a."emailHash" = $1
    `, [hashCorreo]);
    const filaAdmin = administrador.rows[0];
    return filaAdmin
      ? {
        id: filaAdmin.id, cuenta: 'administrador_riesgo', rol: 'administrador_riesgo', contrasenaHash: filaAdmin.contrasenaHash,
        intentosFallidos: filaAdmin.intentosFallidos, bloqueada: filaAdmin.bloqueada, expiraEn: new Date(filaAdmin.expiraEn)
      }
      : null;
  }

  private tablaCredenciales(cuenta: TipoCuenta) {
    return cuenta === 'usuario'
      ? { credenciales: 'CredAuthUser', cuentas: 'Usuario', columnaId: 'idUsuario', columnaBloqueo: 'isAccessBlocked' }
      : { credenciales: 'CredAuthAdministrador', cuentas: 'AdministradorRiesgo', columnaId: 'idAdminRiesgo', columnaBloqueo: 'flagAcc' };
  }

  private async registrarIntentoFallido(credencial: CredencialEncontrada, contexto: ContextoCliente): Promise<void> {
    const tabla = this.tablaCredenciales(credencial.cuenta);
    const actor = { id: credencial.id, cuenta: credencial.cuenta };
    const resultado = await this.baseDatos.consultar<{ intentosFallidos: number }>(
      `UPDATE "${tabla.credenciales}" SET "intentosFallidos" = "intentosFallidos" + 1 WHERE "${tabla.columnaId}" = $1 RETURNING "intentosFallidos"`,
      [credencial.id]
    );
    const intentos = resultado.rows[0]?.intentosFallidos ?? credencial.intentosFallidos + 1;
    await this.auditoria.intentarRegistrar({ actor, accion: 'auth.login', resultado: 'fallo', contexto, detalle: { motivo: 'contrasena_incorrecta', intentos } });
    if (intentos >= MAXIMO_INTENTOS_FALLIDOS && !credencial.bloqueada) {
      await this.baseDatos.consultar(`UPDATE "${tabla.cuentas}" SET "${tabla.columnaBloqueo}" = TRUE WHERE "${tabla.columnaId}" = $1`, [credencial.id]);
      await this.auditoria.intentarRegistrar({ actor, accion: 'auth.cuenta_bloqueada', resultado: 'exito', contexto, detalle: { intentos } });
    }
  }

  private async reiniciarIntentos(credencial: CredencialEncontrada): Promise<void> {
    if (credencial.intentosFallidos === 0) return;
    const tabla = this.tablaCredenciales(credencial.cuenta);
    await this.baseDatos.consultar(`UPDATE "${tabla.credenciales}" SET "intentosFallidos" = 0 WHERE "${tabla.columnaId}" = $1`, [credencial.id]);
  }
}
