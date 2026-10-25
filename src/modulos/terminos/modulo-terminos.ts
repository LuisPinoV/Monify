import { Global, Module } from '@nestjs/common';
import { ControladorTerminos } from './controlador-terminos';
import { ServicioConsentimientos } from './servicio-consentimientos';

@Global()
@Module({
  controllers: [ControladorTerminos],
  providers: [ServicioConsentimientos],
  exports: [ServicioConsentimientos]
})
export class ModuloTerminos {}
