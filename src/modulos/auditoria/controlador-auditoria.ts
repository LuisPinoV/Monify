import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ContextoActual, MotivoAcceso, Permiso, SesionActual } from '../autorizacion/decoradores';
import type { Sesion } from '../autorizacion/roles';
import { ServicioAutorizacion } from '../autorizacion/servicio-autorizacion';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { BASE_LEGAL_CONSERVACION, CAMPOS_REGISTRO, CATALOGO_EVENTOS, PERMISOS_REGISTROS, PLAZOS_CONSERVACION } from './catalogo-eventos';
import { PLAN_ALERTAS, REGLAS_ALERTA, ServicioAlertas } from './servicio-alertas';
import { ServicioAuditoria } from './servicio-auditoria';
import { ServicioNoRepudio } from './servicio-no-repudio';

interface ConsultaLogs {
  usuarioId?: string;
  adminRiesgoId?: string;
  accion?: string;
  desde?: string;
  hasta?: string;
  limite?: string;
}

function enteroOpcional(valor: string | undefined, nombre: string): number | undefined {
  if (valor === undefined || valor === '') return undefined;
  const numero = Number(valor);
  if (!Number.isInteger(numero)) throw new BadRequestException(`${nombre} debe ser un entero`);
  return numero;
}

function fechaOpcional(valor: string | undefined, nombre: string): Date | undefined {
  if (!valor) return undefined;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new BadRequestException(`${nombre} no es una fecha válida`);
  return fecha;
}

@Controller('auditoria')
export class ControladorAuditoria {
  constructor(
    private readonly auditoria: ServicioAuditoria,
    private readonly noRepudio: ServicioNoRepudio,
    private readonly autorizacion: ServicioAutorizacion,
    private readonly alertas: ServicioAlertas
  ) {}

  @Get('logs')
  @Permiso('logs.revisar')
  async logs(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente,
    @MotivoAcceso() motivo: string | undefined, @Query() consulta: ConsultaLogs
  ) {
    await this.autorizacion.alcance(sesion, 'logs.revisar', { motivo, contexto });
    return this.auditoria.listar({
      usuarioId: enteroOpcional(consulta.usuarioId, 'usuarioId'), adminRiesgoId: enteroOpcional(consulta.adminRiesgoId, 'adminRiesgoId'),
      accion: consulta.accion || undefined,
      desde: fechaOpcional(consulta.desde, 'desde'), hasta: fechaOpcional(consulta.hasta, 'hasta'),
      limite: consulta.limite === undefined ? undefined : Number(consulta.limite)
    });
  }

  // Actividad 7, punto 6: línea de tiempo de un actor en un rango, con huella SHA-256 y firma (cadena de custodia).
  @Get('linea-tiempo')
  @Permiso('logs.revisar')
  async lineaTiempo(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente,
    @MotivoAcceso() motivo: string | undefined, @Query() consulta: ConsultaLogs
  ) {
    await this.autorizacion.alcance(sesion, 'logs.revisar', { motivo, contexto });
    const filtros = {
      usuarioId: enteroOpcional(consulta.usuarioId, 'usuarioId'), adminRiesgoId: enteroOpcional(consulta.adminRiesgoId, 'adminRiesgoId'),
      desde: fechaOpcional(consulta.desde, 'desde'), hasta: fechaOpcional(consulta.hasta, 'hasta')
    };
    if (filtros.usuarioId === undefined && filtros.adminRiesgoId === undefined) throw new BadRequestException('indica el actor: usuarioId o adminRiesgoId');
    if (!filtros.desde || !filtros.hasta) throw new BadRequestException('indica el rango: desde y hasta');
    const linea = await this.auditoria.lineaTiempo(filtros, `${sesion.rol}:${sesion.id}`);
    await this.auditoria.intentarRegistrar({
      actor: sesion, accion: 'auditoria.exportar', resultado: 'exito', contexto, recurso: 'linea-tiempo',
      detalle: { filtros: linea.filtros, eventos: linea.totalEventos, huella: linea.cadenaDeCustodia.huella }
    });
    return linea;
  }

  // Actividad 7, punto 4: alertas de acceso anómalo y su revisión.
  @Get('alertas')
  @Permiso('logs.revisar')
  async listarAlertas(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente, @MotivoAcceso() motivo: string | undefined,
    @Query('estado') estado?: string, @Query('codigo') codigo?: string
  ) {
    await this.autorizacion.alcance(sesion, 'logs.revisar', { motivo, contexto });
    return this.alertas.listar({ estado: estado || undefined, codigo: codigo || undefined });
  }

  @Patch('alertas/:id')
  @Permiso('logs.revisar')
  async revisarAlerta(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente, @MotivoAcceso() motivo: string | undefined,
    @Param('id', ParseIntPipe) id: number, @Body() datos: { estado?: unknown; nota?: unknown }
  ) {
    await this.autorizacion.alcance(sesion, 'logs.revisar', { motivo, contexto });
    return this.alertas.revisar(sesion, id, datos ?? {});
  }

  // Actividad 7, puntos 1 y 3: catálogo de eventos, campos, plazos de conservación, permisos y reglas de alerta.
  @Get('politica')
  @Permiso('logs.revisar')
  async politica(@SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente, @MotivoAcceso() motivo: string | undefined) {
    await this.autorizacion.alcance(sesion, 'logs.revisar', { motivo, contexto });
    return {
      campos: CAMPOS_REGISTRO, eventos: CATALOGO_EVENTOS, conservacion: { plazos: PLAZOS_CONSERVACION, baseLegal: BASE_LEGAL_CONSERVACION },
      permisos: PERMISOS_REGISTROS, alertas: REGLAS_ALERTA, planAlertas: PLAN_ALERTAS
    };
  }

  @Get('integridad')
  @Permiso('logs.revisar')
  async integridad(@SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente, @MotivoAcceso() motivo: string | undefined) {
    await this.autorizacion.alcance(sesion, 'logs.revisar', { motivo, contexto });
    return this.auditoria.verificarIntegridad();
  }

  @Get('evidencias')
  @Permiso('logs.revisar')
  async evidencias(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente,
    @MotivoAcceso() motivo: string | undefined, @Query('limite') limite?: string
  ) {
    await this.autorizacion.alcance(sesion, 'logs.revisar', { motivo, contexto });
    return this.noRepudio.listar({ limite: limite === undefined ? undefined : Number(limite) });
  }
}
