import { Global, Module } from '@nestjs/common';
import { ControladorTerminos } from './controlador-terminos';
import { ServicioConsentimientos } from './servicio-consentimientos';
import { ServicioOposiciones } from './servicio-oposiciones';

@Global()
@Module({
  controllers: [ControladorTerminos],
  providers: [ServicioConsentimientos, ServicioOposiciones],
  exports: [ServicioConsentimientos, ServicioOposiciones]
})
export class ModuloTerminos {}
