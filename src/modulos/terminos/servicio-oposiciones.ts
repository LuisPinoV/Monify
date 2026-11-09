import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BaseDatos, type Ejecutor } from '../../base-datos';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';

/**
 * Actividad 6, punto 6: oposición (bloqueo) de un tratamiento concreto.
 *
 * Se eligió el cálculo y uso del score de comportamiento financiero porque es un perfilamiento: valora el
 * comportamiento del titular para predecir su riesgo y el titular puede oponerse a él (Ley 19.628 modificada por la
 * Ley 21.719, derecho de oposición y a no ser objeto de decisiones basadas solo en tratamiento automatizado). A
 * diferencia del KYC, las transacciones o el registro de morosidad, no es necesario para ejecutar el contrato de la
 * billetera ni lo exige una ley, así que se puede bloquear sin cerrar la cuenta. Revocar el consentimiento
 * "evaluacion_crediticia" bloquearía todo el sistema; la oposición es granular: el crédito se sigue evaluando,
 * pero solo con morosidad, tramos y renta, y con revisión humana.
 */
export const TRATAMIENTOS_OPONIBLES = {
  score_comportamiento: {
    nombre: 'Score de comportamiento financiero',
    descripcion: 'Cálculo, registro y uso del puntaje (score) que perfila tu comportamiento financiero para evaluar tu riesgo de crédito.',
    efecto: 'Mientras la oposición esté vigente no se registran scores nuevos para ti, los ya registrados quedan bloqueados (no se muestran '
      + 'al personal ni se usan en evaluaciones) y tus solicitudes de crédito se evalúan sin score, con revisión humana. Puedes levantarla cuando quieras.'
  }
} as const;
export type TratamientoOponible = keyof typeof TRATAMIENTOS_OPONIBLES;

export function esTratamientoOponible(valor: unknown): valor is TratamientoOponible {
  return typeof valor === 'string' && Object.prototype.hasOwnProperty.call(TRATAMIENTOS_OPONIBLES, valor);
}

export interface Oposicion {
  id: string;
  tratamiento: TratamientoOponible;
  nombre: string;
  vigente: boolean;
  vigenteDesde: string;
  levantadaEn: string | null;
  solicitudId: string;
}

interface FilaOposicion {
  idOposicion: number;
  tratamiento: TratamientoOponible;
  idSolicitudDerecho: number;
  vigenteDesde: Date;
  levantadaEn: Date | null;
}

@Injectable()
export class ServicioOposiciones {
  constructor(private readonly baseDatos: BaseDatos) {}

  async listar(usuarioId: number): Promise<Oposicion[]> {
    const resultado = await this.baseDatos.consultar<FilaOposicion>(
      'SELECT * FROM "OposicionTratamiento" WHERE "idUsuario" = $1 ORDER BY "idOposicion" DESC', [usuarioId]
    );
    return resultado.rows.map((fila) => ({
      id: String(fila.idOposicion), tratamiento: fila.tratamiento, nombre: TRATAMIENTOS_OPONIBLES[fila.tratamiento]?.nombre ?? fila.tratamiento,
      vigente: fila.levantadaEn === null, vigenteDesde: new Date(fila.vigenteDesde).toISOString(),
      levantadaEn: fila.levantadaEn ? new Date(fila.levantadaEn).toISOString() : null, solicitudId: String(fila.idSolicitudDerecho)
    }));
  }

  async vigentes(usuarioId: number, ejecutor: Ejecutor = this.baseDatos): Promise<TratamientoOponible[]> {
    const resultado = await ejecutor.consultar<{ tratamiento: TratamientoOponible }>(
      'SELECT "tratamiento" FROM "OposicionTratamiento" WHERE "idUsuario" = $1 AND "levantadaEn" IS NULL ORDER BY "tratamiento"', [usuarioId]
    );
    return resultado.rows.map((fila) => fila.tratamiento);
  }

  // Titulares (de la lista dada, o todos si no se indica) con una oposición vigente al tratamiento.
  async titularesOpuestos(tratamiento: TratamientoOponible, usuarioIds?: number[]): Promise<Set<number>> {
    const resultado = await this.baseDatos.consultar<{ idUsuario: number }>(`
      SELECT "idUsuario" FROM "OposicionTratamiento"
      WHERE "tratamiento" = $1 AND "levantadaEn" IS NULL AND ($2::int[] IS NULL OR "idUsuario" = ANY($2::int[]))
    `, [tratamiento, usuarioIds ?? null]);
    return new Set(resultado.rows.map((fila) => Number(fila.idUsuario)));
  }

  async estaOpuesto(usuarioId: number, tratamiento: TratamientoOponible): Promise<boolean> {
    return (await this.titularesOpuestos(tratamiento, [usuarioId])).has(usuarioId);
  }

  // La registra el módulo de derechos al ejecutar una solicitud de oposición ya verificada.
  async registrar(ejecutor: Ejecutor, usuarioId: number, tratamiento: TratamientoOponible, solicitudId: number): Promise<void> {
    try {
      await ejecutor.consultar(
        'INSERT INTO "OposicionTratamiento" ("idUsuario", "tratamiento", "idSolicitudDerecho") VALUES ($1, $2, $3)', [usuarioId, tratamiento, solicitudId]
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('ya tienes una oposición vigente a este tratamiento');
      throw error;
    }
  }

  async levantar(usuarioId: number, tratamiento: TratamientoOponible, contexto: ContextoCliente): Promise<void> {
    const resultado = await this.baseDatos.consultar(
      'UPDATE "OposicionTratamiento" SET "levantadaEn" = now(), "canalLevantamiento" = $3 WHERE "idUsuario" = $1 AND "tratamiento" = $2 AND "levantadaEn" IS NULL',
      [usuarioId, tratamiento, contexto.canal]
    );
    if ((resultado.rowCount ?? 0) === 0) throw new NotFoundException('no tienes una oposición vigente a este tratamiento');
  }
}
