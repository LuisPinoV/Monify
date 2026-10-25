import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { BaseDatos, type Ejecutor } from '../../base-datos';
import { PersistenciaCifrada } from '../../seguridad/persistencia-cifrada';
import { ServicioSeudonimos } from '../../seguridad/servicio-seudonimos';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { generarAnonimo } from '../../utilidades/seudonimos';
import { esMayorDeEdad, etiquetaTramoRenta, tramoRenta } from '../../utilidades/tramos';
import type { PerfilCuenta, ResumenCuenta } from '../../tipos';
import { ServicioAuditoria } from '../auditoria/servicio-auditoria';
import { ServicioNoRepudio } from '../auditoria/servicio-no-repudio';
import { CODIGO_ROL, ROLES, rolDesdeCodigo, type Rol, type Sesion } from '../autorizacion/roles';
import { HORAS_VIGENCIA_CONTRASENA_ADMIN, normalizarCorreo, ServicioAutenticacion } from '../autenticacion/servicio-autenticacion';
import { ServicioBilleteras } from '../billeteras/servicio-billeteras';
import { ServicioOperacionesFinancieras } from '../operaciones-financieras/servicio-operaciones-financieras';
import { ServicioConsentimientos } from '../terminos/servicio-consentimientos';
import { FINALIDADES, SALDO_PARA_CERRAR_CUENTA, VERSION_TERMINOS } from '../terminos/terminos';

export const ROLES_PERSONAL: Rol[] = ['admin', 'administrador_riesgo', 'auditor', 'operador_financiero'];
const ROLES_CAMBIABLES: Rol[] = ['admin', 'auditor', 'operador_financiero'];
const LARGO_MINIMO_CONTRASENA = 8;
const LARGO_MAXIMO_CONTRASENA = 72; // límite de bcrypt

export interface DatosCuenta {
  nombre: string;
  correo: string;
  rut: string;
  fechaNacimiento?: string;
  rentaMensual?: number;
  numeroCelular?: string;
  contrasena: string;
}

export interface AceptacionTerminos {
  versionTerminos?: string;
  aceptaTerminos?: unknown;
  aceptaTratamientoDatos?: unknown;
}

interface FilaUsuario {
  idUsuario: number;
  codigoRol: string;
  nombreCompleto: string;
  rut: string;
  esMayorEdad: boolean;
  tramoRenta: string | null;
  numeroCelular: string | null;
  email: string;
  isAccessBlocked: boolean;
  creadoEn: Date;
}

interface FilaAdministrador {
  idAdminRiesgo: number;
  nombreCompleto: string;
  rut: string;
  numeroCelular: string | null;
  email: string;
  flagAcc: boolean;
  creadoEn: Date;
}

function validarTexto(valor: unknown, nombre: string, maximo: number): string {
  if (typeof valor !== 'string' || !valor.trim()) throw new BadRequestException(`${nombre} es obligatorio`);
  const limpio = valor.trim();
  if (limpio.length > maximo) throw new BadRequestException(`${nombre} no puede superar ${maximo} caracteres`);
  return limpio;
}

export function validarContrasena(contrasena: unknown): string {
  if (typeof contrasena !== 'string' || contrasena.length < LARGO_MINIMO_CONTRASENA) {
    throw new BadRequestException(`la contrasena debe tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres`);
  }
  if (Buffer.byteLength(contrasena, 'utf8') > LARGO_MAXIMO_CONTRASENA) {
    throw new BadRequestException(`la contrasena no puede superar ${LARGO_MAXIMO_CONTRASENA} bytes`);
  }
  return contrasena;
}

export function normalizarRut(rut: string): string {
  return rut.replace(/[.\s]/g, '').toUpperCase();
}

@Injectable()
export class ServicioUsuarios {
  private readonly logger = new Logger(ServicioUsuarios.name);

  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly persistenciaCifrada: PersistenciaCifrada,
    private readonly seudonimos: ServicioSeudonimos,
    private readonly autenticacion: ServicioAutenticacion,
    private readonly consentimientos: ServicioConsentimientos,
    private readonly noRepudio: ServicioNoRepudio,
    private readonly auditoria: ServicioAuditoria,
    private readonly billeteras: ServicioBilleteras,
    private readonly operaciones: ServicioOperacionesFinancieras
  ) {}

  // ---------------------------------------------------------------- altas

  // Autoregistro de un titular: exige aceptar los Términos y Condiciones (queda evidencia de no repudio).
  async registrar(datos: DatosCuenta, terminos: AceptacionTerminos, contexto: ContextoCliente): Promise<PerfilCuenta> {
    if (terminos.versionTerminos !== VERSION_TERMINOS) {
      throw new BadRequestException(`versionTerminos debe ser la versión vigente (${VERSION_TERMINOS})`);
    }
    this.noRepudio.exigirConfirmacion(terminos.aceptaTerminos);
    this.noRepudio.exigirConfirmacion(terminos.aceptaTratamientoDatos);
    const id = await this.crearCuenta('usuario', datos, contexto, true);
    await this.auditoria.intentarRegistrar({ actor: { id, cuenta: 'usuario' }, accion: 'cuenta.registrar', resultado: 'exito', contexto, detalle: { rol: 'usuario' } });
    return this.obtenerPerfil({ id, cuenta: 'usuario', rol: 'usuario' });
  }

  // Alta de cuentas internas por un Admin (el autoregistro nunca puede crear personal).
  async crearCuentaPersonal(rol: Rol, datos: DatosCuenta, contexto: ContextoCliente): Promise<ResumenCuenta> {
    if (!ROLES_PERSONAL.includes(rol)) throw new BadRequestException(`rol debe ser uno de: ${ROLES_PERSONAL.join(', ')}`);
    const id = await this.crearCuenta(rol, datos, contexto, false);
    const cuenta = rol === 'administrador_riesgo' ? 'administrador_riesgo' : 'usuario';
    const resumenes = await this.listar();
    return resumenes.find((resumen) => resumen.id === String(id) && resumen.cuenta === cuenta)!;
  }

  // Crea la cuenta guardando solo seudónimos; los originales quedan en la bóveda separada.
  private async crearCuenta(rol: Rol, datos: DatosCuenta, contexto: ContextoCliente, conTerminos: boolean): Promise<number> {
    const nombre = validarTexto(datos?.nombre, 'nombre', 200);
    const correo = normalizarCorreo(validarTexto(datos?.correo, 'correo', 254));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new BadRequestException('correo no es válido');
    const rut = normalizarRut(validarTexto(datos?.rut, 'rut', 20));
    const contrasena = validarContrasena(datos?.contrasena);
    const celular = datos.numeroCelular === undefined || datos.numeroCelular === '' ? undefined : validarTexto(datos.numeroCelular, 'numeroCelular', 20);

    const esCliente = rol === 'usuario';
    let mayorEdad = true;
    let tramo: string | null = null;
    if (esCliente) {
      const mayor = typeof datos.fechaNacimiento === 'string' ? esMayorDeEdad(datos.fechaNacimiento) : null;
      if (mayor === null) throw new BadRequestException('fechaNacimiento es obligatoria y debe tener el formato AAAA-MM-DD');
      if (!mayor) throw new BadRequestException('debes ser mayor de 18 años para registrarte');
      mayorEdad = mayor;
      if (datos.rentaMensual !== undefined) {
        if (typeof datos.rentaMensual !== 'number' || !Number.isFinite(datos.rentaMensual) || datos.rentaMensual < 0) {
          throw new BadRequestException('rentaMensual debe ser un número no negativo');
        }
        // La fecha de nacimiento y la renta exacta no se almacenan: solo el indicador y el tramo.
        tramo = this.persistenciaCifrada.protegerCampo(tramoRenta(datos.rentaMensual));
      }
    }

    const rutHash = this.persistenciaCifrada.indiceBusqueda(rut);
    const emailHash = this.persistenciaCifrada.indiceBusqueda(correo);
    await this.verificarDuplicados(rutHash, emailHash);

    const creados: string[] = [];
    try {
      const seudonimoNombre = await this.seudonimizar('nombre', nombre, creados);
      const seudonimoRut = await this.seudonimizar('rut', rut, creados);
      const seudonimoCorreo = await this.seudonimizar('correo', correo, creados);
      const seudonimoCelular = celular ? await this.seudonimizar('telefono', celular, creados) : null;

      return await this.baseDatos.transaccion(async (tx) => {
        let id: number;
        if (rol === 'administrador_riesgo') {
          const admin = await tx.consultar<{ id: number }>(`
            INSERT INTO "AdministradorRiesgo" ("nombreCompleto", "rut", "rutHash", "numeroCelular", "email", "emailHash")
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING "idAdminRiesgo" AS id
          `, [seudonimoNombre, seudonimoRut, rutHash, seudonimoCelular, seudonimoCorreo, emailHash]);
          id = admin.rows[0].id;
          await this.autenticacion.crearCredencialAdministrador(id, contrasena, tx);
        } else {
          const usuario = await tx.consultar<{ id: number }>(`
            INSERT INTO "Usuario" ("idRol", "nombreCompleto", "rut", "rutHash", "esMayorEdad", "tramoRenta", "numeroCelular", "email", "emailHash")
            VALUES ((SELECT "idRol" FROM "Rol" WHERE "codigoRol" = $1), $2, $3, $4, $5, $6, $7, $8, $9) RETURNING "idUsuario" AS id
          `, [CODIGO_ROL[rol], seudonimoNombre, seudonimoRut, rutHash, mayorEdad, tramo, seudonimoCelular, seudonimoCorreo, emailHash]);
          id = usuario.rows[0].id;
          await this.autenticacion.crearCredencial(id, contrasena, tx);
        }
        if (conTerminos) {
          const evidencia = await this.noRepudio.registrar({
            actor: { id, cuenta: 'usuario' }, accion: 'terminos.aceptar', recurso: `terminos:${VERSION_TERMINOS}`,
            datos: { version: VERSION_TERMINOS }, contexto, versionTexto: VERSION_TERMINOS
          }, tx);
          for (const finalidad of [FINALIDADES.TERMINOS, FINALIDADES.DATOS]) {
            await this.consentimientos.otorgar(tx, { usuarioId: id, finalidad, canal: contexto.canal, idEvidencia: evidencia.id });
          }
        }
        return id;
      });
    } catch (error) {
      await this.seudonimos.eliminar(creados).catch((fallo: Error) => this.logger.error(`No se pudo limpiar la bóveda: ${fallo.message}`));
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('el rut o el correo ya está registrado');
      }
      throw error;
    }
  }

  private async seudonimizar(tipo: 'nombre' | 'rut' | 'correo' | 'telefono', original: string, creados: string[]): Promise<string> {
    const seudonimo = await this.seudonimos.seudonimizar(tipo, original);
    creados.push(seudonimo);
    return seudonimo;
  }

  private async verificarDuplicados(rutHash: string, emailHash: string): Promise<void> {
    const rut = await this.baseDatos.consultar(
      'SELECT 1 FROM "Usuario" WHERE "rutHash" = $1 UNION ALL SELECT 1 FROM "AdministradorRiesgo" WHERE "rutHash" = $1', [rutHash]
    );
    if ((rut.rowCount ?? 0) > 0) throw new ConflictException('el rut ya está registrado');
    const correo = await this.baseDatos.consultar(
      'SELECT 1 FROM "Usuario" WHERE "emailHash" = $1 UNION ALL SELECT 1 FROM "AdministradorRiesgo" WHERE "emailHash" = $1', [emailHash]
    );
    if ((correo.rowCount ?? 0) > 0) throw new ConflictException('el correo ya está registrado');
  }

  // ---------------------------------------------------------------- consulta

  async obtenerPerfil(sesion: Sesion): Promise<PerfilCuenta> {
    if (sesion.cuenta === 'administrador_riesgo') {
      const resultado = await this.baseDatos.consultar<FilaAdministrador>('SELECT * FROM "AdministradorRiesgo" WHERE "idAdminRiesgo" = $1', [sesion.id]);
      const fila = resultado.rows[0];
      if (!fila) throw new NotFoundException('cuenta no encontrada');
      return {
        id: String(fila.idAdminRiesgo), cuenta: 'administrador_riesgo', rol: 'administrador_riesgo',
        ...(await this.revelarDatosPersonales(fila)), bloqueada: fila.flagAcc, creadoEn: new Date(fila.creadoEn).toISOString()
      };
    }
    const resultado = await this.baseDatos.consultar<FilaUsuario>(`
      SELECT u.*, r."codigoRol" FROM "Usuario" u JOIN "Rol" r ON r."idRol" = u."idRol" WHERE u."idUsuario" = $1
    `, [sesion.id]);
    const fila = resultado.rows[0];
    const rol = fila ? rolDesdeCodigo(fila.codigoRol) : undefined;
    if (!fila || !rol) throw new NotFoundException('cuenta no encontrada');
    const tramo = this.persistenciaCifrada.revelarCampo<string>(fila.tramoRenta) ?? undefined;
    return {
      id: String(fila.idUsuario), cuenta: 'usuario', rol, ...(await this.revelarDatosPersonales(fila)),
      esMayorEdad: fila.esMayorEdad, tramoRenta: tramo, tramoRentaEtiqueta: etiquetaTramoRenta(tramo),
      bloqueada: fila.isAccessBlocked, creadoEn: new Date(fila.creadoEn).toISOString()
    };
  }

  // Lista de cuentas para el personal: solo seudónimos, sin datos personales ni financieros.
  async listar(): Promise<ResumenCuenta[]> {
    const usuarios = await this.baseDatos.consultar<{ id: number; codigoRol: string; nombre: string; bloqueada: boolean; estadoCuenta: string; creadoEn: Date }>(`
      SELECT u."idUsuario" AS id, r."codigoRol", u."nombreCompleto" AS nombre, u."isAccessBlocked" AS bloqueada, u."estadoCuenta", u."creadoEn"
      FROM "Usuario" u JOIN "Rol" r ON r."idRol" = u."idRol" ORDER BY u."idUsuario"
    `);
    const administradores = await this.baseDatos.consultar<{ id: number; nombre: string; bloqueada: boolean; creadoEn: Date }>(`
      SELECT "idAdminRiesgo" AS id, "nombreCompleto" AS nombre, "flagAcc" AS bloqueada, "creadoEn" FROM "AdministradorRiesgo" ORDER BY "idAdminRiesgo"
    `);
    return [
      ...usuarios.rows.flatMap((fila) => {
        const rol = rolDesdeCodigo(fila.codigoRol);
        return rol ? [{
          id: String(fila.id), cuenta: 'usuario' as const, rol, nombre: fila.nombre, bloqueada: fila.bloqueada,
          estadoCuenta: fila.estadoCuenta, creadoEn: new Date(fila.creadoEn).toISOString()
        }] : [];
      }),
      ...administradores.rows.map((fila) => ({
        id: String(fila.id), cuenta: 'administrador_riesgo' as const, rol: 'administrador_riesgo' as const, nombre: fila.nombre,
        bloqueada: fila.bloqueada, estadoCuenta: 'activa', creadoEn: new Date(fila.creadoEn).toISOString()
      }))
    ];
  }

  // ---------------------------------------------------------------- modificación

  async actualizarPerfil(sesion: Sesion, datos: { nombre?: string; numeroCelular?: string; rentaMensual?: number }): Promise<PerfilCuenta> {
    if (sesion.cuenta !== 'usuario') throw new ForbiddenException('tu cuenta no puede modificar su perfil');
    if (datos.nombre === undefined && datos.numeroCelular === undefined && datos.rentaMensual === undefined) {
      throw new BadRequestException('indica al menos un campo a modificar: nombre, numeroCelular o rentaMensual');
    }
    const resultado = await this.baseDatos.consultar<{ nombreCompleto: string; numeroCelular: string | null }>(
      'SELECT "nombreCompleto", "numeroCelular" FROM "Usuario" WHERE "idUsuario" = $1', [sesion.id]
    );
    const fila = resultado.rows[0];
    if (!fila) throw new NotFoundException('cuenta no encontrada');

    if (datos.nombre !== undefined) {
      await this.seudonimos.actualizar(fila.nombreCompleto, validarTexto(datos.nombre, 'nombre', 200));
    }
    if (datos.numeroCelular !== undefined) {
      const celular = validarTexto(datos.numeroCelular, 'numeroCelular', 20);
      if (fila.numeroCelular) {
        await this.seudonimos.actualizar(fila.numeroCelular, celular);
      } else {
        const seudonimo = await this.seudonimos.seudonimizar('telefono', celular);
        await this.baseDatos.consultar('UPDATE "Usuario" SET "numeroCelular" = $2 WHERE "idUsuario" = $1', [sesion.id, seudonimo]);
      }
    }
    if (datos.rentaMensual !== undefined) {
      if (sesion.rol !== 'usuario') throw new BadRequestException('solo los titulares registran renta mensual');
      if (typeof datos.rentaMensual !== 'number' || !Number.isFinite(datos.rentaMensual) || datos.rentaMensual < 0) {
        throw new BadRequestException('rentaMensual debe ser un número no negativo');
      }
      await this.baseDatos.consultar(
        'UPDATE "Usuario" SET "tramoRenta" = $2 WHERE "idUsuario" = $1',
        [sesion.id, this.persistenciaCifrada.protegerCampo(tramoRenta(datos.rentaMensual))]
      );
    }
    return this.obtenerPerfil(sesion);
  }

  async establecerBloqueo(actor: Sesion, cuenta: 'usuario' | 'administrador_riesgo', id: number, bloqueada: boolean): Promise<ResumenCuenta> {
    if (cuenta === 'usuario' && id === actor.id && actor.cuenta === 'usuario') {
      throw new BadRequestException('no puedes bloquear ni desbloquear tu propia cuenta');
    }
    const [tabla, columnaId, columnaBloqueo, credenciales] = cuenta === 'usuario'
      ? ['Usuario', 'idUsuario', 'isAccessBlocked', 'CredAuthUser']
      : ['AdministradorRiesgo', 'idAdminRiesgo', 'flagAcc', 'CredAuthAdministrador'];
    const resultado = await this.baseDatos.consultar(
      `UPDATE "${tabla}" SET "${columnaBloqueo}" = $2 WHERE "${columnaId}" = $1 ${cuenta === 'usuario' ? `AND "estadoCuenta" = 'activa'` : ''}`, [id, bloqueada]
    );
    if (resultado.rowCount === 0) throw new NotFoundException('cuenta no encontrada');
    if (!bloqueada) {
      await this.baseDatos.consultar(`UPDATE "${credenciales}" SET "intentosFallidos" = 0 WHERE "${columnaId}" = $1`, [id]);
    }
    return (await this.listar()).find((resumen) => resumen.id === String(id) && resumen.cuenta === cuenta)!;
  }

  async cambiarRol(actor: Sesion, usuarioId: number, nuevoRol: Rol): Promise<ResumenCuenta> {
    if (!ROLES.includes(nuevoRol) || !ROLES_CAMBIABLES.includes(nuevoRol)) {
      throw new BadRequestException(`solo se puede asignar uno de: ${ROLES_CAMBIABLES.join(', ')} (los titulares y administradores de riesgo tienen un tipo de cuenta propio)`);
    }
    if (usuarioId === actor.id) throw new BadRequestException('no puedes cambiar tu propio rol');
    await this.baseDatos.transaccion(async (tx) => {
      const objetivo = await tx.consultar<{ codigoRol: string }>(`
        SELECT r."codigoRol" FROM "Usuario" u JOIN "Rol" r ON r."idRol" = u."idRol"
        WHERE u."idUsuario" = $1 AND u."estadoCuenta" = 'activa' FOR UPDATE OF u
      `, [usuarioId]);
      if (objetivo.rows.length === 0) throw new NotFoundException('usuario no encontrado');
      const rolActual = rolDesdeCodigo(objetivo.rows[0].codigoRol);
      if (!rolActual || !ROLES_CAMBIABLES.includes(rolActual)) {
        throw new BadRequestException('solo se puede cambiar el rol de cuentas del personal; los titulares mantienen el rol usuario');
      }
      if (rolActual === 'admin' && nuevoRol !== 'admin') {
        const otros = await tx.consultar(`
          SELECT 1 FROM "Usuario" u JOIN "Rol" r ON r."idRol" = u."idRol"
          WHERE r."codigoRol" = $1 AND u."estadoCuenta" = 'activa' AND u."idUsuario" <> $2 LIMIT 1
        `, [CODIGO_ROL.admin, usuarioId]);
        if (otros.rowCount === 0) throw new ConflictException('no se puede quitar el rol al último administrador');
      }
      await tx.consultar(
        'UPDATE "Usuario" SET "idRol" = (SELECT "idRol" FROM "Rol" WHERE "codigoRol" = $2) WHERE "idUsuario" = $1',
        [usuarioId, CODIGO_ROL[nuevoRol]]
      );
    });
    return (await this.listar()).find((resumen) => resumen.id === String(usuarioId) && resumen.cuenta === 'usuario')!;
  }

  // Solo para cuentas del personal; las contraseñas de los titulares nunca las restablece un administrador.
  async restablecerContrasena(cuenta: 'usuario' | 'administrador_riesgo', id: number, contrasena: string): Promise<{ contrasenaExpiraEn?: string }> {
    const nueva = validarContrasena(contrasena);
    if (cuenta === 'administrador_riesgo') {
      const existe = await this.baseDatos.consultar('SELECT 1 FROM "AdministradorRiesgo" WHERE "idAdminRiesgo" = $1', [id]);
      if (existe.rowCount === 0) throw new NotFoundException('administrador de riesgo no encontrado');
      await this.autenticacion.crearCredencialAdministrador(id, nueva);
      return { contrasenaExpiraEn: new Date(Date.now() + HORAS_VIGENCIA_CONTRASENA_ADMIN * 3_600_000).toISOString() };
    }
    const objetivo = await this.baseDatos.consultar<{ codigoRol: string }>(`
      SELECT r."codigoRol" FROM "Usuario" u JOIN "Rol" r ON r."idRol" = u."idRol" WHERE u."idUsuario" = $1 AND u."estadoCuenta" = 'activa'
    `, [id]);
    const rol = objetivo.rows[0] ? rolDesdeCodigo(objetivo.rows[0].codigoRol) : undefined;
    if (!rol) throw new NotFoundException('usuario no encontrado');
    if (rol === 'usuario') throw new ForbiddenException('la contraseña de un titular no puede ser restablecida por un administrador');
    await this.autenticacion.crearCredencial(id, nueva);
    return {};
  }

  // ---------------------------------------------------------------- baja y anonimización

  // Cierra la cuenta cumpliendo los Términos y Condiciones y anonimiza los datos personales de forma irreversible.
  async eliminarCuenta(sesion: Sesion, datos: { contrasena?: string; confirmacionNoRepudio?: unknown }, contexto: ContextoCliente): Promise<{ mensaje: string }> {
    if (sesion.cuenta !== 'usuario' || sesion.rol !== 'usuario') throw new ForbiddenException('solo los titulares pueden eliminar su cuenta');
    this.noRepudio.exigirConfirmacion(datos.confirmacionNoRepudio);
    if (typeof datos.contrasena !== 'string' || !(await this.autenticacion.verificarContrasena(sesion, datos.contrasena))) {
      throw new UnauthorizedException('la contraseña es incorrecta');
    }

    const actual = await this.baseDatos.consultar<{ nombreCompleto: string; rut: string; numeroCelular: string | null; email: string }>(
      'SELECT "nombreCompleto", "rut", "numeroCelular", "email" FROM "Usuario" WHERE "idUsuario" = $1 AND "estadoCuenta" = \'activa\'', [sesion.id]
    );
    if (actual.rows.length === 0) throw new NotFoundException('cuenta no encontrada');
    const fila = actual.rows[0];

    await this.baseDatos.transaccion(async (tx) => {
      await tx.consultar('SELECT 1 FROM "Usuario" WHERE "idUsuario" = $1 FOR UPDATE', [sesion.id]);
      await this.exigirCondicionesDeCierre(sesion.id, tx);
      await this.noRepudio.registrar({
        actor: sesion, accion: 'cuenta.eliminar', recurso: `usuario:${sesion.id}`, datos: { usuarioId: sesion.id }, contexto
      }, tx);
      await tx.consultar(`
        UPDATE "Usuario" SET "nombreCompleto" = $2, "rut" = $3, "rutHash" = NULL, "numeroCelular" = NULL, "tramoRenta" = NULL,
               "email" = $4, "emailHash" = NULL, "isAccessBlocked" = TRUE, "estadoCuenta" = 'eliminada'
        WHERE "idUsuario" = $1
      `, [sesion.id, generarAnonimo('NOMBRE'), generarAnonimo('RUT'), `${generarAnonimo('CORREO')}@anonimo.monify.invalid`]);
      await tx.consultar('DELETE FROM "CredAuthUser" WHERE "idUsuario" = $1', [sesion.id]);
      await tx.consultar(
        `UPDATE "Tarjeta" SET "numeroTarjeta" = $2 WHERE "idTarjeta" IN (SELECT "idTarjeta" FROM "Billetera" WHERE "idUsuario" = $1)`,
        [sesion.id, generarAnonimo('TARJETA')]
      );
      await tx.consultar('UPDATE "VerificadorDeIdentidad" SET "hashDeVerificacion" = NULL, "metodoDeVerificacion" = NULL WHERE "idUsuario" = $1', [sesion.id]);
      await tx.consultar(
        'UPDATE "AutorizacionAcceso" SET "revocadoEn" = now() WHERE ("idOtorgante" = $1 OR "idUsuarioObjetivo" = $1 OR "idBeneficiario" = $1) AND "revocadoEn" IS NULL', [sesion.id]
      );
      await this.consentimientos.revocarTodos(tx, sesion.id);
    });

    // Sin el vínculo de la bóveda los seudónimos pasan a ser datos anónimos: no hay vuelta atrás.
    try {
      await this.seudonimos.eliminar([fila.nombreCompleto, fila.rut, fila.numeroCelular, fila.email]);
    } catch (error) {
      this.logger.error(`Cuenta ${sesion.id} anonimizada pero no se pudo vaciar la bóveda: ${(error as Error).message}`);
    }
    return { mensaje: 'tu cuenta fue eliminada y tus datos personales anonimizados de forma irreversible' };
  }

  private async exigirCondicionesDeCierre(usuarioId: number, tx: Ejecutor): Promise<void> {
    const saldo = await this.billeteras.saldoTotal(usuarioId, tx, true);
    if (saldo !== SALDO_PARA_CERRAR_CUENTA) {
      throw new ConflictException(`para eliminar tu cuenta el saldo debe ser $0; saldo actual: $${saldo.toLocaleString('es-CL')}. Retira o transfiere tus fondos primero`);
    }
    const obligaciones = await this.operaciones.obligacionesPendientes(usuarioId, tx);
    const pendientes: string[] = [];
    if (obligaciones.deudas > 0) pendientes.push(`${obligaciones.deudas} deuda(s) registrada(s)`);
    if (obligaciones.creditosVigentes > 0) pendientes.push(`${obligaciones.creditosVigentes} crédito(s) vigente(s)`);
    if (obligaciones.solicitudesEnCurso > 0) pendientes.push(`${obligaciones.solicitudesEnCurso} solicitud(es) de crédito en curso`);
    if (pendientes.length > 0) throw new ConflictException(`no puedes eliminar tu cuenta mientras tengas: ${pendientes.join(', ')}`);
  }

  // ---------------------------------------------------------------- portabilidad

  async exportarDatos(sesion: Sesion) {
    const alcance = { tipo: 'ids' as const, ids: [sesion.id] };
    const [perfil, billetera, transacciones, deudas, solicitudes, consultasRiesgo, verificaciones, consentimientos, actividad] = await Promise.all([
      this.obtenerPerfil(sesion),
      this.billeteras.obtenerBilletera(sesion.id),
      this.operaciones.listarTransacciones(alcance),
      this.operaciones.listarDeudas(alcance),
      this.operaciones.listarSolicitudes(alcance),
      this.operaciones.listarConsultasRiesgo(alcance),
      this.operaciones.listarVerificaciones(alcance),
      this.consentimientos.listar(sesion.id),
      this.auditoria.listar({ usuarioId: sesion.id, limite: 500 })
    ]);
    return {
      generadoEn: new Date().toISOString(),
      versionTerminos: VERSION_TERMINOS,
      cuenta: perfil, billetera, transacciones, deudas, solicitudesCredito: solicitudes, consultasRiesgo, verificaciones, consentimientos,
      actividad: actividad.map(({ fechaAccion, accion, canal, dispositivo, resultado, recurso }) => ({ fechaAccion, accion, canal, dispositivo, resultado, recurso }))
    };
  }

  private async revelarDatosPersonales(fila: { nombreCompleto: string; rut: string; numeroCelular: string | null; email: string }) {
    const [nombre, rut, correo, celular] = await Promise.all([
      this.seudonimos.revelar(fila.nombreCompleto), this.seudonimos.revelar(fila.rut),
      this.seudonimos.revelar(fila.email), this.seudonimos.revelar(fila.numeroCelular)
    ]);
    return { nombre: nombre ?? fila.nombreCompleto, rut: rut ?? fila.rut, correo: correo ?? fila.email, numeroCelular: celular ?? undefined };
  }
}
