import { randomUUID } from 'node:crypto';

export function crearIdentificador(): string {
  return randomUUID();
}