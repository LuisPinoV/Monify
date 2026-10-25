import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PersistenciaCifrada } from './persistencia-cifrada';
import { ServicioCifrado } from './servicio-cifrado';
import { ServicioHash } from './servicio-hash';
import { ServicioSeudonimos } from './servicio-seudonimos';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [PersistenciaCifrada, ServicioCifrado, ServicioHash, ServicioSeudonimos],
  exports: [PersistenciaCifrada, ServicioCifrado, ServicioHash, ServicioSeudonimos]
})
export class ModuloSeguridad {}