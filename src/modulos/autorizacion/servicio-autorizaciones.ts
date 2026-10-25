import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BaseDatos } from '../../base-datos';
import { AMBITO_POR_ACCION, reglaPara, type AmbitoAutorizacion } from './permisos';
import { rolDesdeCodigo, type Rol, type Sesion } from './roles';

const AMBITOS: AmbitoAutorizacion[] = ['financiera', 'movimientos', 'deuda', 'logs'];
const HORAS_MAXIMAS = 72;
const HORAS_POR_DEFECTO = 24;

export interface AutorizacionVista {
  id: string;
  otorganteId: string;
  beneficiarioId: string;
  usuarioObjetivoId: string | null;
  ambito: AmbitoAutorizacion;
  otorgadaEn: string;
  expiraEn: string;
  revocadaEn: string | null;
  vigente: boolean;
}

interface FilaAutorizacion {
  idAutorizacion: number;
  idOtorgante: number;
  idBeneficiario: number;
  idUsuarioObjetivo: number | null;
  ambito: AmbitoAutorizacion;
  otorgadoEn: Date;
  expiraEn: Date;
  revocadoEn: Date | null;
  vigente: boolean;
}

export interface Beneficiario {
  id: string;
  rol: Rol;
  nombre: string;
}

/** Autorizaciones expresas: permiten a un rol interno ver datos ajenos durante un tiempo acotado. */
@Injectable()
export class ServicioAutorizaciones {
  constructor(private readonly baseDatos: BaseDatos) {}

  async otorgar(sesion: Sesion, datos: { beneficiarioId: number; ambito: AmbitoAutorizacion; horas?: number }): Promise<AutorizacionVista> {
    if (sesion.cuenta !== 'usuario') throw new ForbiddenException('tu cuenta no puede otorgar autorizaciones');
    if (!AMBITOS.includes(datos.ambito)) throw new BadRequestException(`ambito debe ser uno de: ${AMBITOS.join(', ')}`);
    const horas = datos.horas ?? HORAS_POR_DEFECTO;
    if (!Number.isInteger(horas) || horas < 1 || horas > HORAS_MAXIMAS) {
      throw new BadRequestException(`horas debe ser un entero entre 1 y ${HORAS_MAXIMAS}`);
    }
    // Los logs los autoriza un auditor; los datos financieros, su propio titular.
    const otorganteValido = datos.ambito === 'logs' ? sesion.rol === 'auditor' : sesion.rol === 'usuario';
    if (!otorganteValido) throw new ForbiddenException('tu rol no puede otorgar autorizaciones para este ámbito');
    if (datos.beneficiarioId === sesion.id) throw new BadRequestException('no puedes autorizarte a ti mismo');

    const beneficiario = await this.rolDeCuenta(datos.beneficiarioId);
    if (!beneficiario) throw new NotFoundException('beneficiario no encontrado');
    const accion = (Object.keys(AMBITO_POR_ACCION) as Array<keyof typeof AMBITO_POR_ACCION>)
      .find((clave) => AMBITO_POR_ACCION[clave] === datos.ambito)!;
    if (reglaPara(beneficiario, accion) !== 'autorizacion') {
      throw new BadRequestException('el rol del beneficiario no admite autorizaciones para este ámbito');
    }

    const objetivo = datos.ambito === 'logs' ? null : sesion.id;
    const resultado = await this.baseDatos.consultar<FilaAutorizacion>(`
      INSERT INTO "AutorizacionAcceso" ("idOtorgante", "idBeneficiario", "idUsuarioObjetivo", "ambito", "expiraEn")
      VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))
      RETURNING *, TRUE AS vigente
    `, [sesion.id, datos.beneficiarioId, objetivo, datos.ambito, horas]);
    return mapear(resultado.rows[0]);
  }

  async listar(sesion: Sesion): Promise<AutorizacionVista[]> {
    if (sesion.cuenta !== 'usuario') return [];
    const resultado = await this.baseDatos.consultar<FilaAutorizacion>(`
      SELECT *, ("revocadoEn" IS NULL AND "expiraEn" > now()) AS vigente FROM "AutorizacionAcceso"
      WHERE "idOtorgante" = $1 OR "idBeneficiario" = $1 OR "idUsuarioObjetivo" = $1
      ORDER BY "idAutorizacion" DESC LIMIT 200
    `, [sesion.id]);
    return resultado.rows.map(mapear);
  }

  async revocar(sesion: Sesion, id: number): Promise<AutorizacionVista> {
    if (sesion.cuenta !== 'usuario') throw new ForbiddenException('tu cuenta no puede revocar autorizaciones');
    const resultado = await this.baseDatos.consultar<FilaAutorizacion>(`
      UPDATE "AutorizacionAcceso" SET "revocadoEn" = now()
      WHERE "idAutorizacion" = $1 AND ("idOtorgante" = $2 OR "idUsuarioObjetivo" = $2) AND "revocadoEn" IS NULL
      RETURNING *, FALSE AS vigente
    `, [id, sesion.id]);
    if (resultado.rows.length === 0) throw new NotFoundException('autorización no encontrada o ya revocada');
    return mapear(resultado.rows[0]);
  }

  // Cuentas a las que la sesión puede conceder acceso (seudonimizadas: no se muestran datos personales).
  async beneficiariosPosibles(sesion: Sesion): Promise<Beneficiario[]> {
    const destino: Rol[] = sesion.rol === 'auditor' ? ['admin'] : sesion.rol === 'usuario' ? ['auditor', 'operador_financiero'] : [];
    if (destino.length === 0) return [];
    const resultado = await this.baseDatos.consultar<{ id: number; codigoRol: string; nombre: string }>(`
      SELECT u."idUsuario" AS id, r."codigoRol", u."nombreCompleto" AS nombre
      FROM "Usuario" u JOIN "Rol" r ON r."idRol" = u."idRol"
      WHERE u."estadoCuenta" = 'activa' AND u."idUsuario" <> $1
      ORDER BY u."idUsuario"
    `, [sesion.id]);
    return resultado.rows.flatMap((fila) => {
      const rol = rolDesdeCodigo(fila.codigoRol);
      return rol && destino.includes(rol) ? [{ id: String(fila.id), rol, nombre: fila.nombre }] : [];
    });
  }

  private async rolDeCuenta(usuarioId: number): Promise<Rol | undefined> {
    const resultado = await this.baseDatos.consultar<{ codigoRol: string }>(`
      SELECT r."codigoRol" FROM "Usuario" u JOIN "Rol" r ON r."idRol" = u."idRol"
      WHERE u."idUsuario" = $1 AND u."estadoCuenta" = 'activa'
    `, [usuarioId]);
    return resultado.rows[0] ? rolDesdeCodigo(resultado.rows[0].codigoRol) : undefined;
  }
}

function mapear(fila: FilaAutorizacion): AutorizacionVista {
  return {
    id: String(fila.idAutorizacion),
    otorganteId: String(fila.idOtorgante),
    beneficiarioId: String(fila.idBeneficiario),
    usuarioObjetivoId: fila.idUsuarioObjetivo === null ? null : String(fila.idUsuarioObjetivo),
    ambito: fila.ambito,
    otorgadaEn: new Date(fila.otorgadoEn).toISOString(),
    expiraEn: new Date(fila.expiraEn).toISOString(),
    revocadaEn: fila.revocadoEn ? new Date(fila.revocadoEn).toISOString() : null,
    vigente: fila.vigente
  };
}
