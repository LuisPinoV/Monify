import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ModuloBilleteras } from './modulos/billeteras/modulo-billeteras';
import { ModuloUsuarios } from './modulos/usuarios/modulo-usuarios';

@Controller('salud')
class ControladorSalud {
  @Get()
  consultar() {
    return {
      servicio: 'monify',
      estado: 'activo',
      persistencia: 'memoria temporal',
      autenticacion: 'pendiente'
    };
  }
}

@Module({
  imports: [ModuloUsuarios, ModuloBilleteras],
  controllers: [ControladorSalud]
})
export class ModuloPrincipal {}

export async function iniciar(): Promise<void> {
  const aplicacion = await NestFactory.create(ModuloPrincipal);
  const puerto = Number(process.env.PUERTO ?? 3000);
  await aplicacion.listen(puerto);
}