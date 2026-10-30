import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';

// Lo implementan BaseDatos y el ejecutor de una transacción, para que los servicios acepten cualquiera de los dos.
export interface Ejecutor {
  consultar<T extends QueryResultRow>(texto: string, parametros?: unknown[]): Promise<QueryResult<T>>;
}

@Injectable()
export class BaseDatos implements Ejecutor, OnModuleInit, OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monify',
    max: Number(process.env.DATABASE_POOL_MAX ?? 10)
  });

  async onModuleInit(): Promise<void> {
    const rutasEsquema = [
      resolve(process.cwd(), 'db/init/01-monify_schema.sql'),
      resolve(process.cwd(), 'monify_schema.sql')
    ];
    const rutaEsquema = await this.encontrarEsquema(rutasEsquema);
    const esquema = await readFile(rutaEsquema, 'utf8');
    await this.pool.query(esquema);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  consultar<T extends QueryResultRow>(texto: string, parametros: unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.query<T>(texto, parametros);
  }

  async transaccion<T>(trabajo: (ejecutor: Ejecutor) => Promise<T>): Promise<T> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      const resultado = await trabajo({
        consultar: <R extends QueryResultRow>(texto: string, parametros: unknown[] = []) => cliente.query<R>(texto, parametros)
      });
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  }

  private async encontrarEsquema(rutas: string[]): Promise<string> {
    for (const ruta of rutas) {
      try {
        await access(ruta);
        return ruta;
      } catch {
        continue;
      }
    }
    throw new Error('No se encontró el esquema SQL en db/init/01-monify_schema.sql');
  }
}
// Declara dentro de la transacción quién actúa y desde qué canal/dispositivo; los triggers de
// consentimientos y de solicitudes de derechos lo copian a sus logs (fuera de la API queda "bd_directa").
export async function fijarContexto(ejecutor: Ejecutor, valores: { canal?: string; dispositivo?: string; actor?: string }): Promise<void> {
  await ejecutor.consultar(
    `SELECT set_config('monify.canal', $1, true), set_config('monify.dispositivo', $2, true), set_config('monify.actor', $3, true)`,
    [valores.canal ?? '', valores.dispositivo ?? '', valores.actor ?? '']
  );
}
