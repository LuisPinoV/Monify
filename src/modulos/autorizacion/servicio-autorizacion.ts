import { ForbiddenException, Injectable } from '@nestjs/common';
import { BaseDatos } from '../../base-datos';
import { ServicioAuditoria } from '../auditoria/servicio-auditoria';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { AMBITO_POR_ACCION, reglaPara, type Accion, type Regla } from './permisos';
import type { Sesion } from './roles';

export type Alcance = { tipo: 'todos' } | { tipo: 'ids'; ids: number[] };

export interface OpcionesAcceso {
  motivo?: string;
  contexto: ContextoCliente;
}

export const LARGO_MINIMO_MOTIVO = 5;

/**
 * Evalúa la matriz RBAC. `alcance` devuelve a qué titulares puede llegar la sesión para una acción;
 * `exigirAcceso` valida un titular concreto. Todo acceso ajeno "por necesidad" queda auditado con su motivo.
 */
@Injectable()
export class ServicioAutorizacion {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly auditoria: ServicioAuditoria
  ) {}

  regla(sesion: Sesion, accion: Accion): Regla {
    return reglaPara(sesion.rol, accion);
  }

  async alcance(sesion: Sesion, accion: Accion, opciones: OpcionesAcceso): Promise<Alcance> {
    const regla = this.regla(sesion, accion);
    switch (regla) {
      case 'denegado':
        throw new ForbiddenException('tu rol no tiene permiso para esta acción');
      case 'propio':
        if (sesion.cuenta !== 'usuario') throw new ForbiddenException('solo el titular puede acceder a este recurso');
        return { tipo: 'ids', ids: [sesion.id] };
      case 'permitido':
        return { tipo: 'todos' };
      case 'necesidad': {
        const motivo = opciones.motivo?.trim();
        if (!motivo || motivo.length < LARGO_MINIMO_MOTIVO) {
          throw new ForbiddenException(`el acceso a datos de otros titulares requiere un motivo de al menos ${LARGO_MINIMO_MOTIVO} caracteres (cabecera X-Motivo-Acceso)`);
        }
        await this.auditoria.registrar({
          actor: sesion, accion: 'acceso.por_necesidad', resultado: 'exito', contexto: opciones.contexto,
          recurso: accion, detalle: { accionSolicitada: accion, motivo }
        });
        return { tipo: 'todos' };
      }
      case 'autorizacion':
        return this.alcancePorAutorizacion(sesion, accion);
    }
  }

  async exigirAcceso(sesion: Sesion, accion: Accion, titularId: number, opciones: OpcionesAcceso): Promise<void> {
    const alcance = await this.alcance(sesion, accion, opciones);
    if (alcance.tipo === 'ids' && !alcance.ids.includes(titularId)) {
      throw new ForbiddenException('no tienes autorización para acceder a los datos de este titular');
    }
  }

  private async alcancePorAutorizacion(sesion: Sesion, accion: Accion): Promise<Alcance> {
    const ambito = AMBITO_POR_ACCION[accion];
    if (!ambito) throw new ForbiddenException('esta acción no admite autorizaciones de acceso');
    if (sesion.cuenta !== 'usuario') throw new ForbiddenException('tu cuenta no admite autorizaciones de acceso');
    const resultado = await this.baseDatos.consultar<{ idUsuarioObjetivo: number | null }>(`
      SELECT DISTINCT "idUsuarioObjetivo" FROM "AutorizacionAcceso"
      WHERE "idBeneficiario" = $1 AND "ambito" = $2 AND "revocadoEn" IS NULL AND "expiraEn" > now()
    `, [sesion.id, ambito]);
    if (ambito === 'logs') {
      if (resultado.rows.length === 0) throw new ForbiddenException('se requiere una autorización vigente de un auditor para revisar los logs');
      return { tipo: 'todos' };
    }
    const ids = resultado.rows.map((fila) => fila.idUsuarioObjetivo).filter((id): id is number => id !== null);
    return { tipo: 'ids', ids };
  }
}
