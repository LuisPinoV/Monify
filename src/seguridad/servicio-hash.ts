import { Injectable } from '@nestjs/common';
import bcrypt from 'bcrypt';

@Injectable()
export class ServicioHash {
  private readonly rondas = 12;

  hash(value: string): Promise<string> {
    return bcrypt.hash(value, this.rondas);
  }

  compare(value: string, hash: string): Promise<boolean> {
    return bcrypt.compare(value, hash);
  }
}