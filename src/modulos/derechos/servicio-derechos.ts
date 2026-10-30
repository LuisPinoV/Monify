import { BadRequestException, ConflictException, ForbiddenException, GoneException, HttpException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { BaseDatos, fijarContexto, type Ejecutor } from '../../base-datos';
import { PersistenciaCifrada } from '../../seguridad/persistencia-cifrada';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { ServicioAuditoria } from '../auditoria/servicio-auditoria';
import { ServicioNoRepudio } from '../auditoria/servicio-no-repudio';
import { ServicioAutenticacion } from '../autenticacion/servicio-autenticacion';
import type { Sesion } from '../autorizacion/roles';
import { DIAS_PLAZO_DERECHOS, VERSION_TERMINOS } from '../terminos/terminos';
import { ServicioUsuarios, type CambiosRectificacion } from '../usuarios/servicio-usuarios';
import { ServicioNotificaciones } from './servicio-notificaciones';

export const TIPOS_DERECHO = ['acceso', 'rectificacion', 'supresion'] as const;
export type TipoDerecho = (typeof TIPOS_DERECHO)[number];
export type EstadoDerecho = 'recibida' | 'verificada' | 'en_evaluacion' | 'ejecutada' | 'rechazada' | 'cerrada';
type NivelVerificacion = 'contrasena' | 'contrasena_y_codigo';

export const MINUTOS_VIGENCIA_CODIGO = 10;
export const MAXIMO_INTENTOS_VERIFICACION = 5;
export const HORAS_DESCARGA = 24;
export const FORMATO_PORTABILIDAD = 'monify.portabilidad/1';

export interface DatosNuevaSolicitud {
  tipo?: string;
  cambios?: unknown;
  confirmacionNoRepudio?: unknown;
}

export interface DatosVerificacion {
  contrasena?: unknown;
  codigo?: unknown;
}

interface FilaSolicitud {
  idSolicitudDerecho: number;
  idUsuario: number;
  tipoDerecho: TipoDerecho;
  estado: EstadoDerecho;
  resultado: string | null;
  datosSolicitud: string | null;
  respuesta: string | null;
  nivelVerificacion: NivelVerificacion;
  codigoVerificacion: string | null;
  codigoExpiraEn: Date | null;
  intentosVerificacion: number;
  canal: string;
  recibidaEn: Date;
  verificadaEn: Date | null;
  evaluadaEn: Date | null;
  resueltaEn: Date | null;
  cerradaEn: Date | null;
  plazoRespuesta: Date;
  descargaDisponibleHasta: Date | null;
  idEvidencia: string | null;
}

interface FilaHistorial {
  idSolicitudDerecho: number;
  estadoAnterior: string | null;
  estadoNuevo: string;
  fecha: Date;
  actor: string;
  canal: string;
}

const iso = (valor: Date | null) => (valor ? new Date(valor).toISOString() : null);

// Fundamento de la conservación cuando la supresión no procede (Ley 21.719: obligación legal y ejecución del contrato).
const FUNDAMENTO_RECHAZO_SUPRESION =
  'Conforme a la sección 7 de los Términos y Condiciones y a la Ley N° 19.628 (modificada por la Ley N° 21.719), la supresión no procede '
  + 'mientras los datos sean necesarios para ejecutar el contrato o cumplir una obligación legal. Debes resolver primero: ';

const RESPUESTA_SUPRESION =
  'Tu cuenta fue cerrada y tus datos personales anonimizados de forma irreversible: se eliminó el vínculo con la bóveda de seudónimos, '
  + 'tus credenciales, el número de tus tarjetas y los consentimientos. Las transacciones, créditos, evidencias de no repudio y la bitácora '
  + 'se conservan sin identificarte por la obligación legal de trazabilidad financiera. Los respaldos cifrados se renuevan en su ciclo de rotación '
  + 'y, como solo contienen seudónimos, tampoco permiten identificarte.';

/**
 * Ejercicio de derechos (Actividad 5, parte 2). Flujo de cada solicitud:
 *   recibida -> verificada (identidad) -> en_evaluacion (reglas de negocio) -> ejecutada | rechazada (respuesta fundamentada) -> cerrada
 * Las transiciones las vuelve a validar un trigger en la base de datos, que además escribe el historial.
 */
@Injectable()
export class ServicioDerechos {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly persistenciaCifrada: PersistenciaCifrada,
    private readonly usuarios: ServicioUsuarios,
    private readonly autenticacion: ServicioAutenticacion,
    private readonly noRepudio: ServicioNoRepudio,
    private readonly auditoria: ServicioAuditoria,
    private readonly notificaciones: ServicioNotificaciones
  ) {}

  // ---------------------------------------------------------------- recepción

  async crear(sesion: Sesion, datos: DatosNuevaSolicitud, contexto: ContextoCliente) {
    this.exigirTitular(sesion);
    const tipo = datos.tipo as TipoDerecho;
    if (!TIPOS_DERECHO.includes(tipo)) throw new BadRequestException(`tipo debe ser uno de: ${TIPOS_DERECHO.join(', ')}`);

    // Las validaciones de negocio se aplican al recibir la solicitud y otra vez al evaluarla.
    let cambios: CambiosRectificacion | undefined;
    if (tipo === 'rectificacion') cambios = await this.usuarios.validarRectificacion(sesion.id, datos.cambios);
    if (tipo === 'supresion') this.noRepudio.exigirConfirmacion(datos.confirmacionNoRepudio);

    // Verificación proporcional al riesgo: entregar todos los datos, cambiar el correo de acceso o suprimir la cuenta exige
    // además un código de un solo uso; cambiar nombre, celular o renta solo la contraseña. No se piden datos adicionales.
    const nivel: NivelVerificacion = tipo === 'rectificacion' && cambios?.correo === undefined ? 'contrasena' : 'contrasena_y_codigo';
    const codigo = nivel === 'contrasena_y_codigo' ? String(randomInt(0, 1_000_000)).padStart(6, '0') : null;

    let id: number;
    try {
      id = await this.baseDatos.transaccion(async (tx) => {
        await fijarContexto(tx, { ...contexto, actor: 'titular' });
        const evidencia = tipo === 'supresion'
          ? await this.noRepudio.registrar({ actor: sesion, accion: 'cuenta.eliminar', recurso: `usuario:${sesion.id}`, datos: { tipo }, contexto }, tx)
          : null;
        const insertada = await tx.consultar<{ id: number }>(`
          INSERT INTO "SolicitudDerecho" ("idUsuario", "tipoDerecho", "datosSolicitud", "nivelVerificacion", "codigoExpiraEn", "canal",
                                          "plazoRespuesta", "idEvidencia")
          VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() + make_interval(mins => $6) END, $7, now() + make_interval(days => $8), $9)
          RETURNING "idSolicitudDerecho" AS id
        `, [sesion.id, tipo, cambios ? this.persistenciaCifrada.protegerCampo(cambios) : null, nivel, codigo !== null,
          MINUTOS_VIGENCIA_CODIGO, contexto.canal, DIAS_PLAZO_DERECHOS, evidencia?.id ?? null]);
        const nuevoId = insertada.rows[0].id;
        if (codigo) {
          await tx.consultar('UPDATE "SolicitudDerecho" SET "codigoVerificacion" = $2 WHERE "idSolicitudDerecho" = $1', [nuevoId, this.huellaCodigo(nuevoId, codigo)]);
        }
        return nuevoId;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException(`ya tienes una solicitud de ${tipo} en curso; termínala o desiste de ella`);
      throw error;
    }

    let envio: Awaited<ReturnType<ServicioNotificaciones['enviarCodigo']>> | undefined;
    if (codigo) {
      // Para un cambio de correo el código va al correo nuevo: así se comprueba que el titular lo controla.
      const destino = cambios?.correo ?? (await this.usuarios.obtenerPerfil(sesion)).correo;
      envio = await this.notificaciones.enviarCodigo(destino, codigo, `derecho de ${tipo}`);
    }
    await this.registrarEvento(sesion, `derechos.${tipo}.recibida`, id, contexto, { nivel });
    return {
      solicitud: await this.obtener(sesion.id, id),
      verificacion: {
        requiere: nivel === 'contrasena' ? ['contrasena'] : ['contrasena', 'codigo'],
        ...(envio ? { codigoEnviadoA: envio.destinoEnmascarado, codigoExpiraEnMinutos: MINUTOS_VIGENCIA_CODIGO } : {}),
        ...(envio?.codigoDesarrollo ? { codigoDesarrollo: envio.codigoDesarrollo } : {})
      }
    };
  }

  // ---------------------------------------------------------------- verificación

  async verificar(sesion: Sesion, id: number, datos: DatosVerificacion, contexto: ContextoCliente) {
    this.exigirTitular(sesion);
    const solicitud = await this.cargar(sesion.id, id);
    if (solicitud.estado !== 'recibida') throw new ConflictException(`la solicitud ya no espera verificación (estado: ${solicitud.estado})`);

    if (solicitud.codigoExpiraEn && new Date(solicitud.codigoExpiraEn).getTime() <= Date.now()) {
      await this.rechazarYCerrar(id, 'La verificación de identidad no se completó: el código de un solo uso expiró. Puedes presentar una nueva solicitud.', contexto, 'sistema');
      await this.registrarEvento(sesion, `derechos.${solicitud.tipoDerecho}.verificacion`, id, contexto, { motivo: 'codigo_expirado' }, 'fallo');
      throw new GoneException('el código de verificación expiró; la solicitud fue cerrada');
    }

    const contrasenaValida = typeof datos.contrasena === 'string' && await this.autenticacion.verificarContrasena(sesion, datos.contrasena);
    const codigoValido = solicitud.nivelVerificacion === 'contrasena'
      || (typeof datos.codigo === 'string' && solicitud.codigoVerificacion === this.huellaCodigo(id, datos.codigo.trim()));
    if (!contrasenaValida || !codigoValido) {
      const intentos = solicitud.intentosVerificacion + 1;
      await this.baseDatos.consultar('UPDATE "SolicitudDerecho" SET "intentosVerificacion" = $2 WHERE "idSolicitudDerecho" = $1', [id, intentos]);
      await this.registrarEvento(sesion, `derechos.${solicitud.tipoDerecho}.verificacion`, id, contexto, { intentos }, 'fallo');
      if (intentos >= MAXIMO_INTENTOS_VERIFICACION) {
        await this.rechazarYCerrar(id, `La verificación de identidad falló ${intentos} veces; por seguridad la solicitud se cerró sin entregar ni modificar datos.`, contexto, 'sistema');
        throw new ForbiddenException('demasiados intentos fallidos; la solicitud fue cerrada');
      }
      throw new UnauthorizedException('no pudimos verificar tu identidad: revisa la contraseña y el código');
    }

    await this.transicion(id, 'verificada', contexto, 'titular', { verificadaEn: true, borrarCodigo: true });
    await this.registrarEvento(sesion, `derechos.${solicitud.tipoDerecho}.verificada`, id, contexto);
    return this.evaluarYEjecutar(sesion, id, contexto);
  }

  // ---------------------------------------------------------------- evaluación y ejecución

  private async evaluarYEjecutar(sesion: Sesion, id: number, contexto: ContextoCliente) {
    await this.transicion(id, 'en_evaluacion', contexto, 'sistema', { evaluadaEn: true });
    const solicitud = await this.cargar(sesion.id, id);
    let cerrarSesion = false;
    try {
      if (solicitud.tipoDerecho === 'acceso') {
        // La copia se genera al descargarla, así no queda almacenada una segunda copia de los datos.
        await this.transicion(id, 'ejecutada', contexto, 'sistema', {
          resultado: 'ejecutada', descarga: true,
          respuesta: `Tu copia está lista. Descárgala dentro de ${HORAS_DESCARGA} horas; se entrega una sola vez y la descarga cierra la solicitud.`
        });
      } else if (solicitud.tipoDerecho === 'rectificacion') {
        const cambios = this.persistenciaCifrada.revelarCampo<CambiosRectificacion>(solicitud.datosSolicitud) ?? {};
        const validados = await this.usuarios.validarRectificacion(sesion.id, cambios);
        const aplicados = await this.usuarios.aplicarRectificacion(sesion.id, validados);
        await this.transicion(id, 'ejecutada', contexto, 'sistema', {
          resultado: 'ejecutada',
          respuesta: `Se rectificaron: ${aplicados.join(', ')}. Los demás módulos usan el dato corregido de inmediato porque se identifican por seudónimo.`
            + (aplicados.includes('correo') ? ' Desde ahora inicias sesión con el correo nuevo.' : '')
            + (aplicados.includes('rentaMensual') ? ' Las próximas evaluaciones de riesgo usarán el nuevo tramo de renta.' : '')
        });
        await this.transicion(id, 'cerrada', contexto, 'sistema', { borrarDatos: true });
      } else {
        const pendientes = await this.usuarios.obligacionesPendientes(sesion.id);
        if (pendientes.length > 0) {
          await this.transicion(id, 'rechazada', contexto, 'sistema', { resultado: 'rechazada', respuesta: `${FUNDAMENTO_RECHAZO_SUPRESION}${pendientes.join('; ')}.` });
          await this.transicion(id, 'cerrada', contexto, 'sistema', {});
        } else {
          await this.usuarios.anonimizarCuenta(sesion.id, contexto);
          await this.transicion(id, 'ejecutada', contexto, 'sistema', { resultado: 'ejecutada', respuesta: RESPUESTA_SUPRESION });
          await this.transicion(id, 'cerrada', contexto, 'sistema', {});
          cerrarSesion = true;
        }
      }
    } catch (error) {
      // Una regla de negocio que deja de cumplirse entre la recepción y la ejecución termina en una respuesta fundamentada.
      if (!(error instanceof HttpException) || error.getStatus() >= 500) throw error;
      const motivo = (error.getResponse() as { message?: string | string[] }).message ?? error.message;
      await this.transicion(id, 'rechazada', contexto, 'sistema', { resultado: 'rechazada', respuesta: `La solicitud no procede: ${Array.isArray(motivo) ? motivo.join(', ') : motivo}.` });
      await this.transicion(id, 'cerrada', contexto, 'sistema', { borrarDatos: true });
    }
    const final = await this.obtener(sesion.id, id);
    await this.registrarEvento(sesion, `derechos.${final.tipo}.${final.resultado ?? final.estado}`, id, contexto);
    return { solicitud: final, sesionCerrada: cerrarSesion };
  }

  // ---------------------------------------------------------------- entrega (acceso y portabilidad)

  async descargar(sesion: Sesion, id: number, contexto: ContextoCliente) {
    this.exigirTitular(sesion);
    const solicitud = await this.cargar(sesion.id, id);
    if (solicitud.tipoDerecho !== 'acceso') throw new BadRequestException('solo las solicitudes de acceso tienen una copia para descargar');
    if (solicitud.estado !== 'ejecutada') throw new ConflictException(`la copia no está disponible (estado: ${solicitud.estado})`);
    if (!solicitud.descargaDisponibleHasta || new Date(solicitud.descargaDisponibleHasta).getTime() <= Date.now()) {
      await this.transicion(id, 'cerrada', contexto, 'sistema:vencimiento', {});
      throw new GoneException('el plazo de descarga venció; presenta una nueva solicitud de acceso');
    }
    const datos = await this.usuarios.datosParaExportar(sesion.id);
    const contenido = JSON.stringify(datos);
    const exportacion = {
      formato: FORMATO_PORTABILIDAD,
      generadoEn: new Date().toISOString(),
      solicitud: String(id),
      versionTerminos: VERSION_TERMINOS,
      descripcion: 'Copia de tus datos personales en Monify (JSON estructurado y legible por máquinas). No incluye datos de terceros, seudónimos internos, firmas ni claves.',
      secciones: Object.keys(datos),
      datos,
      integridad: { algoritmo: 'SHA-256', alcance: 'JSON.stringify(datos)', huella: createHash('sha256').update(contenido).digest('hex') }
    };
    await this.transicion(id, 'cerrada', contexto, 'titular', {});
    await this.registrarEvento(sesion, 'derechos.acceso.descargada', id, contexto, { huella: exportacion.integridad.huella, secciones: exportacion.secciones.length });
    return exportacion;
  }

  async desistir(sesion: Sesion, id: number, contexto: ContextoCliente) {
    this.exigirTitular(sesion);
    const solicitud = await this.cargar(sesion.id, id);
    if (solicitud.estado !== 'recibida' && solicitud.estado !== 'verificada') {
      throw new ConflictException(`no puedes desistir de una solicitud en estado ${solicitud.estado}`);
    }
    await this.transicion(id, 'cerrada', contexto, 'titular', { resultado: 'desistida', respuesta: 'El titular desistió de la solicitud.', borrarCodigo: true, borrarDatos: true });
    await this.registrarEvento(sesion, `derechos.${solicitud.tipoDerecho}.desistida`, id, contexto);
    return this.obtener(sesion.id, id);
  }

  // ---------------------------------------------------------------- consulta

  async listar(sesion: Sesion) {
    this.exigirTitular(sesion);
    await this.cerrarDescargasVencidas(sesion.id);
    const resultado = await this.baseDatos.consultar<FilaSolicitud>(
      'SELECT * FROM "SolicitudDerecho" WHERE "idUsuario" = $1 ORDER BY "idSolicitudDerecho" DESC', [sesion.id]
    );
    const historial = await this.historial(resultado.rows.map((fila) => fila.idSolicitudDerecho));
    return resultado.rows.map((fila) => this.vista(fila, historial.get(fila.idSolicitudDerecho) ?? []));
  }

  // Para Admin y Auditor: solo estados, fechas y plazos. Nunca los cambios pedidos ni la respuesta.
  async supervisar() {
    const resultado = await this.baseDatos.consultar<FilaSolicitud>('SELECT * FROM "SolicitudDerecho" ORDER BY "idSolicitudDerecho" DESC LIMIT 500');
    const ahora = Date.now();
    return resultado.rows.map((fila) => ({
      id: String(fila.idSolicitudDerecho), usuarioId: String(fila.idUsuario), tipo: fila.tipoDerecho, estado: fila.estado,
      resultado: fila.resultado, nivelVerificacion: fila.nivelVerificacion, canal: fila.canal,
      recibidaEn: iso(fila.recibidaEn), resueltaEn: iso(fila.resueltaEn), cerradaEn: iso(fila.cerradaEn), plazoRespuesta: iso(fila.plazoRespuesta),
      fueraDePlazo: fila.estado !== 'cerrada' && new Date(fila.plazoRespuesta).getTime() < ahora
    }));
  }

  private async obtener(usuarioId: number, id: number) {
    const fila = await this.cargar(usuarioId, id);
    const historial = await this.historial([id]);
    return this.vista(fila, historial.get(id) ?? []);
  }

  private async cargar(usuarioId: number, id: number, ejecutor: Ejecutor = this.baseDatos): Promise<FilaSolicitud> {
    // Solo las propias: una solicitud ajena responde igual que una inexistente.
    const resultado = await ejecutor.consultar<FilaSolicitud>(
      'SELECT * FROM "SolicitudDerecho" WHERE "idSolicitudDerecho" = $1 AND "idUsuario" = $2', [id, usuarioId]
    );
    if (resultado.rows.length === 0) throw new NotFoundException('solicitud no encontrada');
    return resultado.rows[0];
  }

  private async historial(ids: number[]): Promise<Map<number, FilaHistorial[]>> {
    const mapa = new Map<number, FilaHistorial[]>();
    if (ids.length === 0) return mapa;
    const resultado = await this.baseDatos.consultar<FilaHistorial>(
      'SELECT * FROM "HistorialSolicitudDerecho" WHERE "idSolicitudDerecho" = ANY($1::int[]) ORDER BY "idEvento"', [ids]
    );
    for (const fila of resultado.rows) mapa.set(fila.idSolicitudDerecho, [...(mapa.get(fila.idSolicitudDerecho) ?? []), fila]);
    return mapa;
  }

  private vista(fila: FilaSolicitud, historial: FilaHistorial[]) {
    const cambios = fila.datosSolicitud ? this.persistenciaCifrada.revelarCampo<CambiosRectificacion>(fila.datosSolicitud) : null;
    return {
      id: String(fila.idSolicitudDerecho), tipo: fila.tipoDerecho, estado: fila.estado, resultado: fila.resultado, respuesta: fila.respuesta,
      nivelVerificacion: fila.nivelVerificacion, camposSolicitados: cambios ? Object.keys(cambios) : undefined, canal: fila.canal,
      recibidaEn: iso(fila.recibidaEn), verificadaEn: iso(fila.verificadaEn), evaluadaEn: iso(fila.evaluadaEn), resueltaEn: iso(fila.resueltaEn),
      cerradaEn: iso(fila.cerradaEn), plazoRespuesta: iso(fila.plazoRespuesta), descargaDisponibleHasta: iso(fila.descargaDisponibleHasta),
      codigoExpiraEn: fila.estado === 'recibida' ? iso(fila.codigoExpiraEn) : null, evidenciaId: fila.idEvidencia,
      historial: historial.map((h) => ({ estadoAnterior: h.estadoAnterior, estadoNuevo: h.estadoNuevo, fecha: iso(h.fecha), actor: h.actor, canal: h.canal }))
    };
  }

  // ---------------------------------------------------------------- utilidades

  private async transicion(id: number, estado: EstadoDerecho, contexto: ContextoCliente, actor: string, opciones: {
    resultado?: string; respuesta?: string; verificadaEn?: boolean; evaluadaEn?: boolean; descarga?: boolean; borrarCodigo?: boolean; borrarDatos?: boolean;
  }): Promise<void> {
    await this.baseDatos.transaccion(async (tx) => {
      await fijarContexto(tx, { ...contexto, actor });
      await tx.consultar(`
        UPDATE "SolicitudDerecho" SET
          "estado" = $2::varchar,
          "resultado" = COALESCE($3::varchar, "resultado"),
          "respuesta" = COALESCE($4::text, "respuesta"),
          "verificadaEn" = CASE WHEN $5::boolean THEN now() ELSE "verificadaEn" END,
          "evaluadaEn" = CASE WHEN $6::boolean THEN now() ELSE "evaluadaEn" END,
          "resueltaEn" = CASE WHEN $2::varchar IN ('ejecutada', 'rechazada') OR ($2::varchar = 'cerrada' AND "resueltaEn" IS NULL) THEN now() ELSE "resueltaEn" END,
          "cerradaEn" = CASE WHEN $2::varchar = 'cerrada' THEN now() ELSE "cerradaEn" END,
          "descargaDisponibleHasta" = CASE WHEN $7::boolean THEN now() + make_interval(hours => $8) ELSE "descargaDisponibleHasta" END,
          "codigoVerificacion" = CASE WHEN $9::boolean OR $2::varchar = 'cerrada' THEN NULL ELSE "codigoVerificacion" END,
          "datosSolicitud" = CASE WHEN $10::boolean OR $2::varchar = 'cerrada' THEN NULL ELSE "datosSolicitud" END
        WHERE "idSolicitudDerecho" = $1
      `, [id, estado, opciones.resultado ?? null, opciones.respuesta ?? null, opciones.verificadaEn ?? false, opciones.evaluadaEn ?? false,
        opciones.descarga ?? false, HORAS_DESCARGA, opciones.borrarCodigo ?? false, opciones.borrarDatos ?? false]);
    });
  }

  private async rechazarYCerrar(id: number, respuesta: string, contexto: ContextoCliente, actor: string): Promise<void> {
    await this.transicion(id, 'rechazada', contexto, actor, { resultado: 'rechazada', respuesta, borrarCodigo: true });
    await this.transicion(id, 'cerrada', contexto, actor, {});
  }

  private async cerrarDescargasVencidas(usuarioId: number): Promise<void> {
    await this.baseDatos.transaccion(async (tx) => {
      await fijarContexto(tx, { canal: 'api', dispositivo: 'monify-api', actor: 'sistema:vencimiento' });
      await tx.consultar(`
        UPDATE "SolicitudDerecho" SET "estado" = 'cerrada', "cerradaEn" = now()
        WHERE "idUsuario" = $1 AND "tipoDerecho" = 'acceso' AND "estado" = 'ejecutada' AND "descargaDisponibleHasta" <= now()
      `, [usuarioId]);
    });
  }

  private huellaCodigo(id: number, codigo: string): string {
    return this.persistenciaCifrada.indiceBusqueda(`derechos:${id}:${codigo}`);
  }

  // En la bitácora solo van identificadores y metadatos: nunca el código, la contraseña ni los datos pedidos.
  private registrarEvento(sesion: Sesion, accion: string, id: number, contexto: ContextoCliente, detalle?: Record<string, unknown>, resultado: 'exito' | 'fallo' = 'exito') {
    return this.auditoria.intentarRegistrar({ actor: sesion, accion, resultado, contexto, recurso: `solicitud_derecho:${id}`, detalle });
  }

  private exigirTitular(sesion: Sesion): void {
    if (sesion.cuenta !== 'usuario' || sesion.rol !== 'usuario') throw new ForbiddenException('solo los titulares ejercen derechos sobre sus datos');
  }
}
