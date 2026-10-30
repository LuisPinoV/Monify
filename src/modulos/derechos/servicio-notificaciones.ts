import { Injectable, Logger } from '@nestjs/common';

export interface EnvioCodigo {
  destinoEnmascarado: string;
  // Solo en desarrollo: el proyecto no tiene un proveedor de correo y el código se entrega en la respuesta para poder probar el flujo.
  codigoDesarrollo?: string;
}

export function enmascararCorreo(correo: string): string {
  const [usuario, dominio] = correo.split('@');
  if (!dominio) return '***';
  return `${usuario.slice(0, 1)}***@${dominio}`;
}

/**
 * Envío del código de un solo uso para verificar la identidad en solicitudes de derechos.
 * LIMITACIÓN DOCUMENTADA: no hay infraestructura de correo disponible en el proyecto. Se simula el envío:
 * en desarrollo el código vuelve en la respuesta (campo codigoDesarrollo) y nunca se escribe en la base
 * ni en la bitácora; en producción se debe conectar un proveedor (SMTP o API transaccional) en este servicio.
 */
@Injectable()
export class ServicioNotificaciones {
  private readonly logger = new Logger(ServicioNotificaciones.name);

  async enviarCodigo(destino: string, codigo: string, motivo: string): Promise<EnvioCodigo> {
    const destinoEnmascarado = enmascararCorreo(destino);
    const desarrollo = (process.env.ENTORNO ?? 'desarrollo') !== 'produccion';
    this.logger.log(`Código de verificación (${motivo}) enviado a ${destinoEnmascarado} [envío simulado]`);
    return desarrollo ? { destinoEnmascarado, codigoDesarrollo: codigo } : { destinoEnmascarado };
  }
}
