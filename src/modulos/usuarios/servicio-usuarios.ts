import type { Usuario } from '../../tipos.js';
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../base-datos';
import { PersistenciaCifrada } from '../../seguridad/persistencia-cifrada';
import { ServicioAutenticacion } from '../autenticacion/servicio-autenticacion';

interface DatosUsuario {
  tipoUsuario: string;
  nombre: string;
  rut: string;
  fechaNacimiento: string;
  rentaMensual?: number;
  numeroCelular?: string;
  contrasena?: string;
  correo: string;
}

@Injectable()
export class ServicioUsuarios {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly persistenciaCifrada: PersistenciaCifrada,
    private readonly autenticacion: ServicioAutenticacion
  ) {}

  async listar(): Promise<Usuario[]> {
    const resultado = await this.baseDatos.consultar<UsuarioRow>(`
            SELECT usuario."idUsuario" AS id, tipo."tipoUsuario", usuario."nombreCompleto" AS nombre,
              usuario."rut", usuario."fechaNacimiento", usuario."Saldo" AS saldo, usuario."rentaMensual",
              usuario."numeroCelular", usuario."EMAIL" AS correo,
              CURRENT_TIMESTAMP AS "creadoEn"
      FROM "Usuario" usuario
      JOIN "TipoUsuario" tipo ON tipo."idTipoUsuario" = usuario."idTipoUsuario"
      ORDER BY "idUsuario"
    `);
    return resultado.rows.map((fila) => mapearUsuario(fila, this.persistenciaCifrada));
  }

  async crear(datos: DatosUsuario): Promise<Usuario> {
    const tipo = await this.baseDatos.consultar<{ idTipoUsuario: number }>(
      'SELECT "idTipoUsuario" FROM "TipoUsuario" WHERE "tipoUsuario" = $1',
      [datos.tipoUsuario]
    );
    if (tipo.rowCount === 0) {
      throw new Error('tipoUsuario no existe');
    }
    const resultado = await this.baseDatos.consultar<UsuarioRow>(`
      INSERT INTO "Usuario" (
        "idTipoUsuario", "nombreCompleto", "rut", "fechaNacimiento", "Saldo",
        "rentaMensual", "numeroCelular", "EMAIL"
      )
      VALUES (
        $1,
        $2, $3, $4, $5, $6, $7, $8
      )
      RETURNING "idUsuario" AS id,
            (SELECT "tipoUsuario" FROM "TipoUsuario" WHERE "idTipoUsuario" = $1) AS "tipoUsuario",
            "nombreCompleto" AS nombre,
                "rut", "fechaNacimiento", "Saldo" AS saldo, "rentaMensual",
                "numeroCelular", "EMAIL" AS correo, CURRENT_TIMESTAMP AS "creadoEn"
    `, [tipo.rows[0].idTipoUsuario, this.persistenciaCifrada.protegerCampo(datos.nombre), datos.rut,
      this.persistenciaCifrada.protegerCampo(datos.fechaNacimiento), this.persistenciaCifrada.protegerCampo(0),
      datos.rentaMensual === undefined ? null : this.persistenciaCifrada.protegerCampo(datos.rentaMensual),
      datos.numeroCelular === undefined ? null : this.persistenciaCifrada.protegerCampo(datos.numeroCelular), datos.correo]);
    if (datos.contrasena) {
      await this.autenticacion.crearCredencial(String(resultado.rows[0].id), datos.contrasena);
    }
    return mapearUsuario(resultado.rows[0], this.persistenciaCifrada);
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

function mapearUsuario(fila: UsuarioRow, persistenciaCifrada: PersistenciaCifrada): Usuario {
  const datos = {
    nombre: persistenciaCifrada.revelarCampo<string>(fila.nombre),
    fechaNacimiento: persistenciaCifrada.revelarCampo<string>(fila.fechaNacimiento),
    saldo: persistenciaCifrada.revelarCampo<number>(fila.saldo === null ? null : String(fila.saldo)),
    rentaMensual: persistenciaCifrada.revelarCampo<number>(fila.rentaMensual === null ? null : String(fila.rentaMensual)),
    numeroCelular: persistenciaCifrada.revelarCampo<string>(fila.numeroCelular)
  };
  return {
    id: String(fila.id), tipoUsuario: fila.tipoUsuario, nombre: datos.nombre ?? fila.nombre ?? `Usuario #${fila.id}`,
    rut: fila.rut, fechaNacimiento: String(datos.fechaNacimiento ?? fila.fechaNacimiento ?? ''),
    saldo: Number(datos.saldo ?? fila.saldo ?? 0),
    rentaMensual: datos.rentaMensual === null ? undefined : Number(datos.rentaMensual),
    numeroCelular: datos.numeroCelular ?? undefined, correo: fila.correo,
    creadoEn: new Date(fila.creadoEn).toISOString()
  };
}

interface UsuarioDatos extends Record<string, unknown> {
  nombre?: string;
  fechaNacimiento?: string;
  saldo?: number;
  rentaMensual?: number;
  numeroCelular?: string;
  contrasena?: string;
}