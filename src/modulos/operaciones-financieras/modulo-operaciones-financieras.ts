import { Module } from '@nestjs/common';
import { ModuloBilleteras } from '../billeteras/modulo-billeteras';
import { ControladorOperacionesFinancieras } from './controlador-operaciones-financieras';
import { ServicioOperacionesFinancieras } from './servicio-operaciones-financieras';

@Module({
  imports: [ModuloBilleteras],
  controllers: [ControladorOperacionesFinancieras],
  providers: [ServicioOperacionesFinancieras],
  exports: [ServicioOperacionesFinancieras]
})
export class ModuloOperacionesFinancieras {}
