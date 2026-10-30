import { Module } from '@nestjs/common';
import { ModuloUsuarios } from '../usuarios/modulo-usuarios';
import { ControladorDerechos } from './controlador-derechos';
import { ServicioDerechos } from './servicio-derechos';
import { ServicioNotificaciones } from './servicio-notificaciones';

// Módulo paralelo al sistema principal para que el titular ejerza sus derechos (Actividad 5, parte 2).
@Module({
  imports: [ModuloUsuarios],
  controllers: [ControladorDerechos],
  providers: [ServicioDerechos, ServicioNotificaciones]
})
export class ModuloDerechos {}
