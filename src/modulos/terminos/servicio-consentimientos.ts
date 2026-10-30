import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BaseDatos, fijarContexto, type Ejecutor } from '../../base-datos';
import { ServicioNoRepudio } from '../auditoria/servicio-no-repudio';
import type { Sesion } from '../autorizacion/roles';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { CAMPO_ACEPTACION, FINALIDADES_OBLIGATORIAS, VERSION_TERMINOS, type Finalidad } from './terminos';

export type EstadoConsentimiento = 'otorgado' | 'revocado' | 'reemplazado';

// Estado actual de una finalidad para el titular ("pendiente" si nunca la aceptó o si aceptó una versión anterior).
export interface ConsentimientoFinalidad {
  finalidad: Finalidad;
  descripcion: string;
  campo: string;
  estado: EstadoConsentimiento | 'pendiente';
  vigente: boolean;
  id: string | null;
  versionTexto: string | null;
  canal: string | null;
  otorgadoEl: string | null;
  revocadoEl: string | null;
  evidenciaId: string | null;
}

export interface EstadoConsentimientos {
  versionVigente: string;
  completo: boolean;
  pendientes: Finalidad[];
  finalidades: ConsentimientoFinalidad[];
}

export interface EventoConsentimiento {
  idEvento: string;
  fechaHora: string;
  finalidad: string;
  accion: string;
  estadoAnterior: string | null;
  estadoNuevo: string | null;
  versionTexto: string;
  canal: string;
  dispositivo: string;
  consentimientoId: string | null;
}

export interface AceptacionFinalidades {
  versionTerminos?: string;
  aceptaTerminos?: unknown;
  aceptaTratamientoDatos?: unknown;
  aceptaEvaluacionCrediticia?: unknown;
}

interface FilaConsentimiento {
  idConsent: number;
  nombreFinalidad: Finalidad;
  descripcion: string;
  versionTexto: string | null;
  estadoActual: EstadoConsentimiento | null;
  canal: string | null;
  otorgado_el: Date | null;
  revocado_el: Date | null;
  idEvidencia: string | null;
}

const iso = (valor: Date | null) => (valor ? new Date(valor).toISOString() : null);

/**
 * Gestión del consentimiento (Actividad 5, parte 1 y 5.1): catálogo de finalidades, otorgamiento individual,
 * revocación con fecha y hora, rechazo e historial. El historial (ConsentLogs) lo escribe un trigger de la base.
 */
@Injectable()
export class ServicioConsentimientos {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly noRepudio: ServicioNoRepudio
  ) {}

  // Valida que cada finalidad obligatoria venga marcada de forma explícita (una casilla por finalidad).
  exigirAceptacionCompleta(datos: AceptacionFinalidades): void {
    if (datos.versionTerminos !== VERSION_TERMINOS) {
      throw new BadRequestException(`versionTerminos debe ser la versión vigente (${VERSION_TERMINOS})`);
    }
    const faltantes = FINALIDADES_OBLIGATORIAS.filter((finalidad) => (datos as Record<string, unknown>)[CAMPO_ACEPTACION[finalidad]] !== true);
    if (faltantes.length > 0) {
      throw new BadRequestException(`debes aceptar cada finalidad por separado; faltan: ${faltantes.map((f) => CAMPO_ACEPTACION[f]).join(', ')}`);
    }
  }

  // Registra un consentimiento. Si existía uno vigente de una versión anterior, queda como "reemplazado".
  async otorgar(ejecutor: Ejecutor, parametros: {
    usuarioId: number; finalidad: Finalidad; contexto: ContextoCliente; idEvidencia?: string;
  }): Promise<void> {
    await fijarContexto(ejecutor, { ...parametros.contexto, actor: 'titular' });
    await ejecutor.consultar(`
      UPDATE "UserConsent" SET "estadoActual" = 'reemplazado', "revocado_el" = clock_timestamp()
      WHERE "idUsuario" = $1 AND "finalidad" = $2 AND "estadoActual" = 'otorgado' AND "versionTexto" <> $3
    `, [parametros.usuarioId, parametros.finalidad, VERSION_TERMINOS]);
    await ejecutor.consultar(`
      INSERT INTO "UserConsent" ("idUsuario", "idFinalidad", "finalidad", "versionTexto", "canal", "idEvidencia")
      SELECT $1, "idFinalidad", "nombreFinalidad", $3, $4, $5 FROM "Finalidad" WHERE "nombreFinalidad" = $2
    `, [parametros.usuarioId, parametros.finalidad, VERSION_TERMINOS, parametros.contexto.canal, parametros.idEvidencia ?? null]);
  }

  // Alta de un titular: se otorgan todas las finalidades (cada una ya validada con su casilla).
  async otorgarTodas(ejecutor: Ejecutor, usuarioId: number, contexto: ContextoCliente, idEvidencia: string): Promise<void> {
    for (const finalidad of FINALIDADES_OBLIGATORIAS) {
      await this.otorgar(ejecutor, { usuarioId, finalidad, contexto, idEvidencia });
    }
  }

  async estado(usuarioId: number): Promise<EstadoConsentimientos> {
    // Por cada finalidad del catálogo, el último consentimiento del titular (si existe).
    const resultado = await this.baseDatos.consultar<FilaConsentimiento>(`
      SELECT f."nombreFinalidad", f."descripcion", c."idConsent", c."versionTexto", c."estadoActual", c."canal",
             c."otorgado_el", c."revocado_el", c."idEvidencia"
      FROM "Finalidad" f
      LEFT JOIN LATERAL (
        SELECT * FROM "UserConsent" uc WHERE uc."idUsuario" = $1 AND uc."idFinalidad" = f."idFinalidad"
        ORDER BY uc."idConsent" DESC LIMIT 1
      ) c ON TRUE
      ORDER BY f."idFinalidad"
    `, [usuarioId]);
    const finalidades = resultado.rows
      .filter((fila) => FINALIDADES_OBLIGATORIAS.includes(fila.nombreFinalidad))
      .map((fila): ConsentimientoFinalidad => {
        const vigente = fila.estadoActual === 'otorgado' && fila.versionTexto === VERSION_TERMINOS;
        return {
          finalidad: fila.nombreFinalidad, descripcion: fila.descripcion, campo: CAMPO_ACEPTACION[fila.nombreFinalidad],
          estado: vigente || fila.estadoActual === 'revocado' ? fila.estadoActual! : 'pendiente', vigente,
          id: fila.idConsent ? String(fila.idConsent) : null, versionTexto: fila.versionTexto, canal: fila.canal,
          otorgadoEl: iso(fila.otorgado_el), revocadoEl: iso(fila.revocado_el), evidenciaId: fila.idEvidencia
        };
      });
    const pendientes = finalidades.filter((f) => !f.vigente).map((f) => f.finalidad);
    return { versionVigente: VERSION_TERMINOS, completo: pendientes.length === 0, pendientes, finalidades };
  }

  async pendientes(usuarioId: number): Promise<Finalidad[]> {
    const resultado = await this.baseDatos.consultar<{ nombreFinalidad: Finalidad }>(`
      SELECT f."nombreFinalidad" FROM "Finalidad" f
      WHERE f."nombreFinalidad" = ANY($2::text[]) AND NOT EXISTS (
        SELECT 1 FROM "UserConsent" c
        WHERE c."idUsuario" = $1 AND c."idFinalidad" = f."idFinalidad" AND c."estadoActual" = 'otorgado' AND c."versionTexto" = $3
      )
    `, [usuarioId, FINALIDADES_OBLIGATORIAS, VERSION_TERMINOS]);
    return resultado.rows.map((fila) => fila.nombreFinalidad);
  }

  async tieneVigente(usuarioId: number, finalidad: Finalidad): Promise<boolean> {
    return !(await this.pendientes(usuarioId)).includes(finalidad);
  }

  // Defensa en profundidad: además del guard global, las operaciones de negocio vuelven a exigir el consentimiento.
  async exigirConsentimiento(usuarioId: number): Promise<void> {
    const pendientes = await this.pendientes(usuarioId);
    if (pendientes.length > 0) {
      throw new ForbiddenException(`debes otorgar todos los consentimientos (versión ${VERSION_TERMINOS}) para operar; pendientes: ${pendientes.join(', ')}`);
    }
  }

  async historial(usuarioId: number, limite = 200): Promise<EventoConsentimiento[]> {
    const resultado = await this.baseDatos.consultar<{
      idEvento: string; fechaHora: Date; nombreFinalidad: string; accion: string; estadoAnterior: string | null; estadoNuevo: string | null;
      versionTexto: string; canal: string; dispositivo: string; idConsent: number | null;
    }>(`
      SELECT l."idEvento", l."fechaHora", f."nombreFinalidad", l."accion", l."estadoAnterior", l."estadoNuevo",
             l."versionTexto", l."canal", l."dispositivo", l."idConsent"
      FROM "ConsentLogs" l JOIN "Finalidad" f ON f."idFinalidad" = l."idFinalidad"
      WHERE l."idUsuario" = $1 ORDER BY l."idEvento" DESC LIMIT $2
    `, [usuarioId, Math.min(Math.max(Math.trunc(limite), 1), 500)]);
    return resultado.rows.map((fila) => ({
      idEvento: String(fila.idEvento), fechaHora: new Date(fila.fechaHora).toISOString(), finalidad: fila.nombreFinalidad,
      accion: fila.accion, estadoAnterior: fila.estadoAnterior, estadoNuevo: fila.estadoNuevo, versionTexto: fila.versionTexto,
      canal: fila.canal, dispositivo: fila.dispositivo, consentimientoId: fila.idConsent === null ? null : String(fila.idConsent)
    }));
  }

  // Ventana posterior al login: el titular otorga una o más finalidades pendientes, cada una con su casilla.
  async otorgarPendientes(sesion: Sesion, datos: AceptacionFinalidades, contexto: ContextoCliente): Promise<EstadoConsentimientos> {
    this.exigirTitular(sesion);
    if (datos.versionTerminos !== VERSION_TERMINOS) {
      throw new BadRequestException(`versionTerminos debe ser la versión vigente (${VERSION_TERMINOS})`);
    }
    const pendientes = await this.pendientes(sesion.id);
    const aceptadas = pendientes.filter((finalidad) => (datos as Record<string, unknown>)[CAMPO_ACEPTACION[finalidad]] === true);
    if (aceptadas.length === 0) {
      throw new BadRequestException(pendientes.length === 0
        ? 'no tienes consentimientos pendientes'
        : `marca la casilla de cada finalidad que aceptas: ${pendientes.map((f) => CAMPO_ACEPTACION[f]).join(', ')}`);
    }
    await this.baseDatos.transaccion(async (tx) => {
      const evidencia = await this.noRepudio.registrar({
        actor: sesion, accion: 'consentimiento.otorgar', recurso: `consentimientos:${VERSION_TERMINOS}`,
        datos: { version: VERSION_TERMINOS, finalidades: aceptadas }, contexto, versionTexto: VERSION_TERMINOS
      }, tx);
      for (const finalidad of aceptadas) {
        await this.otorgar(tx, { usuarioId: sesion.id, finalidad, contexto, idEvidencia: evidencia.id });
      }
    });
    return this.estado(sesion.id);
  }

  // Revocación: queda con fecha y hora; mientras falte el consentimiento el titular solo accede al módulo de derechos.
  async revocar(sesion: Sesion, finalidad: string, confirmacion: unknown, contexto: ContextoCliente): Promise<EstadoConsentimientos & { accesoRestringido: boolean }> {
    this.exigirTitular(sesion);
    if (!FINALIDADES_OBLIGATORIAS.includes(finalidad as Finalidad)) throw new NotFoundException('finalidad no encontrada');
    this.noRepudio.exigirConfirmacion(confirmacion);
    await this.baseDatos.transaccion(async (tx) => {
      const vigente = await tx.consultar<{ idConsent: number }>(
        `SELECT "idConsent" FROM "UserConsent" WHERE "idUsuario" = $1 AND "finalidad" = $2 AND "estadoActual" = 'otorgado' FOR UPDATE`,
        [sesion.id, finalidad]
      );
      if (vigente.rows.length === 0) throw new NotFoundException('no tienes un consentimiento vigente para esa finalidad');
      await this.noRepudio.registrar({
        actor: sesion, accion: 'consentimiento.revocar', recurso: `consentimiento:${vigente.rows[0].idConsent}`,
        datos: { finalidad }, contexto
      }, tx);
      await fijarContexto(tx, { ...contexto, actor: 'titular' });
      await tx.consultar(
        `UPDATE "UserConsent" SET "estadoActual" = 'revocado', "revocado_el" = clock_timestamp() WHERE "idConsent" = $1`,
        [vigente.rows[0].idConsent]
      );
    });
    return { ...(await this.estado(sesion.id)), accesoRestringido: true };
  }

  // El titular rechaza dar los consentimientos pendientes: queda registrado y el cliente cierra la sesión.
  async rechazar(sesion: Sesion, contexto: ContextoCliente): Promise<{ registrados: number; mensaje: string }> {
    this.exigirTitular(sesion);
    const pendientes = await this.pendientes(sesion.id);
    for (const finalidad of pendientes) {
      await this.baseDatos.consultar(`
        INSERT INTO "ConsentLogs" ("idUsuario", "canal", "dispositivo", "idFinalidad", "versionTexto", "accion")
        SELECT $1, $2, $3, "idFinalidad", $5, 'rechazado' FROM "Finalidad" WHERE "nombreFinalidad" = $4
      `, [sesion.id, contexto.canal, contexto.dispositivo, finalidad, VERSION_TERMINOS]);
    }
    return { registrados: pendientes.length, mensaje: 'sin los consentimientos no puedes usar Monify; tu sesión se cerrará' };
  }

  // Anonimización de la cuenta: se revocan todos los consentimientos vigentes.
  async revocarTodos(ejecutor: Ejecutor, usuarioId: number, contexto: ContextoCliente): Promise<void> {
    await fijarContexto(ejecutor, { ...contexto, actor: 'sistema:supresion' });
    await ejecutor.consultar(
      `UPDATE "UserConsent" SET "estadoActual" = 'revocado', "revocado_el" = clock_timestamp() WHERE "idUsuario" = $1 AND "estadoActual" = 'otorgado'`,
      [usuarioId]
    );
  }

  private exigirTitular(sesion: Sesion): void {
    if (sesion.cuenta !== 'usuario' || sesion.rol !== 'usuario') throw new ForbiddenException('solo los titulares gestionan consentimientos');
  }
}
