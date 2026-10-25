import type { IncomingHttpHeaders } from 'node:http';

export const CANALES = ['web', 'movil', 'api'] as const;
export type Canal = (typeof CANALES)[number];

export interface ContextoCliente {
  canal: Canal;
  dispositivo: string;
}

const LARGO_MAXIMO_DISPOSITIVO = 160;

// Se registra solo el canal y el dispositivo declarados; no se guarda la IP para minimizar datos personales.
export function contextoDesdeEncabezados(encabezados: IncomingHttpHeaders): ContextoCliente {
  const canalDeclarado = String(encabezados['x-canal'] ?? '').toLowerCase();
  const canal = (CANALES as readonly string[]).includes(canalDeclarado) ? (canalDeclarado as Canal) : 'api';
  const dispositivoDeclarado = String(encabezados['x-dispositivo'] ?? encabezados['user-agent'] ?? 'desconocido');
  const dispositivo = dispositivoDeclarado.replace(/[\r\n\t]+/g, ' ').trim().slice(0, LARGO_MAXIMO_DISPOSITIVO) || 'desconocido';
  return { canal, dispositivo };
}

export function motivoDesdeEncabezados(encabezados: IncomingHttpHeaders): string | undefined {
  const motivo = encabezados['x-motivo-acceso'];
  const valor = (Array.isArray(motivo) ? motivo[0] : motivo)?.trim();
  return valor ? valor.slice(0, 200) : undefined;
}
