import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, from, mergeMap, throwError, type Observable } from 'rxjs';
import { PERMISO, SOLO_AUTENTICADO } from '../autorizacion/decoradores';
import type { Sesion } from '../autorizacion/roles';
import { contextoDesdeEncabezados } from '../../utilidades/contexto-cliente';
import { ServicioAuditoria, type ResultadoAuditoria } from './servicio-auditoria';

interface Solicitud {
  sesion?: Sesion;
  method: string;
  path: string;
  params: Record<string, string>;
  headers: import('node:http').IncomingHttpHeaders;
}

/** Registra en la bitácora cada acción autenticada (éxito, rechazo o fallo) con su canal y dispositivo. */
@Injectable()
export class InterceptorAuditoria implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditoria: ServicioAuditoria
  ) {}

  intercept(contexto: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    const solicitud = contexto.switchToHttp().getRequest<Solicitud>();
    const accion = this.reflector.getAllAndOverride<string | undefined>(PERMISO, [contexto.getHandler(), contexto.getClass()])
      ?? this.reflector.getAllAndOverride<string | undefined>(SOLO_AUTENTICADO, [contexto.getHandler(), contexto.getClass()]);
    if (!solicitud.sesion || typeof accion !== 'string') return siguiente.handle();

    const registrar = (resultado: ResultadoAuditoria, estado: number) => this.auditoria.intentarRegistrar({
      actor: solicitud.sesion, accion, resultado, contexto: contextoDesdeEncabezados(solicitud.headers),
      recurso: [solicitud.method, solicitud.path].join(' ').slice(0, 120),
      detalle: { estado, parametros: solicitud.params }
    });

    return siguiente.handle().pipe(
      mergeMap((valor) => from(registrar('exito', 200)).pipe(mergeMap(() => [valor]))),
      catchError((error: unknown) => {
        const estado = error instanceof HttpException ? error.getStatus() : 500;
        return from(registrar(estado === 403 ? 'denegado' : 'fallo', estado)).pipe(mergeMap(() => throwError(() => error)));
      })
    );
  }
}
