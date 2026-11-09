import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { ServicioConsentimientos, type AceptacionFinalidades } from '../terminos/servicio-consentimientos';
import { ServicioOposiciones } from '../terminos/servicio-oposiciones';
import { FINALIDADES_OBLIGATORIAS, SALDO_PARA_CERRAR_CUENTA, VERSION_TERMINOS } from '../terminos/terminos';

// Actividad 6, punto 5: qué se eliminó, qué quedó bloqueado por obligación legal y a dónde se propagó una supresión.
export interface InformeSupresion {
  eliminado: string[];
  bloqueadoPorObligacionLegal: { tabla: string; registros: number; motivo: string }[];
  propagacion: { destino: string; accion: string; estado: 'aplicada' | 'pendiente' }[];
}

const MOTIVO_RETENCION: Record<string, string> = {
  Transaccion: 'trazabilidad financiera y prevención de lavado de activos (Ley 19.913)',
  Tarjeta: 'respaldo de las transacciones conservadas (número anonimizado)',
  Billetera: 'respaldo contable de los movimientos',
  Deuda: 'obligación contractual y contable',
  ConsultaDeRiesgo: 'respaldo de las decisiones de crédito ya tomadas',
  VerificadorDeIdentidad: 'prueba de la debida diligencia KYC (sin comprobante ni método)',
  SolicitudCredito: 'respaldo de las decisiones de crédito ya tomadas',
  UsuarioCredito: 'respaldo de los créditos otorgados',
  UserConsent: 'prueba de la base de licitud de los tratamientos pasados',
  Usuario: 'ancla anónima de los registros conservados'
};

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

// Campos que el titular puede rectificar. El RUT no se rectifica por esta vía: es el identificador validado por KYC.
export interface CambiosRectificacion {
  nombre?: string;
  numeroCelular?: string;
  correo?: string;
  rentaMensual?: number;
}
export const CAMPOS_RECTIFICABLES = ['nombre', 'numeroCelular', 'correo', 'rentaMensual'] as const;

interface FilaUsuario {
  idUsuario: number;
  codigoRol: string;
  nombreCompleto: string;
  rut: string;
  esMayorDeEdad: boolean;
  rangoRentaMensual: string | null;
  numeroCelular: string | null;
  email: string;
  isAccessBlocked: boolean;
  createdAt: Date;
}

interface FilaAdministrador {
  idAdminRiesgo: number;
  nombreCompleto: string;
  rut: string;
  numeroCelular: string | null;
  email: string;
  isAccessBlocked: boolean;
  createdAt: Date;
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
    private readonly operaciones: ServicioOperacionesFinancieras,
    private readonly oposiciones: ServicioOposiciones
  ) {}

  // ---------------------------------------------------------------- altas

  // Autoregistro de un titular: exige aceptar los Términos y Condiciones (queda evidencia de no repudio).
  // Cada finalidad (términos, tratamiento de datos y evaluación crediticia) llega con su propia casilla marcada.
  async registrar(datos: DatosCuenta, aceptacion: AceptacionFinalidades, contexto: ContextoCliente): Promise<PerfilCuenta> {
    this.consentimientos.exigirAceptacionCompleta(aceptacion);
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
            INSERT INTO "Usuario" ("idRol", "nombreCompleto", "rut", "rutHash", "esMayorDeEdad", "rangoRentaMensual", "numeroCelular", "email", "emailHash")
            VALUES ((SELECT "idRol" FROM "Rol" WHERE "codigoRol" = $1), $2, $3, $4, $5, $6, $7, $8, $9) RETURNING "idUsuario" AS id
          `, [CODIGO_ROL[rol], seudonimoNombre, seudonimoRut, rutHash, mayorEdad, tramo, seudonimoCelular, seudonimoCorreo, emailHash]);
          id = usuario.rows[0].id;
          await this.autenticacion.crearCredencial(id, contrasena, tx);
        }
        if (conTerminos) {
          const evidencia = await this.noRepudio.registrar({
            actor: { id, cuenta: 'usuario' }, accion: 'terminos.aceptar', recurso: `terminos:${VERSION_TERMINOS}`,
            datos: { version: VERSION_TERMINOS, finalidades: FINALIDADES_OBLIGATORIAS }, contexto, versionTexto: VERSION_TERMINOS
          }, tx);
          await this.consentimientos.otorgarTodas(tx, id, contexto, evidencia.id);
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
        ...(await this.revelarDatosPersonales(fila)), bloqueada: fila.isAccessBlocked, creadoEn: new Date(fila.createdAt).toISOString()
      };
    }
    const resultado = await this.baseDatos.consultar<FilaUsuario>(`
      SELECT u.*, r."codigoRol" FROM "Usuario" u JOIN "Rol" r ON r."idRol" = u."idRol" WHERE u."idUsuario" = $1
    `, [sesion.id]);
    const fila = resultado.rows[0];
    const rol = fila ? rolDesdeCodigo(fila.codigoRol) : undefined;
    if (!fila || !rol) throw new NotFoundException('cuenta no encontrada');
    const tramo = this.persistenciaCifrada.revelarCampo<string>(fila.rangoRentaMensual) ?? undefined;
    return {
      id: String(fila.idUsuario), cuenta: 'usuario', rol, ...(await this.revelarDatosPersonales(fila)),
      esMayorEdad: fila.esMayorDeEdad, tramoRenta: tramo, tramoRentaEtiqueta: etiquetaTramoRenta(tramo),
      bloqueada: fila.isAccessBlocked, creadoEn: new Date(fila.createdAt).toISOString()
    };
  }

  // Lista de cuentas para el personal: solo seudónimos, sin datos personales ni financieros.
  async listar(): Promise<ResumenCuenta[]> {
    const usuarios = await this.baseDatos.consultar<{ id: number; codigoRol: string; nombre: string; bloqueada: boolean; estadoCuenta: string; creadoEn: Date }>(`
      SELECT u."idUsuario" AS id, r."codigoRol", u."nombreCompleto" AS nombre, u."isAccessBlocked" AS bloqueada, u."estadoCuenta", u."createdAt" AS "creadoEn"
      FROM "Usuario" u JOIN "Rol" r ON r."idRol" = u."idRol" ORDER BY u."idUsuario"
    `);
    const administradores = await this.baseDatos.consultar<{ id: number; nombre: string; bloqueada: boolean; creadoEn: Date }>(`
      SELECT "idAdminRiesgo" AS id, "nombreCompleto" AS nombre, "isAccessBlocked" AS bloqueada, "createdAt" AS "creadoEn" FROM "AdministradorRiesgo" ORDER BY "idAdminRiesgo"
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

  // Valida una rectificación antes de registrarla: mismas reglas que el registro y solo campos permitidos.
  async validarRectificacion(usuarioId: number, datos: unknown): Promise<CambiosRectificacion> {
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new BadRequestException('cambios debe ser un objeto');
    const entrada = datos as Record<string, unknown>;
    const desconocidos = Object.keys(entrada).filter((campo) => !(CAMPOS_RECTIFICABLES as readonly string[]).includes(campo));
    if ('rut' in entrada) {
      throw new BadRequestException('el RUT no se rectifica en línea: es el identificador validado por la verificación de identidad (KYC); solicítalo por el canal de atención con tu documento');
    }
    if (desconocidos.length > 0) throw new BadRequestException(`campos no rectificables: ${desconocidos.join(', ')}. Permitidos: ${CAMPOS_RECTIFICABLES.join(', ')}`);
    const cambios: CambiosRectificacion = {};
    if (entrada.nombre !== undefined) cambios.nombre = validarTexto(entrada.nombre, 'nombre', 200);
    if (entrada.numeroCelular !== undefined) {
      const celular = validarTexto(entrada.numeroCelular, 'numeroCelular', 20);
      if (!/^\+?[0-9 ]{8,20}$/.test(celular)) throw new BadRequestException('numeroCelular debe tener entre 8 y 20 dígitos');
      cambios.numeroCelular = celular;
    }
    if (entrada.correo !== undefined) {
      const correo = normalizarCorreo(validarTexto(entrada.correo, 'correo', 254));
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new BadRequestException('correo no es válido');
      const hash = this.persistenciaCifrada.indiceBusqueda(correo);
      const propio = await this.baseDatos.consultar('SELECT 1 FROM "Usuario" WHERE "idUsuario" = $1 AND "emailHash" = $2', [usuarioId, hash]);
      if ((propio.rowCount ?? 0) > 0) throw new BadRequestException('el correo nuevo es igual al registrado');
      const ocupado = await this.baseDatos.consultar(
        'SELECT 1 FROM "Usuario" WHERE "emailHash" = $1 UNION ALL SELECT 1 FROM "AdministradorRiesgo" WHERE "emailHash" = $1', [hash]
      );
      if ((ocupado.rowCount ?? 0) > 0) throw new ConflictException('el correo ya está registrado en otra cuenta');
      cambios.correo = correo;
    }
    if (entrada.rentaMensual !== undefined) {
      if (typeof entrada.rentaMensual !== 'number' || !Number.isFinite(entrada.rentaMensual) || entrada.rentaMensual < 0) {
        throw new BadRequestException('rentaMensual debe ser un número no negativo');
      }
      cambios.rentaMensual = entrada.rentaMensual;
    }
    if (Object.keys(cambios).length === 0) throw new BadRequestException(`indica al menos un campo a rectificar: ${CAMPOS_RECTIFICABLES.join(', ')}`);
    return cambios;
  }

  // Aplica una rectificación ya verificada. Los seudónimos no cambian (solo el valor en la bóveda), así que los demás
  // módulos, la bitácora y las evidencias siguen apuntando al mismo titular sin actualizarse.
  // Actividad 6: cada campo cambiado queda en "RegistroRectificacion" (qué campo, cuándo y por qué solicitud) con huellas
  // HMAC del valor anterior y del nuevo: el cambio se puede comprobar sin guardar los datos en claro.
  async aplicarRectificacion(usuarioId: number, cambios: CambiosRectificacion, solicitudId?: number): Promise<string[]> {
    const resultado = await this.baseDatos.consultar<{ nombreCompleto: string; numeroCelular: string | null; email: string; rangoRentaMensual: string | null }>(
      `SELECT "nombreCompleto", "numeroCelular", "email", "rangoRentaMensual" FROM "Usuario" WHERE "idUsuario" = $1 AND "estadoCuenta" = 'activa'`, [usuarioId]
    );
    const fila = resultado.rows[0];
    if (!fila) throw new NotFoundException('cuenta no encontrada');
    const anteriores: Record<string, string | null> = {
      nombre: await this.seudonimos.revelar(fila.nombreCompleto),
      numeroCelular: await this.seudonimos.revelar(fila.numeroCelular),
      correo: await this.seudonimos.revelar(fila.email),
      rentaMensual: this.persistenciaCifrada.revelarCampo<string>(fila.rangoRentaMensual)
    };
    const nuevos: Record<string, string | undefined> = {
      nombre: cambios.nombre, numeroCelular: cambios.numeroCelular, correo: cambios.correo,
      rentaMensual: cambios.rentaMensual === undefined ? undefined : tramoRenta(cambios.rentaMensual)
    };
    const aplicados: string[] = [];
    if (cambios.nombre !== undefined) {
      await this.seudonimos.actualizar(fila.nombreCompleto, cambios.nombre);
      aplicados.push('nombre');
    }
    if (cambios.numeroCelular !== undefined) {
      if (fila.numeroCelular) {
        await this.seudonimos.actualizar(fila.numeroCelular, cambios.numeroCelular);
      } else {
        const seudonimo = await this.seudonimos.seudonimizar('telefono', cambios.numeroCelular);
        await this.baseDatos.consultar('UPDATE "Usuario" SET "numeroCelular" = $2 WHERE "idUsuario" = $1', [usuarioId, seudonimo]);
      }
      aplicados.push('numeroCelular');
    }
    if (cambios.correo !== undefined) {
      // El índice HMAC del correo se recalcula: el login usa el correo nuevo desde este momento.
      await this.baseDatos.consultar('UPDATE "Usuario" SET "emailHash" = $2 WHERE "idUsuario" = $1', [usuarioId, this.persistenciaCifrada.indiceBusqueda(cambios.correo)]);
      await this.seudonimos.actualizar(fila.email, cambios.correo);
      aplicados.push('correo');
    }
    if (cambios.rentaMensual !== undefined) {
      // Se guarda solo el nuevo tramo; las próximas evaluaciones de riesgo lo usan automáticamente.
      await this.baseDatos.consultar(
        'UPDATE "Usuario" SET "rangoRentaMensual" = $2 WHERE "idUsuario" = $1',
        [usuarioId, this.persistenciaCifrada.protegerCampo(tramoRenta(cambios.rentaMensual))]
      );
      aplicados.push('rentaMensual');
    }
    if (solicitudId !== undefined) {
      const huella = (campo: string, valor: string | null | undefined) =>
        valor === null || valor === undefined ? null : this.persistenciaCifrada.indiceBusqueda(`rectificacion:${campo}:${valor}`);
      for (const campo of aplicados) {
        await this.baseDatos.consultar(
          'INSERT INTO "RegistroRectificacion" ("idSolicitudDerecho", "idUsuario", "campo", "huellaAnterior", "huellaNueva") VALUES ($1, $2, $3, $4, $5)',
          [solicitudId, usuarioId, campo, huella(campo, anteriores[campo]), huella(campo, nuevos[campo])]
        );
      }
    }
    return aplicados;
  }

  async historialRectificaciones(usuarioId: number): Promise<{ solicitudId: string; campo: string; fecha: string }[]> {
    const resultado = await this.baseDatos.consultar<{ idSolicitudDerecho: number; campo: string; fecha: Date }>(
      'SELECT "idSolicitudDerecho", "campo", "fecha" FROM "RegistroRectificacion" WHERE "idUsuario" = $1 ORDER BY "idRegistro"', [usuarioId]
    );
    return resultado.rows.map((fila) => ({ solicitudId: String(fila.idSolicitudDerecho), campo: fila.campo, fecha: new Date(fila.fecha).toISOString() }));
  }

  async establecerBloqueo(actor: Sesion, cuenta: 'usuario' | 'administrador_riesgo', id: number, bloqueada: boolean): Promise<ResumenCuenta> {
    if (cuenta === 'usuario' && id === actor.id && actor.cuenta === 'usuario') {
      throw new BadRequestException('no puedes bloquear ni desbloquear tu propia cuenta');
    }
    const [tabla, columnaId, columnaBloqueo, credenciales] = cuenta === 'usuario'
      ? ['Usuario', 'idUsuario', 'isAccessBlocked', 'CredAuthUser']
      : ['AdministradorRiesgo', 'idAdminRiesgo', 'isAccessBlocked', 'CredAuthAdministrador'];
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

  // Supresión (ya verificada y evaluada): anonimiza los datos personales de forma irreversible.
  // Se conservan, sin identificar al titular, los registros con obligación legal de retención.
  async anonimizarCuenta(usuarioId: number, contexto: ContextoCliente): Promise<InformeSupresion> {
    const actual = await this.baseDatos.consultar<{ nombreCompleto: string; rut: string; numeroCelular: string | null; email: string }>(
      'SELECT "nombreCompleto", "rut", "numeroCelular", "email" FROM "Usuario" WHERE "idUsuario" = $1 AND "estadoCuenta" = \'activa\'', [usuarioId]
    );
    if (actual.rows.length === 0) throw new NotFoundException('cuenta no encontrada');
    const fila = actual.rows[0];

    const bloqueados = await this.baseDatos.transaccion(async (tx) => {
      await tx.consultar('SELECT 1 FROM "Usuario" WHERE "idUsuario" = $1 FOR UPDATE', [usuarioId]);
      const pendientes = await this.obligacionesPendientes(usuarioId, tx);
      if (pendientes.length > 0) throw new ConflictException(`no se puede suprimir la cuenta mientras tenga: ${pendientes.join(', ')}`);
      await tx.consultar(`
        UPDATE "Usuario" SET "nombreCompleto" = $2, "rut" = $3, "rutHash" = NULL, "numeroCelular" = NULL, "rangoRentaMensual" = NULL,
               "email" = $4, "emailHash" = NULL, "isAccessBlocked" = TRUE, "estadoCuenta" = 'eliminada'
        WHERE "idUsuario" = $1
      `, [usuarioId, generarAnonimo('NOMBRE'), generarAnonimo('RUT'), `${generarAnonimo('CORREO')}@anonimo.monify.invalid`]);
      await tx.consultar('DELETE FROM "CredAuthUser" WHERE "idUsuario" = $1', [usuarioId]);
      await tx.consultar(
        `UPDATE "Tarjeta" SET "numeroTarjeta" = $2 WHERE "idTarjeta" IN (SELECT "idTarjeta" FROM "Billetera" WHERE "idUsuario" = $1)`,
        [usuarioId, generarAnonimo('TARJETA')]
      );
      await tx.consultar('UPDATE "VerificadorDeIdentidad" SET "hashDeVerificacion" = NULL, "metodoDeVerificacion" = NULL WHERE "idUsuario" = $1', [usuarioId]);
      await tx.consultar(
        'UPDATE "AutorizacionAcceso" SET "revocadoEn" = now() WHERE ("idOtorgante" = $1 OR "idUsuarioObjetivo" = $1 OR "idBeneficiario" = $1) AND "revocadoEn" IS NULL', [usuarioId]
      );
      // Los cambios pedidos en rectificaciones anteriores también son datos personales.
      await tx.consultar('UPDATE "SolicitudDerecho" SET "datosSolicitud" = NULL WHERE "idUsuario" = $1', [usuarioId]);
      // Las huellas de las rectificaciones también se borran: queda solo qué campo cambió y cuándo.
      await tx.consultar('UPDATE "RegistroRectificacion" SET "huellaAnterior" = NULL, "huellaNueva" = NULL WHERE "idUsuario" = $1', [usuarioId]);
      await this.consentimientos.revocarTodos(tx, usuarioId, contexto);
      return this.bloquearRegistrosRetenidos(tx, usuarioId);
    });

    // Sin el vínculo de la bóveda los seudónimos pasan a ser datos anónimos: no hay vuelta atrás.
    let bovedaVaciada = true;
    try {
      await this.seudonimos.eliminar([fila.nombreCompleto, fila.rut, fila.numeroCelular, fila.email]);
    } catch (error) {
      bovedaVaciada = false;
      this.logger.error(`Cuenta ${usuarioId} anonimizada pero no se pudo vaciar la bóveda: ${(error as Error).message}`);
    }

    return {
      eliminado: [
        'nombre, RUT, celular y correo originales (bóveda de seudónimos)',
        'seudónimos de la cuenta (reemplazados por valores ANON-…) e índices HMAC de RUT y correo',
        'tramo de renta mensual',
        'credencial de acceso (hash de la contraseña)',
        'número de las tarjetas (anonimizado)',
        'comprobante y método de la verificación de identidad',
        'cambios pedidos en solicitudes de derechos y huellas de las rectificaciones',
        'consentimientos vigentes (revocados) y autorizaciones de acceso (revocadas)'
      ],
      bloqueadoPorObligacionLegal: Object.entries(bloqueados)
        .filter(([, registros]) => registros > 0)
        .map(([tabla, registros]) => ({ tabla, registros, motivo: MOTIVO_RETENCION[tabla] ?? 'obligación legal' })),
      propagacion: [
        { destino: 'Base principal', accion: 'anonimización y bloqueo (isBlocked) en una sola transacción', estado: 'aplicada' },
        { destino: 'Bóveda de seudónimos (base separada)', accion: 'eliminación de los vínculos seudónimo → dato original', estado: bovedaVaciada ? 'aplicada' : 'pendiente' },
        { destino: 'Sesiones activas', accion: 'el guard rechaza el JWT porque la cuenta ya no está activa', estado: 'aplicada' },
        { destino: 'Bitácora y evidencias de no repudio', accion: 'se conservan; solo contienen seudónimos que ya no se pueden revertir', estado: 'aplicada' },
        { destino: 'Respaldos cifrados', accion: 'solo contienen seudónimos; se renuevan en su ciclo de rotación', estado: 'pendiente' },
        { destino: 'Entidad verificadora de identidad y central de riesgo (terceros)', accion: 'aviso de supresión para que dejen de tratar los datos (simulado: queda en la bitácora)', estado: 'aplicada' }
      ]
    };
  }

  // BDD v5: lo que se conserva por obligación legal queda bloqueado ("isBlocked"): no se muestra ni se usa
  // en operaciones nuevas, pero sigue disponible para una fiscalización.
  private async bloquearRegistrosRetenidos(tx: Ejecutor, usuarioId: number): Promise<Record<string, number>> {
    const tarjetas = 'SELECT "idTarjeta" FROM "Billetera" WHERE "idUsuario" = $1';
    const solicitudes = 'SELECT "idSolicitudCredito" FROM "UsuarioCredito" WHERE "idUsuario" = $1';
    const bloqueados: Record<string, number> = {};
    for (const sql of [
      `UPDATE "Transaccion" SET "isBlocked" = TRUE WHERE "idTarjeta" IN (${tarjetas})`,
      `UPDATE "Tarjeta" SET "isBlocked" = TRUE WHERE "idTarjeta" IN (${tarjetas})`,
      'UPDATE "Billetera" SET "isBlocked" = TRUE WHERE "idUsuario" = $1',
      'UPDATE "Deuda" SET "isBlocked" = TRUE WHERE "idUsuario" = $1',
      'UPDATE "ConsultaDeRiesgo" SET "isBlocked" = TRUE WHERE "idUsuario" = $1',
      'UPDATE "VerificadorDeIdentidad" SET "isBlocked" = TRUE WHERE "idUsuario" = $1',
      `UPDATE "SolicitudCredito" SET "isBlocked" = TRUE WHERE "idSolicitudCredito" IN (${solicitudes})`,
      'UPDATE "UsuarioCredito" SET "isBlocked" = TRUE WHERE "idUsuario" = $1',
      'UPDATE "UserConsent" SET "isBlocked" = TRUE WHERE "idUsuario" = $1',
      'UPDATE "Usuario" SET "isBlocked" = TRUE WHERE "idUsuario" = $1'
    ]) {
      const resultado = await tx.consultar(sql, [usuarioId]);
      bloqueados[/UPDATE "(\w+)"/.exec(sql)![1]] = resultado.rowCount ?? 0;
    }
    return bloqueados;
  }

  // Condiciones de la sección 7 de los términos: obligaciones que justifican conservar los datos y rechazar la supresión.
  async obligacionesPendientes(usuarioId: number, tx: Ejecutor = this.baseDatos): Promise<string[]> {
    const pendientes: string[] = [];
    const saldo = await this.billeteras.saldoTotal(usuarioId, tx, tx !== this.baseDatos);
    if (saldo !== SALDO_PARA_CERRAR_CUENTA) pendientes.push(`saldo de $${saldo.toLocaleString('es-CL')} (debe ser $0)`);
    const obligaciones = await this.operaciones.obligacionesPendientes(usuarioId, tx);
    if (obligaciones.deudas > 0) pendientes.push(`${obligaciones.deudas} deuda(s) registrada(s)`);
    if (obligaciones.creditosVigentes > 0) pendientes.push(`${obligaciones.creditosVigentes} crédito(s) vigente(s)`);
    if (obligaciones.solicitudesEnCurso > 0) pendientes.push(`${obligaciones.solicitudesEnCurso} solicitud(es) de crédito en curso`);
    return pendientes;
  }

  // ---------------------------------------------------------------- portabilidad

  // Acceso y portabilidad: solo datos del titular, sin seudónimos internos, firmas, hashes ni datos de terceros
  // (por ejemplo, quién del personal resolvió una solicitud de crédito).
  async datosParaExportar(usuarioId: number) {
    const sesion: Sesion = { id: usuarioId, cuenta: 'usuario', rol: 'usuario' };
    const alcance = { tipo: 'ids' as const, ids: [usuarioId] };
    const [perfil, billetera, transacciones, deudas, solicitudes, consultasRiesgo, verificaciones, consentimientos, historialConsentimientos, actividad, rectificaciones, oposiciones] = await Promise.all([
      this.obtenerPerfil(sesion),
      this.billeteras.obtenerBilletera(usuarioId),
      this.operaciones.listarTransacciones(alcance),
      this.operaciones.listarDeudas(alcance),
      this.operaciones.listarSolicitudes(alcance),
      this.operaciones.listarConsultasRiesgo(alcance, undefined, { incluirBloqueados: true }),
      this.operaciones.listarVerificaciones(alcance),
      this.consentimientos.estado(usuarioId),
      this.consentimientos.historial(usuarioId, 500),
      this.auditoria.listar({ usuarioId, limite: 500 }),
      this.historialRectificaciones(usuarioId),
      this.oposiciones.listar(usuarioId)
    ]);
    const { id: _id, cuenta: _cuenta, rol: _rol, bloqueada: _bloqueada, ...datosPersonales } = perfil;
    return {
      titular: datosPersonales,
      billetera: { saldo: billetera.saldo, tarjetas: billetera.tarjetas.map(({ banco, numeroEnmascarado, saldo }) => ({ banco, numeroEnmascarado, saldo })) },
      transacciones: transacciones.map(({ id, tarjetaId, monto, creadaEn }) => ({ id, tarjetaId, monto, creadaEn })),
      deudas: deudas.map(({ id, monto, creadaEn }) => ({ id, monto, creadaEn })),
      solicitudesCredito: solicitudes.map(({ id, creditoId, montoSolicitado, estado, creadaEn }) => ({ id, creditoId, montoSolicitado, estado, creadaEn })),
      consultasRiesgo: consultasRiesgo.map(({ usuarioId: _u, ...consulta }) => consulta),
      verificacionesIdentidad: verificaciones.map(({ usuarioId: _u, ...verificacion }) => verificacion),
      consentimientos: consentimientos.finalidades.map(({ finalidad, estado, versionTexto, canal, otorgadoEl, revocadoEl }) => ({ finalidad, estado, versionTexto, canal, otorgadoEl, revocadoEl })),
      historialConsentimientos: historialConsentimientos.map(({ fechaHora, finalidad, accion, versionTexto, canal }) => ({ fechaHora, finalidad, accion, versionTexto, canal })),
      actividad: actividad.map(({ fechaAccion, accion, canal, dispositivo, resultado }) => ({ fechaAccion, accion, canal, dispositivo, resultado })),
      rectificaciones,
      oposiciones: oposiciones.map(({ tratamiento, nombre, vigente, vigenteDesde, levantadaEn }) => ({ tratamiento, nombre, vigente, vigenteDesde, levantadaEn }))
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
