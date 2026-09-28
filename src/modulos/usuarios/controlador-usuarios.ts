import { Body, Controller, Get, Post, Response } from '@nestjs/common';
import type { Response as Respuesta } from 'express';
import { ServicioUsuarios } from './servicio-usuarios';

interface DatosNuevoUsuario {
  nombre: string;
  correo: string;
}

@Controller('usuarios')
export class ControladorUsuarios {
  constructor(private readonly servicio: ServicioUsuarios) {}

  @Get()
  listar() {
    return this.servicio.listar();
  }

  @Post()
  crear(@Body() datos: DatosNuevoUsuario, @Response() respuesta: Respuesta) {
    if (!datos.nombre?.trim() || !datos.correo?.trim()) {
      return respuesta.status(400).json({ mensaje: 'nombre y correo son obligatorios' });
    }

    return respuesta.status(201).json(
      this.servicio.crear(datos.nombre.trim(), datos.correo.trim())
    );
  }
}