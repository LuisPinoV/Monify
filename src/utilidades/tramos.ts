export interface Tramo {
  codigo: string;
  etiqueta: string;
}

// Tramos de renta mensual en CLP: la evaluación solo necesita la capacidad de pago aproximada.
const LIMITES_RENTA: Array<{ hasta: number; tramo: Tramo }> = [
  { hasta: 500_000, tramo: { codigo: 'T1', etiqueta: 'Hasta $500.000' } },
  { hasta: 1_000_000, tramo: { codigo: 'T2', etiqueta: '$500.001 a $1.000.000' } },
  { hasta: 2_000_000, tramo: { codigo: 'T3', etiqueta: '$1.000.001 a $2.000.000' } },
  { hasta: 4_000_000, tramo: { codigo: 'T4', etiqueta: '$2.000.001 a $4.000.000' } },
  { hasta: Infinity, tramo: { codigo: 'T5', etiqueta: 'Más de $4.000.000' } }
];

// Tramos de días de mora o de deuda: generalizan la gravedad sin guardar la fecha exacta.
const LIMITES_DIAS: Array<{ hasta: number; tramo: Tramo }> = [
  { hasta: 0, tramo: { codigo: '0', etiqueta: 'Sin atraso' } },
  { hasta: 30, tramo: { codigo: '1-30', etiqueta: '1 a 30 días' } },
  { hasta: 90, tramo: { codigo: '31-90', etiqueta: '31 a 90 días' } },
  { hasta: 180, tramo: { codigo: '91-180', etiqueta: '91 a 180 días' } },
  { hasta: Infinity, tramo: { codigo: '181+', etiqueta: 'Más de 180 días' } }
];

export const MAYORIA_DE_EDAD = 18;

export function tramoRenta(monto: number): string {
  if (!Number.isFinite(monto) || monto < 0) throw new RangeError('la renta debe ser un número no negativo');
  return LIMITES_RENTA.find((limite) => monto <= limite.hasta)!.tramo.codigo;
}

export function tramoDias(dias: number): string {
  if (!Number.isFinite(dias) || dias < 0) throw new RangeError('los días deben ser un número no negativo');
  return LIMITES_DIAS.find((limite) => Math.floor(dias) <= limite.hasta)!.tramo.codigo;
}

export function etiquetaTramoRenta(codigo: string | null | undefined): string | undefined {
  return LIMITES_RENTA.find((limite) => limite.tramo.codigo === codigo)?.tramo.etiqueta;
}

export function etiquetaTramoDias(codigo: string | null | undefined): string | undefined {
  return LIMITES_DIAS.find((limite) => limite.tramo.codigo === codigo)?.tramo.etiqueta;
}

// Devuelve null si la fecha (AAAA-MM-DD) no es válida o está en el futuro.
export function esMayorDeEdad(fechaNacimiento: string, hoy: Date = new Date()): boolean | null {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaNacimiento.trim());
  if (!coincidencia) return null;
  const [anio, mes, dia] = coincidencia.slice(1).map(Number);
  const nacimiento = new Date(Date.UTC(anio, mes - 1, dia));
  if (nacimiento.getUTCFullYear() !== anio || nacimiento.getUTCMonth() !== mes - 1 || nacimiento.getUTCDate() !== dia) return null;
  const anioHoy = hoy.getUTCFullYear();
  const mesHoy = hoy.getUTCMonth();
  const diaHoy = hoy.getUTCDate();
  if (anio > anioHoy || (anio === anioHoy && (mes - 1 > mesHoy || (mes - 1 === mesHoy && dia > diaHoy)))) return null;
  let edad = anioHoy - anio;
  if (mesHoy < mes - 1 || (mesHoy === mes - 1 && diaHoy < dia)) edad -= 1;
  return edad >= MAYORIA_DE_EDAD;
}
