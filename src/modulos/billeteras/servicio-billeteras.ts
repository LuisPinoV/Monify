import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BaseDatos, type Ejecutor } from '../../base-datos';
import { PersistenciaCifrada } from '../../seguridad/persistencia-cifrada';
import type { Banco, Billetera, TarjetaVista } from '../../tipos';
import { ServicioConsentimientos } from '../terminos/servicio-consentimientos';

interface FilaTarjeta {
  idTarjeta: number;
  idBanco: number;
  nombreBanco: string;
  numeroTarjeta: string;
  saldo: string;
}

export function validarNumeroTarjeta(numero: string): boolean {
  if (!/^\d{13,19}$/.test(numero)) return false;
  let suma = 0;
  for (let indice = 0; indice < numero.length; indice += 1) {
    let digito = Number(numero[numero.length - 1 - indice]);
    if (indice % 2 === 1) {
      digito *= 2;
      if (digito > 9) digito -= 9;
    }
    suma += digito;
  }
  return suma % 10 === 0;
}

@Injectable()
export class ServicioBilleteras {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly persistenciaCifrada: PersistenciaCifrada,
    private readonly consentimientos: ServicioConsentimientos
  ) {}

  async listarBancos(): Promise<Banco[]> {
    const resultado = await this.baseDatos.consultar<{ id: number; nombre: string }>(
      'SELECT "idBanco" AS id, "nombreBanco" AS nombre FROM "Banco" ORDER BY "nombreBanco"'
    );
    return resultado.rows.map((fila) => ({ id: String(fila.id), nombre: fila.nombre }));
  }

  async obtenerBilletera(usuarioId: number): Promise<Billetera> {
    const resultado = await this.baseDatos.consultar<FilaTarjeta>(`
      SELECT t."idTarjeta", t."idBanco", b."nombreBanco", t."numeroTarjeta", t."saldo"
      FROM "Billetera" w
      JOIN "Tarjeta" t ON t."idTarjeta" = w."idTarjeta"
      JOIN "Banco" b ON b."idBanco" = t."idBanco"
      WHERE w."idUsuario" = $1 ORDER BY t."idTarjeta"
    `, [usuarioId]);
    const tarjetas = resultado.rows.map((fila) => this.mapearTarjeta(fila));
    return {
      usuarioId: String(usuarioId),
      saldo: tarjetas.reduce((total, tarjeta) => total + tarjeta.saldo, 0),
      tarjetas
    };
  }

  async agregarTarjeta(usuarioId: number, bancoId: number, numeroTarjeta: string): Promise<TarjetaVista> {
    await this.consentimientos.exigirConsentimiento(usuarioId);
    const numero = numeroTarjeta.replace(/[\s-]/g, '');
    if (!validarNumeroTarjeta(numero)) throw new BadRequestException('numeroTarjeta no es un número de tarjeta válido');
    const banco = await this.baseDatos.consultar<{ nombreBanco: string }>('SELECT "nombreBanco" FROM "Banco" WHERE "idBanco" = $1', [bancoId]);
    if (banco.rows.length === 0) throw new NotFoundException('banco no encontrado');

    // Solo se guarda el número (cifrado); el CVV y la fecha de vencimiento los valida el procesador de pagos.
    const idTarjeta = await this.baseDatos.transaccion(async (tx) => {
      const tarjeta = await tx.consultar<{ idTarjeta: number }>(
        'INSERT INTO "Tarjeta" ("idBanco", "numeroTarjeta", "saldo") VALUES ($1, $2, $3) RETURNING "idTarjeta"',
        [bancoId, this.persistenciaCifrada.protegerCampo(numero), this.persistenciaCifrada.protegerCampo(0)]
      );
      await tx.consultar('INSERT INTO "Billetera" ("idUsuario", "idTarjeta") VALUES ($1, $2)', [usuarioId, tarjeta.rows[0].idTarjeta]);
      return tarjeta.rows[0].idTarjeta;
    });
    return { id: String(idTarjeta), bancoId: String(bancoId), banco: banco.rows[0].nombreBanco, numeroEnmascarado: `•••• ${numero.slice(-4)}`, saldo: 0 };
  }

  async saldoTotal(usuarioId: number, ejecutor: Ejecutor = this.baseDatos, bloquear = false): Promise<number> {
    const resultado = await ejecutor.consultar<{ saldo: string }>(`
      SELECT t."saldo" FROM "Billetera" w JOIN "Tarjeta" t ON t."idTarjeta" = w."idTarjeta"
      WHERE w."idUsuario" = $1 ${bloquear ? 'FOR UPDATE OF t' : ''}
    `, [usuarioId]);
    return resultado.rows.reduce((total, fila) => total + Number(this.persistenciaCifrada.revelarCampo<number>(fila.saldo) ?? 0), 0);
  }

  // Devuelve el saldo de una tarjeta del titular, bloqueando la fila durante la transacción.
  async saldoTarjetaPropia(usuarioId: number, tarjetaId: number, ejecutor: Ejecutor): Promise<number> {
    const resultado = await ejecutor.consultar<{ saldo: string }>(`
      SELECT t."saldo" FROM "Billetera" w JOIN "Tarjeta" t ON t."idTarjeta" = w."idTarjeta"
      WHERE w."idUsuario" = $1 AND t."idTarjeta" = $2 FOR UPDATE OF t
    `, [usuarioId, tarjetaId]);
    if (resultado.rows.length === 0) throw new NotFoundException('tarjeta no encontrada en tu billetera');
    return Number(this.persistenciaCifrada.revelarCampo<number>(resultado.rows[0].saldo) ?? 0);
  }

  async actualizarSaldo(tarjetaId: number, saldo: number, ejecutor: Ejecutor): Promise<void> {
    await ejecutor.consultar('UPDATE "Tarjeta" SET "saldo" = $2 WHERE "idTarjeta" = $1', [tarjetaId, this.persistenciaCifrada.protegerCampo(saldo)]);
  }

  private mapearTarjeta(fila: FilaTarjeta): TarjetaVista {
    const numero = this.persistenciaCifrada.revelarCampo<string>(fila.numeroTarjeta) ?? '';
    return {
      id: String(fila.idTarjeta),
      bancoId: String(fila.idBanco),
      banco: fila.nombreBanco,
      numeroEnmascarado: numero.length >= 4 ? `•••• ${numero.slice(-4)}` : '••••',
      saldo: Number(this.persistenciaCifrada.revelarCampo<number>(fila.saldo) ?? 0)
    };
  }
}
