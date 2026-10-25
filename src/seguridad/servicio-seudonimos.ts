import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, type QueryResultRow } from 'pg';
import { generarSeudonimo, type TipoSeudonimo } from '../utilidades/seudonimos';
import { PersistenciaCifrada } from './persistencia-cifrada';

const INTENTOS_UNICIDAD = 8;

// Deriva la URL de la bóveda: misma instancia, base de datos distinta ("<base>_vault").
export function urlBoveda(entorno: NodeJS.ProcessEnv = process.env): string {
  if (entorno.VAULT_DATABASE_URL) return entorno.VAULT_DATABASE_URL;
  if (!entorno.DATABASE_URL) throw new Error('VAULT_DATABASE_URL o DATABASE_URL son obligatorias para la bóveda de seudónimos');
  const url = new URL(entorno.DATABASE_URL);
  url.pathname = `${url.pathname.replace(/\/$/, '') || '/monify'}_vault`;
  return url.toString();
}

/**
 * Seudonimización reversible. En la base principal solo viven los seudónimos; el valor original se
 * guarda cifrado (híbrido AES-256-GCM + RSA-OAEP) en una base de datos separada, de modo que una
 * filtración de la base principal no revela datos personales.
 */
@Injectable()
export class ServicioSeudonimos implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServicioSeudonimos.name);
  private pool!: Pool;

  constructor(private readonly persistenciaCifrada: PersistenciaCifrada) {}

  async onModuleInit(): Promise<void> {
    const destino = urlBoveda();
    try {
      await this.crearTabla(destino);
    } catch (error) {
      if ((error as { code?: string }).code !== '3D000') throw error;
      await this.crearBaseDeDatos(destino);
      await this.crearTabla(destino);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  // Genera un seudónimo único para el valor original y lo registra en la bóveda.
  async seudonimizar(tipo: TipoSeudonimo, original: string): Promise<string> {
    for (let intento = 0; intento < INTENTOS_UNICIDAD; intento += 1) {
      const seudonimo = generarSeudonimo(tipo);
      const resultado = await this.pool.query(
        `INSERT INTO "BovedaSeudonimos" ("seudonimo", "tipo", "valorCifrado")
         VALUES ($1, $2, $3) ON CONFLICT ("seudonimo") DO NOTHING`,
        [seudonimo, tipo, this.persistenciaCifrada.protegerCampoHibrido(original)]
      );
      if ((resultado.rowCount ?? 0) > 0) return seudonimo;
    }
    throw new Error('no se pudo generar un seudónimo único');
  }

  async revelar(seudonimo: string | null | undefined): Promise<string | null> {
    if (!seudonimo) return null;
    const resultado = await this.pool.query<{ valorCifrado: string }>(
      'SELECT "valorCifrado" FROM "BovedaSeudonimos" WHERE "seudonimo" = $1', [seudonimo]
    );
    if (resultado.rows.length === 0) return null;
    return this.persistenciaCifrada.revelarCampo<string>(resultado.rows[0].valorCifrado);
  }

  async actualizar(seudonimo: string, nuevoOriginal: string): Promise<void> {
    await this.pool.query(
      'UPDATE "BovedaSeudonimos" SET "valorCifrado" = $2 WHERE "seudonimo" = $1',
      [seudonimo, this.persistenciaCifrada.protegerCampoHibrido(nuevoOriginal)]
    );
  }

  // Borrar el vínculo convierte el seudónimo en un dato anónimo (irreversible).
  async eliminar(seudonimos: Array<string | null | undefined>): Promise<void> {
    const validos = seudonimos.filter((valor): valor is string => Boolean(valor));
    if (validos.length === 0) return;
    await this.pool.query('DELETE FROM "BovedaSeudonimos" WHERE "seudonimo" = ANY($1::text[])', [validos]);
  }

  private async crearTabla(destino: string): Promise<void> {
    this.pool = this.pool ?? new Pool({ connectionString: destino, max: Number(process.env.VAULT_POOL_MAX ?? 5) });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS "BovedaSeudonimos" (
        "seudonimo"    TEXT PRIMARY KEY,
        "tipo"         VARCHAR(20) NOT NULL,
        "valorCifrado" TEXT NOT NULL,
        "creadoEn"     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  private async crearBaseDeDatos(destino: string): Promise<void> {
    await this.pool?.end().catch(() => undefined);
    this.pool = undefined as unknown as Pool;
    const nombre = decodeURIComponent(new URL(destino).pathname.slice(1));
    if (!/^[A-Za-z0-9_]+$/.test(nombre)) throw new Error('nombre de base de datos de la bóveda inválido');
    const administracion = new Pool({ connectionString: process.env.DATABASE_URL ?? destino, max: 1 });
    try {
      await administracion.query<QueryResultRow>(`CREATE DATABASE "${nombre}"`);
      this.logger.log(`Base de datos de la bóveda "${nombre}" creada`);
    } catch (error) {
      if ((error as { code?: string }).code !== '42P04') throw error;
    } finally {
      await administracion.end();
    }
  }
}
