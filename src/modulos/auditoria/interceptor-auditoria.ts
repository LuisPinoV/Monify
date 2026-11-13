import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, from, mergeMap, throwError, type Observable } from 'rxjs';
import { PERMISO, SOLO_AUTENTICADO } from '../autorizacion/decoradores';
import type { Sesion } from '../autorizacion/roles';
import { contextoDesdeEncabezados } from '../../utilidades/contexto-cliente';
import { ServicioAlertas } from './servicio-alertas';
import { ServicioAuditoria, type ResultadoAuditoria } from './servicio-auditoria';

interface Solicitud {
  sesion?: Sesion;
  method: string;
  path: string;
  params: Record<string, string>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers: import('node:http').IncomingHttpHeaders;
}

// Titular sobre cuyos datos se actúa (solo su identificador interno, nunca sus datos): ?usuarioId=, cuerpo o /usuarios/:id.
function titularObjetivo(solicitud: Solicitud): string | undefined {
  const candidatos = [solicitud.query?.usuarioId, solicitud.body?.usuarioId, /^\/usuarios\/\d+/.test(solicitud.path) ? solicitud.params?.id : undefined];
  const valor = candidatos.find((c) => typeof c === 'string' || typeof c === 'number');
  return valor !== undefined && /^\d+$/.test(String(valor)) ? String(valor) : undefined;
}

/** Registra en la bitácora cada acción autenticada (éxito, rechazo o fallo) con su canal y dispositivo. */
@Injectable()
export class InterceptorAuditoria implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditoria: ServicioAuditoria,
    private readonly alertas: ServicioAlertas
  ) {}

  intercept(contexto: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    const solicitud = contexto.switchToHttp().getRequest<Solicitud>();
    const accion = this.reflector.getAllAndOverride<string | undefined>(PERMISO, [contexto.getHandler(), contexto.getClass()])
      ?? this.reflector.getAllAndOverride<string | undefined>(SOLO_AUTENTICADO, [contexto.getHandler(), contexto.getClass()]);
    if (!solicitud.sesion || typeof accion !== 'string') return siguiente.handle();

    const sesion = solicitud.sesion;
    const contextoCliente = contextoDesdeEncabezados(solicitud.headers);
    const titular = titularObjetivo(solicitud);
    const registrar = async (resultado: ResultadoAuditoria, estado: number) => {
      await this.auditoria.intentarRegistrar({
        actor: sesion, accion, resultado, contexto: contextoCliente,
        recurso: [solicitud.method, solicitud.path.slice(0, 90), ...(titular ? [`titular:${titular}`] : [])].join(' ').slice(0, 120),
        detalle: { estado, parametros: solicitud.params }
      });
      // Actividad 7: accesos del personal a datos de titulares (alertas A2 y A3).
      if (titular && sesion.rol !== 'usuario') await this.alertas.evaluarAccesoPersonal(sesion, contextoCliente, accion);
      // Alerta A4: accesos denegados repetidos.
      if (resultado === 'denegado') await this.alertas.evaluarDenegaciones(sesion, contextoCliente);
    };

    return siguiente.handle().pipe(
      mergeMap((valor) => from(registrar('exito', 200)).pipe(mergeMap(() => [valor]))),
      catchError((error: unknown) => {
        const estado = error instanceof HttpException ? error.getStatus() : 500;
        return from(registrar(estado === 403 ? 'denegado' : 'fallo', estado)).pipe(mergeMap(() => throwError(() => error)));
      })
    );
  }
}
