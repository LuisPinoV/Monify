import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ServicioUsuarios } from './servicio-usuarios';
import { Publica } from '../autenticacion/publico.decorador';

interface DatosNuevoUsuario {
  nombre: string;
  correo: string;
  tipoUsuario: string;
  rut: string;
  fechaNacimiento: string;
  rentaMensual?: number;
  numeroCelular?: string;
  contrasena?: string;
}

@Controller('usuarios')
export class ControladorUsuarios {
  constructor(private readonly servicio: ServicioUsuarios) {}

  @Get()
  listar() {
    return this.servicio.listar();
  }

  @Post()
  @Publica()
  async crear(@Body() datos: DatosNuevoUsuario, @Res() response: Response) {
    if (!datos.nombre?.trim() || !datos.correo?.trim() || !datos.tipoUsuario?.trim() || !datos.rut?.trim() || !datos.fechaNacimiento?.trim()) {
      return response.status(400).json({ mensaje: 'nombre, correo, tipoUsuario, rut y fechaNacimiento son obligatorios' });
    }

    if (!datos.contrasena || datos.contrasena.length < 8) {
      return response.status(400).json({ mensaje: 'la contrasena debe tener al menos 8 caracteres' });
    }
    if (!['usuario', 'administrador_riesgo'].includes(datos.tipoUsuario.trim())) {
      return response.status(400).json({ mensaje: 'tipoUsuario debe ser usuario o administrador_riesgo' });
    }
    const usuario = await this.servicio.crear({
        ...datos,
        nombre: datos.nombre.trim(),
        correo: datos.correo.trim(),
        tipoUsuario: datos.tipoUsuario.trim(),
        rut: datos.rut.trim(),
        fechaNacimiento: datos.fechaNacimiento.trim()
      });
    return response.status(201).json(usuario);
  }
}