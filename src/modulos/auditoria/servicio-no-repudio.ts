import { BadRequestException, Injectable } from '@nestjs/common';
import { BaseDatos, type Ejecutor } from '../../base-datos';
import { ServicioCifrado } from '../../seguridad/servicio-cifrado';
import { crearIdentificador } from '../../utilidades/identificador';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import type { TipoCuenta } from '../autorizacion/roles';

export const VERSION_TEXTOS_CONFIRMACION = 'NR-2';

// Texto exacto que el titular acepta al marcar la casilla de confirmación de cada acción crítica.
export const TEXTOS_NO_REPUDIO = {
  'terminos.aceptar': 'Declaro haber leído y aceptado los Términos y Condiciones de Monify y reconozco que esta aceptación queda registrada como evidencia.',
  'consentimiento.otorgar': 'Otorgo mi consentimiento para cada finalidad que marqué, de forma libre e informada, y reconozco que queda registrado como evidencia.',
  'consentimiento.revocar': 'Revoco este consentimiento. Entiendo que, mientras no lo vuelva a otorgar, solo podré usar el módulo de ejercicio de derechos.',
  'transaccion.crear': 'Confirmo que autorizo esta transacción, que los datos son correctos y que no podré desconocerla una vez ejecutada.',
  'solicitud_credito.crear': 'Confirmo que solicito este crédito, que entiendo sus condiciones y que autorizo la evaluación de mi riesgo crediticio.',
  'solicitud_credito.resolver': 'Confirmo que esta decisión sobre la solicitud de crédito es de mi responsabilidad y queda registrada a mi nombre.',
  'cuenta.eliminar': 'Confirmo que deseo eliminar mi cuenta, que mis datos personales serán anonimizados de forma irreversible y que no podré desconocer esta decisión.'
} as const;
export type AccionNoRepudio = keyof typeof TEXTOS_NO_REPUDIO;

export interface ActorEvidencia {
  id: number;
  cuenta: TipoCuenta;
}

export interface EvidenciaNoRepudio {
  id: string;
  accion: string;
  recurso: string | null;
  textoConfirmado: string;
  versionTexto: string;
  canal: string;
  dispositivo: string;
  confirmadoEn: string;
  huellaDatos: string;
  firma: string;
}

interface FilaEvidencia {
  idEvidencia: string;
  idUsuario: number | null;
  idAdminRiesgo: number | null;
  accion: string;
  recurso: string | null;
  textoConfirmado: string;
  versionTexto: string;
  canal: string;
  dispositivo: string;
  confirmadoEn: Date;
  huellaDatos: string;
  firma: string;
}

/**
 * No repudio: cada acción crítica exige una casilla de confirmación explícita. Se guarda en la base
 * el texto aceptado, quién, cuándo, canal, dispositivo y una huella (HMAC) de los datos de la
 * operación, todo firmado con RSA-SHA256. La tabla es de solo anexado.
 */
@Injectable()
export class ServicioNoRepudio {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly cifrado: ServicioCifrado
  ) {}

  exigirConfirmacion(confirmacion: unknown): void {
    if (confirmacion !== true) {
      throw new BadRequestException('debes marcar la casilla de confirmación (confirmacionNoRepudio) para ejecutar esta acción');
    }
  }

  async registrar(parametros: {
    actor: ActorEvidencia;
    accion: AccionNoRepudio;
    recurso?: string;
    datos?: Record<string, unknown>;
    contexto: ContextoCliente;
    versionTexto?: string;
  }, ejecutor: Ejecutor = this.baseDatos): Promise<EvidenciaNoRepudio> {
    const id = crearIdentificador();
    const confirmadoEn = new Date();
    const usuarioId = parametros.actor.cuenta === 'usuario' ? parametros.actor.id : null;
    const adminRiesgoId = parametros.actor.cuenta === 'administrador_riesgo' ? parametros.actor.id : null;
    const evidencia = {
      id,
      accion: parametros.accion,
      recurso: parametros.recurso ?? null,
      textoConfirmado: TEXTOS_NO_REPUDIO[parametros.accion],
      versionTexto: parametros.versionTexto ?? VERSION_TEXTOS_CONFIRMACION,
      canal: parametros.contexto.canal,
      dispositivo: parametros.contexto.dispositivo,
      confirmadoEn: confirmadoEn.toISOString(),
      huellaDatos: this.cifrado.hashDeterminista(JSON.stringify(parametros.datos ?? {}))
    };
    const firma = this.cifrado.firmar(this.mensajeFirmado(evidencia, usuarioId, adminRiesgoId));
    await ejecutor.consultar(`
      INSERT INTO "EvidenciaNoRepudio" ("idEvidencia", "idUsuario", "idAdminRiesgo", "accion", "recurso", "textoConfirmado",
                                        "versionTexto", "canal", "dispositivo", "confirmadoEn", "huellaDatos", "firma")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [id, usuarioId, adminRiesgoId, evidencia.accion, evidencia.recurso, evidencia.textoConfirmado, evidencia.versionTexto,
      evidencia.canal, evidencia.dispositivo, confirmadoEn, evidencia.huellaDatos, firma]);
    return { ...evidencia, firma };
  }

  async listar(filtros: { usuarioId?: number; limite?: number } = {}): Promise<Array<EvidenciaNoRepudio & { firmaValida: boolean; usuarioId: string | null; adminRiesgoId: string | null }>> {
    const limite = Math.min(Math.max(Math.trunc(filtros.limite ?? 100), 1), 500);
    const resultado = filtros.usuarioId === undefined
      ? await this.baseDatos.consultar<FilaEvidencia>('SELECT * FROM "EvidenciaNoRepudio" ORDER BY "confirmadoEn" DESC LIMIT $1', [limite])
      : await this.baseDatos.consultar<FilaEvidencia>('SELECT * FROM "EvidenciaNoRepudio" WHERE "idUsuario" = $1 ORDER BY "confirmadoEn" DESC LIMIT $2', [filtros.usuarioId, limite]);
    return resultado.rows.map((fila) => {
      const evidencia: EvidenciaNoRepudio = {
        id: fila.idEvidencia, accion: fila.accion, recurso: fila.recurso, textoConfirmado: fila.textoConfirmado,
        versionTexto: fila.versionTexto, canal: fila.canal, dispositivo: fila.dispositivo,
        confirmadoEn: new Date(fila.confirmadoEn).toISOString(), huellaDatos: fila.huellaDatos, firma: fila.firma
      };
      return {
        ...evidencia,
        usuarioId: fila.idUsuario === null ? null : String(fila.idUsuario),
        adminRiesgoId: fila.idAdminRiesgo === null ? null : String(fila.idAdminRiesgo),
        firmaValida: this.cifrado.verificarFirma(this.mensajeFirmado(evidencia, fila.idUsuario, fila.idAdminRiesgo), fila.firma)
      };
    });
  }

  private mensajeFirmado(
    evidencia: Omit<EvidenciaNoRepudio, 'firma'>, usuarioId: number | null, adminRiesgoId: number | null
  ): string {
    return JSON.stringify([
      evidencia.id, usuarioId, adminRiesgoId, evidencia.accion, evidencia.recurso, evidencia.textoConfirmado,
      evidencia.versionTexto, evidencia.canal, evidencia.dispositivo, evidencia.confirmadoEn, evidencia.huellaDatos
    ]);
  }
}
