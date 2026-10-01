import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PersistenciaCifrada } from './persistencia-cifrada';
import { ServicioCifrado } from './servicio-cifrado';
import { ServicioHash } from './servicio-hash';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [PersistenciaCifrada, ServicioCifrado, ServicioHash],
  exports: [PersistenciaCifrada, ServicioCifrado, ServicioHash]
})
export class ModuloSeguridad {}