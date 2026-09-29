import { Module } from '@nestjs/common';
import { ControladorOperacionesFinancieras } from './controlador-operaciones-financieras';
import { ServicioOperacionesFinancieras } from './servicio-operaciones-financieras';

@Module({
  controllers: [ControladorOperacionesFinancieras],
  providers: [ServicioOperacionesFinancieras]
})
export class ModuloOperacionesFinancieras {}