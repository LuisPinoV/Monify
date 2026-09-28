import { Module } from '@nestjs/common';
import { ControladorUsuarios } from './controlador-usuarios';
import { ServicioUsuarios } from './servicio-usuarios';

@Module({
  controllers: [ControladorUsuarios],
  providers: [ServicioUsuarios],
  exports: [ServicioUsuarios]
})
export class ModuloUsuarios {}