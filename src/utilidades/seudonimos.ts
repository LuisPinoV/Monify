import { randomBytes, randomInt } from 'node:crypto';

export type TipoSeudonimo = 'nombre' | 'rut' | 'telefono' | 'correo';

const ANIMALES = [
  'Zorro', 'Condor', 'Puma', 'Huemul', 'Delfin', 'Pudu', 'Guanaco', 'Chinchilla',
  'Tucan', 'Nutria', 'Lobo', 'Halcon', 'Ballena', 'Vicuna', 'Cisne', 'Flamenco'
];
const COLORES = [
  'Azul', 'Rojo', 'Verde', 'Ambar', 'Violeta', 'Plata', 'Cobre', 'Coral',
  'Indigo', 'Marfil', 'Granate', 'Turquesa', 'Ocre', 'Jade', 'Gris', 'Menta'
];

// Los seudónimos no guardan ninguna relación con el dato original: son valores aleatorios.
export function generarSeudonimo(tipo: TipoSeudonimo): string {
  switch (tipo) {
    case 'nombre':
      return `${ANIMALES[randomInt(ANIMALES.length)]}-${COLORES[randomInt(COLORES.length)]}-${randomBytes(3).toString('hex')}`;
    case 'rut':
      return `ID-${String(randomInt(0, 10 ** 10)).padStart(10, '0')}`;
    case 'telefono':
      return `TEL-${String(randomInt(0, 10 ** 8)).padStart(8, '0')}`;
    case 'correo':
      return `u-${randomBytes(8).toString('hex')}@seudonimo.monify.invalid`;
  }
}

export function esSeudonimo(valor: string | null | undefined): boolean {
  if (!valor) return false;
  return /^ID-\d{10}$/.test(valor) || /^TEL-\d{8}$/.test(valor)
    || /^u-[0-9a-f]{16}@seudonimo\.monify\.invalid$/.test(valor)
    || /^[A-Za-z]+-[A-Za-z]+-[0-9a-f]{6}$/.test(valor);
}

// Valor irreversible usado al anonimizar una cuenta: no existe forma de volver al dato original.
export function generarAnonimo(prefijo: string): string {
  return `ANON-${prefijo}-${randomBytes(6).toString('hex')}`;
}
