import { Module } from '@nestjs/common';
import { ModuloUsuarios } from '../usuarios/modulo-usuarios';
import { ControladorAdministracion } from './controlador-administracion';
import { ServicioAdminInicial } from './servicio-admin-inicial';

@Module({
  imports: [ModuloUsuarios],
  controllers: [ControladorAdministracion],
  providers: [ServicioAdminInicial],
  exports: [ServicioAdminInicial]
})
export class ModuloAdministracion {}
