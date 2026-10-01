import { Injectable } from '@nestjs/common';
import { ServicioCifrado, type ValorCifrado } from './servicio-cifrado';

export type DatosSensibles = Record<string, unknown>;

export type CamposCifrados = Record<string, ValorCifrado>;

@Injectable()
export class PersistenciaCifrada {
  constructor(private readonly cifrado: ServicioCifrado) {}

  proteger(datos: DatosSensibles): ValorCifrado {
    return this.cifrado.encrypt(JSON.stringify(datos));
  }

  protegerCampo(value: unknown): string {
    return this.cifrado.encryptPacked(JSON.stringify(value));
  }

  revelarCampo<T>(value: string | null): T | null {
    const plain = this.cifrado.decryptPacked(value);
    if (plain === null) return null;
    try {
      return JSON.parse(plain) as T;
    } catch {
      return plain as T;
    }
  }

  protegerCampos(datos: DatosSensibles): CamposCifrados {
    return Object.fromEntries(
      Object.entries(datos)
        .filter(([, value]) => value !== undefined)
        .map(([campo, value]) => [campo, this.cifrado.encrypt(JSON.stringify(value))])
    );
  }

  revelar<T extends DatosSensibles>(valor: ValorCifrado | null): T {
    if (!valor) return {} as T;
    try {
      return JSON.parse(this.cifrado.decrypt(valor)) as T;
    } catch {
      // Un registro cifrado con una clave anterior no debe bloquear todo el listado.
      return {} as T;
    }
  }

  revelarCampos<T extends DatosSensibles>(campos: CamposCifrados | null): T {
    if (!campos) return {} as T;
    const datos: DatosSensibles = {};
    for (const [campo, valor] of Object.entries(campos)) {
      try {
        datos[campo] = JSON.parse(this.cifrado.decrypt(valor));
      } catch {
        continue;
      }
    }
    return datos as T;
  }
}