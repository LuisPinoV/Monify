import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { IncomingHttpHeaders } from 'node:http';
import { contextoDesdeEncabezados } from '../../utilidades/contexto-cliente';
import { ServicioAlertas } from '../auditoria/servicio-alertas';
import { ServicioAuditoria } from '../auditoria/servicio-auditoria';
import { PERMISO, SIN_CONSENTIMIENTO, SOLO_AUTENTICADO } from '../autorizacion/decoradores';
import { reglaPara, type Accion } from '../autorizacion/permisos';
import type { Sesion } from '../autorizacion/roles';
import { ServicioConsentimientos } from '../terminos/servicio-consentimientos';
import { PUBLICA } from './publico.decorador';
import { ServicioAutenticacion } from './servicio-autenticacion';

interface Solicitud {
  headers: IncomingHttpHeaders & { authorization?: string };
  method: string;
  path: string;
  sesion?: Sesion;
}

/**
 * Guard global: valida el JWT, resuelve la sesión con datos frescos y aplica RBAC (denegar por defecto).
 * Todo endpoint debe declarar @Publica(), @SoloAutenticado(...) o @Permiso(...).
 */
const contextoCliente = (solicitud: Solicitud) => contextoDesdeEncabezados(solicitud.headers);

// Operaciones del titular que exigen verificación adicional tras un login desde un dispositivo nuevo (alerta A3).
const OPERACIONES_SENSIBLES: Accion[] = ['transaccion.crear', 'tarjeta.agregar', 'solicitud_credito.crear'];

@Injectable()
export class GuardJwt implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly autenticacion: ServicioAutenticacion,
    private readonly auditoria: ServicioAuditoria,
    private readonly consentimientos: ServicioConsentimientos,
    private readonly alertas: ServicioAlertas
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const destinos = [contexto.getHandler(), contexto.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLICA, destinos)) return true;

    const solicitud = contexto.switchToHttp().getRequest<Solicitud>();
    const token = solicitud.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('token de acceso requerido');
    let payload: { sub?: string; cuenta?: string; emitidoEn?: number; iat?: number };
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('token de acceso inválido');
    }
    const sesion = await this.autenticacion.resolverSesion(payload);
    if (!sesion) throw new UnauthorizedException('la cuenta no está activa o fue bloqueada');
    // Actividad 7: contención de un incidente. Los tokens emitidos antes de una revocación dejan de valer.
    if (await this.autenticacion.sesionRevocada(sesion, payload)) throw new UnauthorizedException('la sesión fue revocada; vuelve a iniciar sesión');
    solicitud.sesion = sesion;
    await this.exigirConsentimiento(sesion, solicitud, destinos);

    const accion = this.reflector.getAllAndOverride<Accion | undefined>(PERMISO, destinos);
    if (accion) {
      if (reglaPara(sesion.rol, accion) === 'denegado') {
        await this.auditoria.intentarRegistrar({
          actor: sesion, accion: 'acceso_denegado', resultado: 'denegado', contexto: contextoDesdeEncabezados(solicitud.headers),
          recurso: [solicitud.method, solicitud.path].join(' ').slice(0, 120), detalle: { accionRequerida: accion, rol: sesion.rol }
        });
        await this.alertas.evaluarDenegaciones(sesion, contextoCliente(solicitud));
        throw new ForbiddenException('tu rol no tiene permiso para esta acción');
      }
      await this.exigirVerificacionAdicional(sesion, solicitud, accion);
      return true;
    }
    if (this.reflector.getAllAndOverride<string | undefined>(SOLO_AUTENTICADO, destinos)) return true;
    throw new ForbiddenException('endpoint sin política de acceso definida');
  }

  // Alerta A3 (Actividad 7): operaciones sensibles del titular tras un login desde un canal o dispositivo nuevo.
  private async exigirVerificacionAdicional(sesion: Sesion, solicitud: Solicitud, accion: Accion): Promise<void> {
    const sensible = OPERACIONES_SENSIBLES.includes(accion) || (accion === 'derechos.ejercer' && solicitud.method === 'POST' && solicitud.path === '/derechos/solicitudes');
    if (sesion.rol !== 'usuario' || !sensible) return;
    const contexto = contextoDesdeEncabezados(solicitud.headers);
    try {
      await this.alertas.exigirVerificacionAdicional(sesion, contexto, accion);
    } catch (error) {
      await this.auditoria.intentarRegistrar({
        actor: sesion, accion: 'acceso_denegado', resultado: 'denegado', contexto,
        recurso: [solicitud.method, solicitud.path].join(' ').slice(0, 120), detalle: { motivo: 'verificacion_adicional', accionRequerida: accion }
      });
      await this.alertas.evaluarDenegaciones(sesion, contexto);
      throw error;
    }
  }

  // Actividad 5: un titular al que le falta (o revocó) un consentimiento no puede operar ni ver información;
  // solo accede a la gestión de consentimientos y al módulo de derechos (@SinConsentimiento).
  private async exigirConsentimiento(sesion: Sesion, solicitud: Solicitud, destinos: Parameters<Reflector['getAllAndOverride']>[1]): Promise<void> {
    if (sesion.rol !== 'usuario' || this.reflector.getAllAndOverride<boolean>(SIN_CONSENTIMIENTO, destinos)) return;
    const pendientes = await this.consentimientos.pendientes(sesion.id);
    if (pendientes.length === 0) return;
    await this.auditoria.intentarRegistrar({
      actor: sesion, accion: 'acceso_denegado', resultado: 'denegado', contexto: contextoDesdeEncabezados(solicitud.headers),
      recurso: [solicitud.method, solicitud.path].join(' ').slice(0, 120), detalle: { motivo: 'consentimiento_pendiente', pendientes }
    });
    await this.alertas.evaluarDenegaciones(sesion, contextoCliente(solicitud));
    throw new ForbiddenException({
      statusCode: 403, error: 'Forbidden', codigo: 'CONSENTIMIENTO_REQUERIDO', pendientes,
      message: 'debes otorgar todos los consentimientos para usar Monify; solo puedes acceder a tus consentimientos y a tus derechos'
    });
  }
}
