import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface ValorCifrado {
  ciphertext: string;
  iv: string;
  authTag: string;
}

@Injectable()
export class ServicioCifrado {
  private readonly clave: Buffer;

  constructor(config: ConfigService) {
    const valor = config.get<string>('ENCRYPTION_KEY');
    if (!valor) {
      throw new Error('ENCRYPTION_KEY es obligatoria para iniciar la aplicación');
    }
    this.clave = Buffer.from(valor, 'base64');
    if (this.clave.length !== 32) {
      throw new Error('ENCRYPTION_KEY debe ser una clave base64 de 32 bytes');
    }
  }

  encrypt(value: string): ValorCifrado {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.clave, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64')
    };
  }

  decrypt(value: ValorCifrado): string {
    const decipher = createDecipheriv(
      'aes-256-gcm', this.clave, Buffer.from(value.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8');
  }

  encryptPacked(value: string): string {
    const encrypted = this.encrypt(value);
    return `v1.${encrypted.iv}.${encrypted.authTag}.${encrypted.ciphertext}`;
  }

  decryptPacked(value: string | null): string | null {
    if (value === null) return null;
    if (!value.startsWith('v1.')) return value;
    const [, iv, authTag, ciphertext] = value.split('.');
    return this.decrypt({ ciphertext, iv, authTag });
  }
}