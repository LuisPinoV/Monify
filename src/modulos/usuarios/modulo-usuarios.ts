import { Module } from '@nestjs/common';
import { ModuloBilleteras } from '../billeteras/modulo-billeteras';
import { ModuloOperacionesFinancieras } from '../operaciones-financieras/modulo-operaciones-financieras';
import { ControladorUsuarios } from './controlador-usuarios';
import { ServicioUsuarios } from './servicio-usuarios';

@Module({
  imports: [ModuloBilleteras, ModuloOperacionesFinancieras],
  controllers: [ControladorUsuarios],
  providers: [ServicioUsuarios],
  exports: [ServicioUsuarios]
})
export class ModuloUsuarios {}
