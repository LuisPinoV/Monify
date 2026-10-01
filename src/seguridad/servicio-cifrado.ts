import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';

export interface ValorCifrado {
  ciphertext: string;
  iv: string;
  authTag: string;
}

@Injectable()
export class ServicioCifrado {
  private readonly clave: Buffer;
  private readonly clavePublica: string;
  private readonly clavePrivada: string;

  constructor(config: ConfigService) {
    const valor = config.get<string>('ENCRYPTION_KEY');
    if (!valor) {
      throw new Error('ENCRYPTION_KEY es obligatoria para iniciar la aplicación');
    }
    this.clave = Buffer.from(valor, 'base64');
    if (this.clave.length !== 32) {
      throw new Error('ENCRYPTION_KEY debe ser una clave base64 de 32 bytes');
    }

    const publica = config.get<string>('RSA_PUBLIC_KEY');
    const privada = config.get<string>('RSA_PRIVATE_KEY');
    if (!publica || !privada) {
      throw new Error('RSA_PUBLIC_KEY y RSA_PRIVATE_KEY son obligatorias para iniciar la aplicación');
    }
    this.clavePublica = publica.replace(/\\n/g, '\n');
    this.clavePrivada = privada.replace(/\\n/g, '\n');
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

  // Cifrado asimétrico directo con RSA-OAEP, para valores pequeños que no requieren una clave compartida.
  encryptAsimetrico(value: string): string {
    const ciphertext = publicEncrypt(
      { key: this.clavePublica, oaepHash: 'sha256' },
      Buffer.from(value, 'utf8')
    );
    return ciphertext.toString('base64');
  }

  decryptAsimetrico(value: string): string {
    const plano = privateDecrypt(
      { key: this.clavePrivada, oaepHash: 'sha256' },
      Buffer.from(value, 'base64')
    );
    return plano.toString('utf8');
  }

  encryptPackedAsimetrico(value: string): string {
    return `va1.${this.encryptAsimetrico(value)}`;
  }

  // Cifrado híbrido: una clave AES-256 aleatoria por valor cifra el dato, y esa clave se envuelve con RSA-OAEP.
  encryptPackedHibrido(value: string): string {
    const claveSesion = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', claveSesion, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const claveEnvuelta = publicEncrypt({ key: this.clavePublica, oaepHash: 'sha256' }, claveSesion);
    return `vh1.${claveEnvuelta.toString('base64')}.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ciphertext.toString('base64')}`;
  }

  private decryptHibrido(value: string): string {
    const [, claveEnvuelta, iv, authTag, ciphertext] = value.split('.');
    const claveSesion = privateDecrypt({ key: this.clavePrivada, oaepHash: 'sha256' }, Buffer.from(claveEnvuelta, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', claveSesion, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }

  // Índice de búsqueda determinista (HMAC), para detectar duplicados sin poder revertirlo al valor original.
  hashDeterminista(value: string): string {
    return createHmac('sha256', this.clave).update(value, 'utf8').digest('hex');
  }

  decryptPacked(value: string | null): string | null {
    if (value === null) return null;
    if (value.startsWith('vh1.')) {
      return this.decryptHibrido(value);
    }
    if (value.startsWith('va1.')) {
      return this.decryptAsimetrico(value.slice('va1.'.length));
    }
    if (!value.startsWith('v1.')) return value;
    const [, iv, authTag, ciphertext] = value.split('.');
    return this.decrypt({ ciphertext, iv, authTag });
  }
}