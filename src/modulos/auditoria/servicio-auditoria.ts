import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BaseDatos } from '../../base-datos';
import { PersistenciaCifrada } from '../../seguridad/persistencia-cifrada';
import { ServicioCifrado } from '../../seguridad/servicio-cifrado';
import { crearIdentificador } from '../../utilidades/identificador';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import type { TipoCuenta } from '../autorizacion/roles';

export const SISTEMA = 'monify-api';
export const HASH_GENESIS = '0'.repeat(64);
const CLAVE_BLOQUEO_AUDITORIA = 7_261_001;
const LOTE_VERIFICACION = 500;

export type ResultadoAuditoria = 'exito' | 'denegado' | 'fallo';

export interface ActorAuditoria {
  id: number;
  cuenta: TipoCuenta;
}

export interface EntradaAuditoria {
  actor?: ActorAuditoria | null;
  accion: string;
  resultado: ResultadoAuditoria;
  contexto: ContextoCliente;
  recurso?: string;
  detalle?: Record<string, unknown>;
}

export interface FiltrosAuditoria {
  usuarioId?: number;
  adminRiesgoId?: number;
  accion?: string;
  desde?: Date;
  hasta?: Date;
  limite?: number;
}

export interface RegistroAuditoria {
  id: string;
  secuencia: string;
  usuarioId: string | null;
  adminRiesgoId: string | null;
  fechaAccion: string;
  sistema: string;
  accion: string;
  canal: string;
  dispositivo: string;
  resultado: string;
  recurso: string | null;
  detalle: Record<string, unknown> | null;
}

export interface ResultadoIntegridad {
  valida: boolean;
  registrosVerificados: number;
  primerRegistroInvalido?: { id: string; secuencia: string; motivo: string };
}

interface FilaLog {
  uniqueID: string;
  secuencia: string;
  idUsuario: number | null;
  idAdminRiesgo: number | null;
  fechaAccion: Date;
  sistema: string;
  accion: string;
  canal: string;
  dispositivo: string;
  resultado: string;
  recurso: string | null;
  detalle: string | null;
  hashPrevio: string;
  hashRegistro: string;
}

/**
 * Bitácora de auditoría: registra quién hizo qué, cuándo, por qué canal y desde qué dispositivo.
 * Es de solo anexado (un trigger impide UPDATE/DELETE) y cada registro encadena el hash del anterior,
 * de modo que cualquier alteración o eliminación se detecta en `verificarIntegridad`.
 */
@Injectable()
export class ServicioAuditoria {
  private readonly logger = new Logger(ServicioAuditoria.name);

  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly persistenciaCifrada: PersistenciaCifrada,
    private readonly cifrado: ServicioCifrado
  ) {}

  async registrar(entrada: EntradaAuditoria): Promise<void> {
    const uniqueID = crearIdentificador();
    const fechaAccion = new Date();
    const detalle = entrada.detalle ? this.persistenciaCifrada.protegerCampo(entrada.detalle) : null;
    const usuarioId = entrada.actor?.cuenta === 'usuario' ? entrada.actor.id : null;
    const adminRiesgoId = entrada.actor?.cuenta === 'administrador_riesgo' ? entrada.actor.id : null;

    await this.baseDatos.transaccion(async (tx) => {
      // El bloqueo serializa las inserciones para que la cadena de hashes sea lineal.
      await tx.consultar('SELECT pg_advisory_xact_lock($1)', [CLAVE_BLOQUEO_AUDITORIA]);
      const previo = await tx.consultar<{ hashRegistro: string }>(
        'SELECT "hashRegistro" FROM "UserLogs" ORDER BY "secuencia" DESC LIMIT 1'
      );
      const hashPrevio = previo.rows[0]?.hashRegistro ?? HASH_GENESIS;
      const hashRegistro = this.calcularHash({
        hashPrevio, uniqueID, idUsuario: usuarioId, idAdminRiesgo: adminRiesgoId, fechaAccion,
        sistema: SISTEMA, accion: entrada.accion, canal: entrada.contexto.canal,
        dispositivo: entrada.contexto.dispositivo, resultado: entrada.resultado,
        recurso: entrada.recurso ?? null, detalle
      });
      await tx.consultar(`
        INSERT INTO "UserLogs" ("uniqueID", "idUsuario", "idAdminRiesgo", "fechaAccion", "sistema", "accion", "canal",
                                "dispositivo", "resultado", "recurso", "detalle", "hashPrevio", "hashRegistro")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [uniqueID, usuarioId, adminRiesgoId, fechaAccion, SISTEMA, entrada.accion, entrada.contexto.canal,
        entrada.contexto.dispositivo, entrada.resultado, entrada.recurso ?? null, detalle, hashPrevio, hashRegistro]);
    });
  }

  // Para eventos que no deben interrumpir la petición si la bitácora falla; el fallo queda en el log del servidor.
  async intentarRegistrar(entrada: EntradaAuditoria): Promise<void> {
    try {
      await this.registrar(entrada);
    } catch (error) {
      this.logger.error(`No se pudo registrar la acción ${entrada.accion}: ${(error as Error).message}`);
    }
  }

  async listar(filtros: FiltrosAuditoria = {}): Promise<RegistroAuditoria[]> {
    const condiciones: string[] = [];
    const parametros: unknown[] = [];
    const agregar = (condicion: string, valor: unknown) => {
      parametros.push(valor);
      condiciones.push(condicion.replace('?', `$${parametros.length}`));
    };
    if (filtros.usuarioId !== undefined) agregar('"idUsuario" = ?', filtros.usuarioId);
    if (filtros.adminRiesgoId !== undefined) agregar('"idAdminRiesgo" = ?', filtros.adminRiesgoId);
    if (filtros.accion) agregar('"accion" = ?', filtros.accion);
    if (filtros.desde) agregar('"fechaAccion" >= ?', filtros.desde);
    if (filtros.hasta) agregar('"fechaAccion" <= ?', filtros.hasta);
    const limite = Math.min(Math.max(Math.trunc(filtros.limite ?? 100), 1), 500);
    parametros.push(limite);
    const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const resultado = await this.baseDatos.consultar<FilaLog>(
      `SELECT * FROM "UserLogs" ${donde} ORDER BY "secuencia" DESC LIMIT $${parametros.length}`, parametros
    );
    return resultado.rows.map((fila) => ({
      id: fila.uniqueID,
      secuencia: String(fila.secuencia),
      usuarioId: fila.idUsuario === null ? null : String(fila.idUsuario),
      adminRiesgoId: fila.idAdminRiesgo === null ? null : String(fila.idAdminRiesgo),
      fechaAccion: new Date(fila.fechaAccion).toISOString(),
      sistema: fila.sistema,
      accion: fila.accion,
      canal: fila.canal,
      dispositivo: fila.dispositivo,
      resultado: fila.resultado,
      recurso: fila.recurso,
      detalle: this.persistenciaCifrada.revelarCampo<Record<string, unknown>>(fila.detalle)
    }));
  }

  // Actividad 7, punto 6: línea de tiempo de un actor y un rango, en orden cronológico, para reconstruir un incidente.
  // Se entrega con una huella SHA-256 y una firma RSA (cadena de custodia) y el estado de la cadena de hashes.
  async lineaTiempo(filtros: { usuarioId?: number; adminRiesgoId?: number; desde?: Date; hasta?: Date }, exportadoPor: string) {
    const registros = (await this.listarIncidente(filtros)).reverse();
    const integridad = await this.verificarIntegridad();
    const eventos = registros.map(({ id, secuencia, usuarioId, adminRiesgoId, fechaAccion, accion, resultado, canal, dispositivo, recurso, detalle }) => ({
      id, secuencia, usuarioId, adminRiesgoId, fechaAccion, accion, resultado, canal, dispositivo, recurso,
      // De los detalles solo se exportan metadatos (código HTTP, motivo, regla), nunca datos personales.
      detalle: detalle ? Object.fromEntries(Object.entries(detalle).filter(([clave]) => ['estado', 'motivo', 'intentos', 'regla', 'accionRequerida', 'alerta', 'nivel'].includes(clave))) : null
    }));
    const contenido = JSON.stringify(eventos);
    const huella = createHash('sha256').update(contenido).digest('hex');
    const generadoEn = new Date().toISOString();
    return {
      formato: 'monify.linea-tiempo/1', generadoEn, exportadoPor,
      filtros: {
        usuarioId: filtros.usuarioId ?? null, adminRiesgoId: filtros.adminRiesgoId ?? null,
        desde: filtros.desde?.toISOString() ?? null, hasta: filtros.hasta?.toISOString() ?? null
      },
      totalEventos: eventos.length, eventos,
      cadenaDeCustodia: {
        algoritmo: 'SHA-256', alcance: 'JSON.stringify(eventos)', huella,
        firma: this.cifrado.firmar(`${huella}|${generadoEn}|${exportadoPor}`), firmaAlgoritmo: 'RSA-SHA256 sobre "huella|generadoEn|exportadoPor"',
        bitacoraIntegra: integridad.valida, registrosVerificados: integridad.registrosVerificados
      }
    };
  }

  private async listarIncidente(filtros: { usuarioId?: number; adminRiesgoId?: number; desde?: Date; hasta?: Date }): Promise<RegistroAuditoria[]> {
    if (filtros.usuarioId === undefined || filtros.adminRiesgoId === undefined) return this.listar({ ...filtros, limite: 500 });
    const resultado = await this.baseDatos.consultar<FilaLog>(`
      SELECT * FROM "UserLogs"
      WHERE ("idUsuario" = $1 OR "idAdminRiesgo" = $2 OR "recurso" IN ($5, $6))
        AND "fechaAccion" >= $3 AND "fechaAccion" <= $4
      ORDER BY "secuencia" DESC LIMIT 500
    `, [filtros.usuarioId, filtros.adminRiesgoId, filtros.desde, filtros.hasta, `usuario:${filtros.usuarioId}`, `administrador_riesgo:${filtros.usuarioId}`]);
    return resultado.rows.map((fila) => ({
      id: fila.uniqueID, secuencia: String(fila.secuencia), usuarioId: fila.idUsuario === null ? null : String(fila.idUsuario),
      adminRiesgoId: fila.idAdminRiesgo === null ? null : String(fila.idAdminRiesgo), fechaAccion: new Date(fila.fechaAccion).toISOString(),
      sistema: fila.sistema, accion: fila.accion, canal: fila.canal, dispositivo: fila.dispositivo, resultado: fila.resultado,
      recurso: fila.recurso, detalle: this.persistenciaCifrada.revelarCampo<Record<string, unknown>>(fila.detalle)
    }));
  }

  // Actividad 7, punto 3: borra lo que superó el plazo de conservación (5 años, Ley 19.913 art. 5) mediante la función controlada de la base.
  async depurarVencidos(): Promise<{ tabla: string; eliminados: number }[]> {
    const r = await this.baseDatos.consultar<{ tabla: string; eliminados: number }>('SELECT * FROM fn_depurar_registros_vencidos()');
    if (r.rows.length > 0) {
      await this.intentarRegistrar({
        accion: 'auditoria.depuracion', resultado: 'exito', contexto: { canal: 'api', dispositivo: SISTEMA },
        detalle: { tablas: r.rows.map((f) => `${f.tabla}:${f.eliminados}`) }
      });
    }
    return r.rows;
  }

  async verificarIntegridad(): Promise<ResultadoIntegridad> {
    // Si hubo depuración por plazo vencido, la cadena continúa desde el último hash eliminado (constancia en DepuracionRegistros).
    const ancla = await this.baseDatos.consultar<{ ultimaSecuencia: string; ultimoHashEliminado: string }>(
      `SELECT "ultimaSecuencia", "ultimoHashEliminado" FROM "DepuracionRegistros" WHERE "tabla" = 'UserLogs' ORDER BY "idDepuracion" DESC LIMIT 1`
    );
    let ultima = ancla.rows[0] ? String(ancla.rows[0].ultimaSecuencia) : '0';
    let esperado = ancla.rows[0]?.ultimoHashEliminado ?? HASH_GENESIS;
    let verificados = 0;
    for (;;) {
      const lote = await this.baseDatos.consultar<FilaLog>(
        'SELECT * FROM "UserLogs" WHERE "secuencia" > $1::bigint ORDER BY "secuencia" LIMIT $2', [ultima, LOTE_VERIFICACION]
      );
      if (lote.rows.length === 0) return { valida: true, registrosVerificados: verificados };
      for (const fila of lote.rows) {
        const recalculado = this.calcularHash({
          hashPrevio: fila.hashPrevio, uniqueID: fila.uniqueID, idUsuario: fila.idUsuario, idAdminRiesgo: fila.idAdminRiesgo,
          fechaAccion: new Date(fila.fechaAccion), sistema: fila.sistema, accion: fila.accion, canal: fila.canal,
          dispositivo: fila.dispositivo, resultado: fila.resultado, recurso: fila.recurso, detalle: fila.detalle
        });
        const motivo = fila.hashPrevio !== esperado
          ? 'la cadena se rompe: falta o se modificó un registro anterior'
          : recalculado !== fila.hashRegistro ? 'el contenido del registro fue alterado' : null;
        if (motivo) {
          return {
            valida: false, registrosVerificados: verificados,
            primerRegistroInvalido: { id: fila.uniqueID, secuencia: String(fila.secuencia), motivo }
          };
        }
        esperado = fila.hashRegistro;
        ultima = String(fila.secuencia);
        verificados += 1;
      }
    }
  }

  private calcularHash(campos: {
    hashPrevio: string; uniqueID: string; idUsuario: number | null; idAdminRiesgo: number | null; fechaAccion: Date;
    sistema: string; accion: string; canal: string; dispositivo: string; resultado: string; recurso: string | null;
    detalle: string | null;
  }): string {
    return this.cifrado.hashDeterminista(JSON.stringify([
      campos.hashPrevio, campos.uniqueID, campos.idUsuario, campos.idAdminRiesgo, campos.fechaAccion.toISOString(),
      campos.sistema, campos.accion, campos.canal, campos.dispositivo, campos.resultado, campos.recurso, campos.detalle
    ]));
  }
}
