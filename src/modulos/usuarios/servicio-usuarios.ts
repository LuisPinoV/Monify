import type { Usuario } from '../../tipos.js';
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../base-datos';

interface DatosUsuario {
  tipoUsuario: string;
  nombre: string;
  rut: string;
  fechaNacimiento: string;
  rentaMensual?: number;
  numeroCelular?: string;
  correo: string;
}

@Injectable()
export class ServicioUsuarios {
  constructor(private readonly baseDatos: BaseDatos) {}

  async listar(): Promise<Usuario[]> {
    const resultado = await this.baseDatos.consultar<UsuarioRow>(`
      SELECT "idUsuario" AS id, "tipoUsuario", "nombreCompleto" AS nombre,
             "rut", "fechaNacimiento", "Saldo" AS saldo, "rentaMensual",
             "numeroCelular", "EMAIL" AS correo, CURRENT_TIMESTAMP AS "creadoEn"
      FROM "Usuario" usuario
      JOIN "TipoUsuario" tipo ON tipo."idTipoUsuario" = usuario."idTipoUsuario"
      ORDER BY "idUsuario"
    `);
    return resultado.rows.map(mapearUsuario);
  }

  async crear(datos: DatosUsuario): Promise<Usuario> {
    const resultado = await this.baseDatos.consultar<UsuarioRow>(`
      INSERT INTO "Usuario" (
        "idTipoUsuario", "nombreCompleto", "rut", "fechaNacimiento",
        "rentaMensual", "numeroCelular", "EMAIL"
      )
      VALUES (
        (SELECT "idTipoUsuario" FROM "TipoUsuario" WHERE "tipoUsuario" = $1),
        $2, $3, $4, $5, $6, $7
      )
      RETURNING "idUsuario" AS id, $1 AS "tipoUsuario", "nombreCompleto" AS nombre,
                "rut", "fechaNacimiento", "Saldo" AS saldo, "rentaMensual",
                "numeroCelular", "EMAIL" AS correo, CURRENT_TIMESTAMP AS "creadoEn"
    `, [datos.tipoUsuario, datos.nombre, datos.rut, datos.fechaNacimiento,
      datos.rentaMensual ?? null, datos.numeroCelular ?? null, datos.correo]);
    return mapearUsuario(resultado.rows[0]);
  }
}

interface UsuarioRow {
  id: number;
  tipoUsuario: string;
  nombre: string;
  rut: string;
  fechaNacimiento: string;
  saldo: string | number;
  rentaMensual: string | number | null;
  numeroCelular: string | null;
  correo: string;
  creadoEn: Date | string;
}

function mapearUsuario(fila: UsuarioRow): Usuario {
  return {
    id: String(fila.id), tipoUsuario: fila.tipoUsuario, nombre: fila.nombre,
    rut: fila.rut, fechaNacimiento: String(fila.fechaNacimiento),
    saldo: Number(fila.saldo),
    rentaMensual: fila.rentaMensual === null ? undefined : Number(fila.rentaMensual),
    numeroCelular: fila.numeroCelular ?? undefined, correo: fila.correo,
    creadoEn: new Date(fila.creadoEn).toISOString()
  };
}