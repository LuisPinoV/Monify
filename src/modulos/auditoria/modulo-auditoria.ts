import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ControladorAuditoria } from './controlador-auditoria';
import { InterceptorAuditoria } from './interceptor-auditoria';
import { ServicioAlertas } from './servicio-alertas';
import { ServicioAuditoria } from './servicio-auditoria';
import { ServicioNoRepudio } from './servicio-no-repudio';

@Global()
@Module({
  controllers: [ControladorAuditoria],
  providers: [ServicioAuditoria, ServicioNoRepudio, ServicioAlertas, { provide: APP_INTERCEPTOR, useClass: InterceptorAuditoria }],
  exports: [ServicioAuditoria, ServicioNoRepudio, ServicioAlertas]
})
export class ModuloAuditoria {}
