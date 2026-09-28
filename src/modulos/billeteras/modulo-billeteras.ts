import { Module } from '@nestjs/common';
import { ControladorBilleteras } from './controlador-billeteras';
import { ServicioBilleteras } from './servicio-billeteras';

@Module({
  controllers: [ControladorBilleteras],
  providers: [ServicioBilleteras],
  exports: [ServicioBilleteras]
})
export class ModuloBilleteras {}