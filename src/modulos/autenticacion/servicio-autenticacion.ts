import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BaseDatos } from '../../base-datos';
import { ServicioHash } from '../../seguridad/servicio-hash';

@Injectable()
export class ServicioAutenticacion {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly hash: ServicioHash,
    private readonly jwt: JwtService
  ) {}

  async crearCredencial(usuarioId: string, contrasena: string): Promise<void> {
    const contrasenaHash = await this.hash.hash(contrasena);
    await this.baseDatos.consultar(`
      INSERT INTO "credencialesAutenticacion" ("idUsuario", "contraseña")
      VALUES ($1, $2)
      ON CONFLICT ("idUsuario") DO UPDATE SET "contraseña" = EXCLUDED."contraseña"
    `, [Number(usuarioId), contrasenaHash]);
  }

  async iniciarSesion(correo: string, contrasena: string) {
    const resultado = await this.baseDatos.consultar<CredencialRow>(`
      SELECT u."idUsuario" AS id, u."EMAIL" AS correo,
             t."tipoUsuario", c."contraseña" AS "contrasenaHash"
      FROM "Usuario" u
      JOIN "credencialesAutenticacion" c ON c."idUsuario" = u."idUsuario"
      JOIN "TipoUsuario" t ON t."idTipoUsuario" = u."idTipoUsuario"
      WHERE u."EMAIL" = $1
    `, [correo]);
    const usuario = resultado.rows[0];
    if (!usuario || !(await this.hash.compare(contrasena, usuario.contrasenaHash))) {
      throw new UnauthorizedException('correo o contraseña incorrectos');
    }

    return {
      accessToken: await this.jwt.signAsync({
        sub: String(usuario.id),
        correo: usuario.correo,
        tipoUsuario: usuario.tipoUsuario
      }),
      usuario: { id: String(usuario.id), correo: usuario.correo, tipoUsuario: usuario.tipoUsuario }
    };
  }
}

interface CredencialRow {
  id: number;
  correo: string;
  tipoUsuario: string;
  contrasenaHash: string;
}