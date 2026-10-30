import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Accion } from './permisos';
import type { Sesion } from './roles';
import { contextoDesdeEncabezados, motivoDesdeEncabezados, type ContextoCliente } from '../../utilidades/contexto-cliente';

export const PERMISO = 'monify.permiso';
export const SOLO_AUTENTICADO = 'monify.soloAutenticado';
export const SIN_CONSENTIMIENTO = 'monify.sinConsentimiento';

// Exige que el rol de la sesión tenga la acción habilitada en la matriz RBAC.
export const Permiso = (accion: Accion) => SetMetadata(PERMISO, accion);

// Cualquier cuenta autenticada, sin una acción RBAC específica (por ejemplo, operar sobre su propio perfil).
// El nombre identifica la acción en la bitácora de auditoría.
export const SoloAutenticado = (nombreAccion: string) => SetMetadata(SOLO_AUTENTICADO, nombreAccion);

// Excepción a la regla de consentimiento: el titular puede usar el endpoint aunque le falte un consentimiento
// (gestión de consentimientos y ejercicio de derechos, Actividad 5). El resto queda bloqueado.
export const SinConsentimiento = () => SetMetadata(SIN_CONSENTIMIENTO, true);

interface SolicitudAutenticada {
  sesion?: Sesion;
  headers: import('node:http').IncomingHttpHeaders;
}

export const SesionActual = createParamDecorator((_dato: unknown, contexto: ExecutionContext): Sesion | undefined =>
  contexto.switchToHttp().getRequest<SolicitudAutenticada>().sesion);

export const ContextoActual = createParamDecorator((_dato: unknown, contexto: ExecutionContext): ContextoCliente =>
  contextoDesdeEncabezados(contexto.switchToHttp().getRequest<SolicitudAutenticada>().headers));

export const MotivoAcceso = createParamDecorator((_dato: unknown, contexto: ExecutionContext): string | undefined =>
  motivoDesdeEncabezados(contexto.switchToHttp().getRequest<SolicitudAutenticada>().headers));
