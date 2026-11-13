import 'reflect-metadata';
import { join } from 'node:path';
import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ModuloAdministracion } from './modulos/administracion/modulo-administracion';
import { ModuloAuditoria } from './modulos/auditoria/modulo-auditoria';
import { ModuloAutorizacion } from './modulos/autorizacion/modulo-autorizacion';
import { ModuloBilleteras } from './modulos/billeteras/modulo-billeteras';
import { ModuloDerechos } from './modulos/derechos/modulo-derechos';
import { ModuloTerminos } from './modulos/terminos/modulo-terminos';
import { ModuloUsuarios } from './modulos/usuarios/modulo-usuarios';
import { ModuloOperacionesFinancieras } from './modulos/operaciones-financieras/modulo-operaciones-financieras';
import { ModuloBaseDatos } from './modulo-base-datos';
import { ModuloSeguridad } from './seguridad/modulo-seguridad';
import { ModuloAutenticacion } from './modulos/autenticacion/modulo-autenticacion';
import { Publica } from './modulos/autenticacion/publico.decorador';
import { ServicioAdminInicial } from './modulos/administracion/servicio-admin-inicial';
import { ServicioAuditoria } from './modulos/auditoria/servicio-auditoria';

@Controller('salud')
class ControladorSalud {
  @Get()
  @Publica()
  consultar() {
    return {
      servicio: 'monify',
      estado: 'activo',
      entorno: process.env.ENTORNO ?? 'desarrollo',
      persistencia: 'PostgreSQL',
      autenticacion: 'JWT + RBAC'
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ModuloSeguridad,
    ModuloBaseDatos,
    ModuloAuditoria,
    ModuloTerminos,
    ModuloAutorizacion,
    ModuloAutenticacion,
    ModuloUsuarios,
    ModuloBilleteras,
    ModuloOperacionesFinancieras,
    ModuloAdministracion,
    ModuloDerechos
  ],
  controllers: [ControladorSalud]
})
export class ModuloPrincipal {}

export async function iniciar(): Promise<void> {
  const aplicacion = await NestFactory.create<NestExpressApplication>(ModuloPrincipal);
  aplicacion.useStaticAssets(join(process.cwd(), 'public'));
  // init() ejecuta los onModuleInit (esquema y bóveda) antes de crear el Admin inicial.
  await aplicacion.init();
  await aplicacion.get(ServicioAdminInicial).asegurar();
  // Actividad 7: depuración de los registros cuyo plazo de conservación (5 años) venció, al iniciar y una vez al día.
  const auditoria = aplicacion.get(ServicioAuditoria);
  const depurar = () => auditoria.depurarVencidos().catch((error: Error) => console.error(`Depuración de registros fallida: ${error.message}`));
  await depurar();
  setInterval(depurar, 24 * 60 * 60 * 1000).unref();
  const puerto = Number(process.env.PUERTO ?? 3000);
  await aplicacion.listen(puerto);
}
