import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Alcance } from './servicio-autorizacion';

// Restringe el alcance autorizado a un titular concreto (si se pidió) o lo deja tal cual.
export function acotarAlcance(alcance: Alcance, usuarioId?: number): Alcance {
  if (usuarioId === undefined) return alcance;
  if (alcance.tipo === 'ids' && !alcance.ids.includes(usuarioId)) {
    throw new ForbiddenException('no tienes autorización para acceder a los datos de este titular');
  }
  return { tipo: 'ids', ids: [usuarioId] };
}

// Fragmento SQL para filtrar por titulares; `primerParametro` es el índice ($n) siguiente disponible.
export function condicionAlcance(alcance: Alcance, columna: string, primerParametro: number): { sql: string; parametros: unknown[] } {
  return alcance.tipo === 'todos'
    ? { sql: 'TRUE', parametros: [] }
    : { sql: `${columna} = ANY($${primerParametro}::int[])`, parametros: [alcance.ids] };
}

export function enteroOpcional(valor: unknown, nombre: string): number | undefined {
  if (valor === undefined || valor === '') return undefined;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) throw new BadRequestException(`${nombre} debe ser un entero positivo`);
  return numero;
}
