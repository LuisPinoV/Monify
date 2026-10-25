import { Global, Module } from '@nestjs/common';
import { ControladorAutorizacion } from './controlador-autorizacion';
import { ServicioAutorizacion } from './servicio-autorizacion';
import { ServicioAutorizaciones } from './servicio-autorizaciones';

@Global()
@Module({
  controllers: [ControladorAutorizacion],
  providers: [ServicioAutorizacion, ServicioAutorizaciones],
  exports: [ServicioAutorizacion, ServicioAutorizaciones]
})
export class ModuloAutorizacion {}
