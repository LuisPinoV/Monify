export const ROLES = ['admin', 'usuario', 'administrador_riesgo', 'auditor', 'operador_financiero'] as const;
export type Rol = (typeof ROLES)[number];

// Código seudonimizado con el que cada rol se guarda en la tabla "Rol".
export const CODIGO_ROL: Record<Rol, string> = {
  usuario: 'Tu',
  admin: 'Ta',
  administrador_riesgo: 'Tr',
  auditor: 'Tau',
  operador_financiero: 'To'
};

export function rolDesdeCodigo(codigo: string): Rol | undefined {
  return ROLES.find((rol) => CODIGO_ROL[rol] === codigo);
}

export function esRol(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor);
}

export type TipoCuenta = 'usuario' | 'administrador_riesgo';

// Identidad autenticada que viaja en el JWT. No incluye datos personales (correo, nombre, RUT).
export interface Sesion {
  id: number;
  cuenta: TipoCuenta;
  rol: Rol;
}
