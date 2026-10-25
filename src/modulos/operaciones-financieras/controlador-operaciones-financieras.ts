import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import type { EstadoSolicitudCredito, EstadoVerificacion } from '../../tipos';
import { ContextoActual, MotivoAcceso, Permiso, SesionActual, SoloAutenticado } from '../autorizacion/decoradores';
import { enteroOpcional } from '../autorizacion/alcance';
import type { Sesion } from '../autorizacion/roles';
import { ServicioAutorizacion } from '../autorizacion/servicio-autorizacion';
import { ServicioOperacionesFinancieras } from './servicio-operaciones-financieras';

interface DatosTransaccion {
  tarjetaId: string | number;
  tipo: 'abono' | 'cargo';
  monto: number;
  confirmacionNoRepudio?: unknown;
}

interface DatosDeuda {
  usuarioId: string | number;
  monto: number;
}

interface DatosVerificacion {
  usuarioId: string | number;
  estado: EstadoVerificacion;
  metodo?: string;
  fechaVerificacion?: string;
  fechaExpiracion?: string;
  comprobante?: string;
}

interface DatosConsultaRiesgo {
  usuarioId: string | number;
  score?: number;
  morosidad: boolean;
  diasMorosidad?: number;
  diasEnDeuda?: number;
}

interface DatosCredito {
  monto: number;
  tasaInteres: number;
}

interface DatosSolicitud {
  creditoId: string | number;
  montoSolicitado: number;
  aceptaEvaluacionCrediticia?: unknown;
  confirmacionNoRepudio?: unknown;
}

interface DatosEstado {
  estado: EstadoSolicitudCredito;
  confirmacionNoRepudio?: unknown;
}

function identificador(valor: unknown, nombre: string): number {
  const numero = Number(valor);
  if (valor === undefined || valor === null || valor === '' || !Number.isInteger(numero) || numero <= 0) {
    throw new BadRequestException(`${nombre} es obligatorio y debe ser un entero positivo`);
  }
  return numero;
}

function fechaIso(valor: string | undefined, nombre: string): string | undefined {
  if (valor === undefined) return undefined;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new BadRequestException(`${nombre} no es una fecha válida`);
  return fecha.toISOString();
}

@Controller()
export class ControladorOperacionesFinancieras {
  constructor(
    private readonly servicio: ServicioOperacionesFinancieras,
    private readonly autorizacion: ServicioAutorizacion
  ) {}

  @Get('transacciones')
  @Permiso('historial.ver')
  async listarTransacciones(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente,
    @MotivoAcceso() motivo: string | undefined, @Query('usuarioId') usuarioId?: string
  ) {
    const alcance = await this.autorizacion.alcance(sesion, 'historial.ver', { motivo, contexto });
    return this.servicio.listarTransacciones(alcance, enteroOpcional(usuarioId, 'usuarioId'));
  }

  @Post('transacciones')
  @Permiso('transaccion.crear')
  crearTransaccion(@SesionActual() sesion: Sesion, @Body() datos: DatosTransaccion, @ContextoActual() contexto: ContextoCliente) {
    if (datos?.tipo !== 'abono' && datos?.tipo !== 'cargo') throw new BadRequestException("tipo debe ser 'abono' o 'cargo'");
    return this.servicio.crearTransaccion(sesion, { tarjetaId: identificador(datos.tarjetaId, 'tarjetaId'), tipo: datos.tipo, monto: datos.monto }, datos.confirmacionNoRepudio, contexto);
  }

  @Get('deudas')
  @Permiso('deuda.ver')
  async listarDeudas(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente,
    @MotivoAcceso() motivo: string | undefined, @Query('usuarioId') usuarioId?: string
  ) {
    const alcance = await this.autorizacion.alcance(sesion, 'deuda.ver', { motivo, contexto });
    return this.servicio.listarDeudas(alcance, enteroOpcional(usuarioId, 'usuarioId'));
  }

  @Post('deudas')
  @Permiso('riesgo.registrar')
  crearDeuda(@Body() datos: DatosDeuda) {
    return this.servicio.crearDeuda(identificador(datos?.usuarioId, 'usuarioId'), datos.monto);
  }

  @Get('verificaciones-identidad')
  @Permiso('kyc.ver')
  async listarVerificaciones(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente,
    @MotivoAcceso() motivo: string | undefined, @Query('usuarioId') usuarioId?: string
  ) {
    const alcance = await this.autorizacion.alcance(sesion, 'kyc.ver', { motivo, contexto });
    return this.servicio.listarVerificaciones(alcance, enteroOpcional(usuarioId, 'usuarioId'));
  }

  @Post('verificaciones-identidad')
  @Permiso('kyc.registrar')
  crearVerificacion(@Body() datos: DatosVerificacion) {
    if (!datos?.estado) throw new BadRequestException('usuarioId y estado son obligatorios');
    return this.servicio.crearVerificacion({
      usuarioId: identificador(datos.usuarioId, 'usuarioId'), estado: datos.estado, metodo: datos.metodo,
      fechaVerificacion: fechaIso(datos.fechaVerificacion, 'fechaVerificacion'),
      fechaExpiracion: fechaIso(datos.fechaExpiracion, 'fechaExpiracion'), comprobante: datos.comprobante
    });
  }

  @Get('consultas-riesgo')
  @Permiso('info_financiera.ver')
  async listarConsultasRiesgo(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente,
    @MotivoAcceso() motivo: string | undefined, @Query('usuarioId') usuarioId?: string
  ) {
    const alcance = await this.autorizacion.alcance(sesion, 'info_financiera.ver', { motivo, contexto });
    return this.servicio.listarConsultasRiesgo(alcance, enteroOpcional(usuarioId, 'usuarioId'));
  }

  @Post('consultas-riesgo')
  @Permiso('riesgo.registrar')
  crearConsultaRiesgo(@Body() datos: DatosConsultaRiesgo) {
    if (typeof datos?.morosidad !== 'boolean') throw new BadRequestException('usuarioId y morosidad son obligatorios');
    return this.servicio.crearConsultaRiesgo({
      usuarioId: identificador(datos.usuarioId, 'usuarioId'), score: datos.score, morosidad: datos.morosidad,
      diasMorosidad: datos.diasMorosidad, diasEnDeuda: datos.diasEnDeuda
    });
  }

  @Get('informacion-financiera')
  @Permiso('info_financiera.ver')
  async informacionFinanciera(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente,
    @MotivoAcceso() motivo: string | undefined, @Query('usuarioId') usuarioId?: string
  ) {
    const titular = enteroOpcional(usuarioId, 'usuarioId') ?? (sesion.rol === 'usuario' ? sesion.id : undefined);
    if (titular === undefined) throw new BadRequestException('usuarioId es obligatorio');
    await this.autorizacion.exigirAcceso(sesion, 'info_financiera.ver', titular, { motivo, contexto });
    return this.servicio.informacionFinanciera(titular);
  }

  @Get('creditos')
  @SoloAutenticado('creditos.listar')
  listarCreditos() {
    return this.servicio.listarCreditos();
  }

  @Post('creditos')
  @Permiso('credito.gestionar')
  crearCredito(@Body() datos: DatosCredito) {
    if (typeof datos?.monto !== 'number' || !Number.isFinite(datos.monto) || datos.monto <= 0
      || typeof datos.tasaInteres !== 'number' || !Number.isFinite(datos.tasaInteres) || datos.tasaInteres < 0) {
      throw new BadRequestException('monto y tasaInteres deben ser números válidos');
    }
    return this.servicio.crearCredito(datos.monto, datos.tasaInteres);
  }

  @Get('solicitudes-credito')
  @Permiso('solicitud_credito.ver')
  async listarSolicitudes(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente,
    @MotivoAcceso() motivo: string | undefined, @Query('usuarioId') usuarioId?: string
  ) {
    const alcance = await this.autorizacion.alcance(sesion, 'solicitud_credito.ver', { motivo, contexto });
    return this.servicio.listarSolicitudes(alcance, enteroOpcional(usuarioId, 'usuarioId'));
  }

  @Post('solicitudes-credito')
  @Permiso('solicitud_credito.crear')
  crearSolicitud(@SesionActual() sesion: Sesion, @Body() datos: DatosSolicitud, @ContextoActual() contexto: ContextoCliente) {
    return this.servicio.crearSolicitud(
      sesion,
      { creditoId: identificador(datos?.creditoId, 'creditoId'), montoSolicitado: datos?.montoSolicitado, aceptaEvaluacionCrediticia: datos?.aceptaEvaluacionCrediticia },
      datos?.confirmacionNoRepudio, contexto
    );
  }

  @Patch('solicitudes-credito/:id/estado')
  @Permiso('solicitud_credito.aprobar')
  async actualizarEstado(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente, @MotivoAcceso() motivo: string | undefined,
    @Param('id', ParseIntPipe) id: number, @Body() datos: DatosEstado
  ) {
    await this.autorizacion.alcance(sesion, 'solicitud_credito.aprobar', { motivo, contexto });
    return this.servicio.resolverSolicitud(sesion, id, datos?.estado, datos?.confirmacionNoRepudio, contexto);
  }
}
