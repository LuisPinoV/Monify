import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ServicioUsuarios } from './servicio-usuarios';

interface DatosNuevoUsuario {
  nombre: string;
  correo: string;
  tipoUsuario: string;
  rut: string;
  fechaNacimiento: string;
  rentaMensual?: number;
  numeroCelular?: string;
}

@Controller('usuarios')
export class ControladorUsuarios {
  constructor(private readonly servicio: ServicioUsuarios) {}

  @Get()
  listar() {
    return this.servicio.listar();
  }

  @Post()
  crear(@Body() datos: DatosNuevoUsuario, @Res() response: Response) {
    if (!datos.nombre?.trim() || !datos.correo?.trim() || !datos.tipoUsuario?.trim() || !datos.rut?.trim() || !datos.fechaNacimiento?.trim()) {
      return response.status(400).json({ mensaje: 'nombre, correo, tipoUsuario, rut y fechaNacimiento son obligatorios' });
    }

    return response.status(201).json(
      this.servicio.crear({
        ...datos,
        nombre: datos.nombre.trim(),
        correo: datos.correo.trim(),
        tipoUsuario: datos.tipoUsuario.trim(),
        rut: datos.rut.trim(),
        fechaNacimiento: datos.fechaNacimiento.trim()
      })
    );
  }
}