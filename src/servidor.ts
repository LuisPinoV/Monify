import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ModuloBilleteras } from './modulos/billeteras/modulo-billeteras';
import { ModuloUsuarios } from './modulos/usuarios/modulo-usuarios';
import { ModuloOperacionesFinancieras } from './modulos/operaciones-financieras/modulo-operaciones-financieras';
import { ModuloBaseDatos } from './modulo-base-datos';

@Controller('salud')
class ControladorSalud {
  @Get()
  consultar() {
    return {
      servicio: 'monify',
      estado: 'activo',
      persistencia: 'PostgreSQL',
      autenticacion: 'pendiente'
    };
  }
}

@Module({
  imports: [ModuloBaseDatos, ModuloUsuarios, ModuloBilleteras, ModuloOperacionesFinancieras],
  controllers: [ControladorSalud]
})
export class ModuloPrincipal {}

export async function iniciar(): Promise<void> {
  const aplicacion = await NestFactory.create(ModuloPrincipal);
  const puerto = Number(process.env.PUERTO ?? 3000);
  await aplicacion.listen(puerto);
}