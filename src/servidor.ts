import 'reflect-metadata';
import { join } from 'node:path';
import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ModuloBilleteras } from './modulos/billeteras/modulo-billeteras';
import { ModuloUsuarios } from './modulos/usuarios/modulo-usuarios';
import { ModuloOperacionesFinancieras } from './modulos/operaciones-financieras/modulo-operaciones-financieras';
import { ModuloBaseDatos } from './modulo-base-datos';
import { ModuloSeguridad } from './seguridad/modulo-seguridad';
import { ModuloAutenticacion } from './modulos/autenticacion/modulo-autenticacion';
import { Publica } from './modulos/autenticacion/publico.decorador';

@Controller('salud')
class ControladorSalud {
  @Get()
  @Publica()
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
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ModuloSeguridad,
    ModuloAutenticacion,
    ModuloBaseDatos,
    ModuloUsuarios,
    ModuloBilleteras,
    ModuloOperacionesFinancieras
  ],
  controllers: [ControladorSalud]
})
export class ModuloPrincipal {}

export async function iniciar(): Promise<void> {
  const aplicacion = await NestFactory.create<NestExpressApplication>(ModuloPrincipal);
  aplicacion.useStaticAssets(join(process.cwd(), 'public'));
  const puerto = Number(process.env.PUERTO ?? 3000);
  await aplicacion.listen(puerto);
}