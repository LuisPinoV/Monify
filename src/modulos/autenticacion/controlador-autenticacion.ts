import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { ContextoActual } from '../autorizacion/decoradores';
import { Publica } from './publico.decorador';
import { ServicioAutenticacion } from './servicio-autenticacion';

interface DatosLogin { correo: string; contrasena: string; }

@Controller('auth')
export class ControladorAutenticacion {
  constructor(private readonly servicio: ServicioAutenticacion) {}

  @Publica()
  @Post('login')
  @HttpCode(200)
  login(@Body() datos: DatosLogin, @ContextoActual() contexto: ContextoCliente) {
    if (typeof datos?.correo !== 'string' || !datos.correo.trim() || typeof datos.contrasena !== 'string' || !datos.contrasena) {
      throw new BadRequestException('correo y contrasena son obligatorios');
    }
    return this.servicio.iniciarSesion(datos.correo, datos.contrasena, contexto);
  }
}
