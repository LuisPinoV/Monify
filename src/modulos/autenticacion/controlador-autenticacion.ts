import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Publica } from './publico.decorador';
import { ServicioAutenticacion } from './servicio-autenticacion';

interface DatosLogin { correo: string; contrasena: string; }

@Controller('auth')
export class ControladorAutenticacion {
  constructor(private readonly servicio: ServicioAutenticacion) {}

  @Publica()
  @Post('login')
  async login(@Body() datos: DatosLogin, @Res() response: Response) {
    if (!datos.correo?.trim() || !datos.contrasena) {
      return response.status(400).json({ mensaje: 'correo y contrasena son obligatorios' });
    }
    return response.json(await this.servicio.iniciarSesion(datos.correo.trim(), datos.contrasena));
  }
}