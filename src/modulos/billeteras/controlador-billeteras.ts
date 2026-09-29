import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ServicioBilleteras } from './servicio-billeteras';

interface DatosNuevaBilletera {
  usuarioId: string;
}

@Controller('billeteras')
export class ControladorBilleteras {
  constructor(private readonly servicio: ServicioBilleteras) {}

  @Get()
  listar() {
    return this.servicio.listar();
  }

  @Post()
  crear(@Body() datos: DatosNuevaBilletera, @Res() response: Response) {
    if (!datos.usuarioId?.trim()) {
      return response.status(400).json({ mensaje: 'usuarioId es obligatorio' });
    }

    return response.status(201).json(this.servicio.crear(datos.usuarioId.trim()));
  }
}