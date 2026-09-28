import { crearIdentificador } from '../../utilidades/identificador.js';
import type { Billetera } from '../../tipos.js';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ServicioBilleteras {
  private readonly billeteras: Billetera[] = [];

  listar(): Billetera[] {
    return this.billeteras;
  }

  crear(usuarioId: string): Billetera {
    const billetera: Billetera = {
      id: crearIdentificador(),
      usuarioId,
      moneda: 'CLP',
      saldo: 0
    };

    this.billeteras.push(billetera);
    return billetera;
  }
}