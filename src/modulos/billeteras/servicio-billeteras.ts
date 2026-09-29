import type { Billetera } from '../../tipos.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { BaseDatos } from '../../base-datos';

@Injectable()
export class ServicioBilleteras {
  constructor(private readonly baseDatos: BaseDatos) {}

  async listar(): Promise<Billetera[]> {
    const resultado = await this.baseDatos.consultar<BilleteraRow>(`
      SELECT "idUsuario" AS id, "idUsuario" AS "usuarioId", "Saldo" AS saldo
      FROM "Usuario"
      ORDER BY "idUsuario"
    `);
    return resultado.rows.map((fila) => ({
      id: String(fila.id), usuarioId: String(fila.usuarioId), saldo: Number(fila.saldo)
    }));
  }

  async crear(usuarioId: string): Promise<Billetera> {
    const resultado = await this.baseDatos.consultar<BilleteraRow>(`
      SELECT "idUsuario" AS id, "idUsuario" AS "usuarioId", "Saldo" AS saldo
      FROM "Usuario" WHERE "idUsuario" = $1
    `, [Number(usuarioId)]);
    if (resultado.rowCount === 0) {
      throw new NotFoundException('usuario no encontrado');
    }
    const fila = resultado.rows[0];
    return { id: String(fila.id), usuarioId: String(fila.usuarioId), saldo: Number(fila.saldo) };
  }
}

interface BilleteraRow {
  id: number;
  usuarioId: number;
  saldo: string | number;
}