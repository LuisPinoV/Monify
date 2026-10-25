import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BaseDatos, type Ejecutor } from '../../base-datos';
import { ServicioNoRepudio } from '../auditoria/servicio-no-repudio';
import type { Sesion } from '../autorizacion/roles';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { FINALIDADES, VERSION_TERMINOS, type Finalidad } from './terminos';

export interface Consentimiento {
  id: string;
  finalidad: string;
  versionTexto: string;
  canal: string;
  otorgadoEl: string;
  revocadoEl: string | null;
  vigente: boolean;
  evidenciaId: string | null;
}

interface FilaConsentimiento {
  idConsent: number;
  finalidad: string;
  versionTexto: string;
  canal: string;
  otorgado_el: Date;
  revocado_el: Date | null;
  idEvidencia: string | null;
}

// Consentimientos que forman parte de la relación contractual: solo se retiran cerrando la cuenta.
const FINALIDADES_CONTRACTUALES: string[] = [FINALIDADES.TERMINOS, FINALIDADES.DATOS];

@Injectable()
export class ServicioConsentimientos {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly noRepudio: ServicioNoRepudio
  ) {}

  async otorgar(ejecutor: Ejecutor, parametros: {
    usuarioId: number; finalidad: Finalidad; canal: string; idEvidencia?: string; versionTexto?: string;
  }): Promise<void> {
    await ejecutor.consultar(`
      INSERT INTO "UserConsent" ("idUsuario", "finalidad", "versionTexto", "canal", "idEvidencia")
      VALUES ($1, $2, $3, $4, $5)
    `, [parametros.usuarioId, parametros.finalidad, parametros.versionTexto ?? VERSION_TERMINOS, parametros.canal, parametros.idEvidencia ?? null]);
  }

  async tieneVigente(usuarioId: number, finalidad: Finalidad, version?: string): Promise<boolean> {
    const resultado = await this.baseDatos.consultar(`
      SELECT 1 FROM "UserConsent"
      WHERE "idUsuario" = $1 AND "finalidad" = $2 AND "revocado_el" IS NULL AND ($3::text IS NULL OR "versionTexto" = $3)
      LIMIT 1
    `, [usuarioId, finalidad, version ?? null]);
    return (resultado.rowCount ?? 0) > 0;
  }

  async terminosVigentes(usuarioId: number): Promise<boolean> {
    return (await this.tieneVigente(usuarioId, FINALIDADES.TERMINOS, VERSION_TERMINOS))
      && (await this.tieneVigente(usuarioId, FINALIDADES.DATOS, VERSION_TERMINOS));
  }

  async exigirTerminosVigentes(usuarioId: number): Promise<void> {
    if (!(await this.terminosVigentes(usuarioId))) {
      throw new ForbiddenException(`debes aceptar la versión ${VERSION_TERMINOS} de los Términos y Condiciones para operar`);
    }
  }

  async listar(usuarioId: number): Promise<Consentimiento[]> {
    const resultado = await this.baseDatos.consultar<FilaConsentimiento>(
      'SELECT * FROM "UserConsent" WHERE "idUsuario" = $1 ORDER BY "idConsent" DESC', [usuarioId]
    );
    return resultado.rows.map((fila) => ({
      id: String(fila.idConsent), finalidad: fila.finalidad, versionTexto: fila.versionTexto, canal: fila.canal,
      otorgadoEl: new Date(fila.otorgado_el).toISOString(),
      revocadoEl: fila.revocado_el ? new Date(fila.revocado_el).toISOString() : null,
      vigente: fila.revocado_el === null,
      evidenciaId: fila.idEvidencia
    }));
  }

  // Aceptación de una nueva versión de los términos por parte de un usuario ya registrado.
  async aceptarTerminos(sesion: Sesion, datos: {
    versionTerminos?: string; aceptaTerminos?: unknown; aceptaTratamientoDatos?: unknown;
  }, contexto: ContextoCliente): Promise<Consentimiento[]> {
    if (sesion.cuenta !== 'usuario') throw new ForbiddenException('solo los titulares de cuenta aceptan los términos');
    if (datos.versionTerminos !== VERSION_TERMINOS) {
      throw new BadRequestException(`versionTerminos debe ser la versión vigente (${VERSION_TERMINOS})`);
    }
    this.noRepudio.exigirConfirmacion(datos.aceptaTerminos);
    this.noRepudio.exigirConfirmacion(datos.aceptaTratamientoDatos);
    await this.baseDatos.transaccion(async (tx) => {
      const evidencia = await this.noRepudio.registrar({
        actor: sesion, accion: 'terminos.aceptar', recurso: `terminos:${VERSION_TERMINOS}`,
        datos: { version: VERSION_TERMINOS }, contexto, versionTexto: VERSION_TERMINOS
      }, tx);
      for (const finalidad of [FINALIDADES.TERMINOS, FINALIDADES.DATOS]) {
        await this.otorgar(tx, { usuarioId: sesion.id, finalidad, canal: contexto.canal, idEvidencia: evidencia.id });
      }
    });
    return this.listar(sesion.id);
  }

  async revocar(sesion: Sesion, idConsent: number): Promise<Consentimiento[]> {
    const existente = await this.baseDatos.consultar<{ finalidad: string }>(
      'SELECT "finalidad" FROM "UserConsent" WHERE "idConsent" = $1 AND "idUsuario" = $2 AND "revocado_el" IS NULL',
      [idConsent, sesion.id]
    );
    if (existente.rows.length === 0) throw new NotFoundException('consentimiento no encontrado o ya revocado');
    if (FINALIDADES_CONTRACTUALES.includes(existente.rows[0].finalidad)) {
      throw new BadRequestException('los términos y el tratamiento de datos solo se revocan eliminando tu cuenta');
    }
    await this.baseDatos.consultar('UPDATE "UserConsent" SET "revocado_el" = now() WHERE "idConsent" = $1', [idConsent]);
    return this.listar(sesion.id);
  }

  async revocarTodos(ejecutor: Ejecutor, usuarioId: number): Promise<void> {
    await ejecutor.consultar('UPDATE "UserConsent" SET "revocado_el" = now() WHERE "idUsuario" = $1 AND "revocado_el" IS NULL', [usuarioId]);
  }
}
