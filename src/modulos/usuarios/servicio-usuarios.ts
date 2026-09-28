import { crearIdentificador } from '../../utilidades/identificador.js';
import type { Usuario } from '../../tipos.js';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ServicioUsuarios {
  private readonly usuarios: Usuario[] = [];

  listar(): Usuario[] {
    return this.usuarios;
  }

  crear(nombre: string, correo: string): Usuario {
    const usuario: Usuario = {
      id: crearIdentificador(),
      nombre,
      correo,
      creadoEn: new Date().toISOString()
    };

    this.usuarios.push(usuario);
    return usuario;
  }
}