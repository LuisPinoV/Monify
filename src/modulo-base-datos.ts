import { Global, Module } from '@nestjs/common';
import { BaseDatos } from './base-datos';

@Global()
@Module({
  providers: [BaseDatos],
  exports: [BaseDatos]
})
export class ModuloBaseDatos {}