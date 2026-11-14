const CLAVES_SENSIBLES = /^(password|contrasena|contraseña|token|rut|email|correo|celular|telefono|teléfono|numeroTarjeta|numero_tarjeta|cvv)$/i;
const RUT = /\b\d{1,2}\.?\d{3}\.?\d{3}-[0-9kK]\b/g;
const CORREO = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TELEFONO = /(?<!\d)(?:\+?56)?9\d{8}(?!\d)/g;
const TARJETA = /(?<!\d)\d{13,19}(?!\d)/g;

const REDACTADO = '[redactado]';

function claveSensitiva(clave: string): boolean {
  return CLAVES_SENSIBLES.test(clave);
}

export function sanitizarTexto(valor: string): string {
  return valor
    .replace(RUT, REDACTADO)
    .replace(CORREO, REDACTADO)
    .replace(TELEFONO, REDACTADO)
    .replace(TARJETA, REDACTADO);
}

export function sanitizarRecurso(ruta: string, referencia?: string): string {
  const sinConsulta = ruta.split('?')[0] ?? ruta;
  const sanitizada = sanitizarTexto(sinConsulta).replace(
    /\/(password|contrasena|contraseña|token|rut|email|correo|celular|telefono|teléfono|numeroTarjeta|numero_tarjeta|cvv)\/[^/]+/gi,
    '/$1/' + REDACTADO
  );
  return [sanitizada, referencia ? sanitizarTexto(referencia) : undefined].filter(Boolean).join(' ').slice(0, 120);
}

export function sanitizarParametros(parametros: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(parametros).map(([clave, valor]) => [
    clave,
    claveSensitiva(clave) ? REDACTADO : typeof valor === 'string' ? sanitizarTexto(valor) : valor
  ]));
}
