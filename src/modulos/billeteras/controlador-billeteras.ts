import { Body, Controller, Get, Post, Response } from '@nestjs/common';
import type { Response as Respuesta } from 'express';
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
  crear(@Body() datos: DatosNuevaBilletera, @Response() respuesta: Respuesta) {
    if (!datos.usuarioId?.trim()) {
      return respuesta.status(400).json({ mensaje: 'usuarioId es obligatorio' });
    }

    return respuesta.status(201).json(this.servicio.crear(datos.usuarioId.trim()));
  }
}