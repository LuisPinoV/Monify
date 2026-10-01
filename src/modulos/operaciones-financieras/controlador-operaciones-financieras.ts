import { Body, Controller, Get, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { EstadoSolicitudCredito } from '../../tipos.js';
import { ServicioOperacionesFinancieras } from './servicio-operaciones-financieras';

interface DatosMonto {
  usuarioId: string;
  monto: number;
}

interface DatosVerificacion {
  usuarioId: string;
  estado: 'pendiente' | 'en_revision' | 'verificada' | 'rechazada';
  metodo?: string;
  fechaVerificacion?: string;
  fechaExpiracion?: string;
}

interface DatosConsultaRiesgo {
  usuarioId: string;
  score?: number;
  morosidad: boolean;
  tiempoDeMorosidad?: string;
  cantidadDeuda?: number;
  tiempoEnDeuda?: string;
}

interface DatosCredito {
  monto: number;
  tasaInteres: number;
}

interface DatosSolicitud {
  usuarioId: string;
  creditoId: string;
  montoSolicitado: number;
}

interface DatosEstado {
  estado: EstadoSolicitudCredito;
}

@Controller()
export class ControladorOperacionesFinancieras {
  constructor(private readonly servicio: ServicioOperacionesFinancieras) {}

  @Get('transacciones') listarTransacciones() { return this.servicio.listarTransacciones(); }

  @Post('transacciones') async crearTransaccion(@Body() datos: DatosMonto, @Res() response: Response) {
    const error = this.validarMonto(datos);
    if (error) return response.status(400).json({ mensaje: error });
    const transaccion = await this.servicio.crearTransaccion(datos.usuarioId.trim(), datos.monto);
    return response.status(201).json(transaccion);
  }

  @Get('deudas') listarDeudas() { return this.servicio.listarDeudas(); }

  @Post('deudas') async crearDeuda(@Body() datos: DatosMonto, @Res() response: Response) {
    const error = this.validarMonto(datos);
    if (error) return response.status(400).json({ mensaje: error });
    const deuda = await this.servicio.crearDeuda(datos.usuarioId.trim(), datos.monto);
    return response.status(201).json(deuda);
  }

  @Get('verificaciones-identidad') listarVerificaciones() { return this.servicio.listarVerificaciones(); }

  @Post('verificaciones-identidad') async crearVerificacion(@Body() datos: DatosVerificacion, @Res() response: Response) {
    if (!datos.usuarioId?.trim() || !datos.estado) return response.status(400).json({ mensaje: 'usuarioId y estado son obligatorios' });
    const verificacion = await this.servicio.crearVerificacion({ ...datos, usuarioId: datos.usuarioId.trim() });
    return response.status(201).json(verificacion);
  }

  @Get('consultas-riesgo') listarConsultasRiesgo() { return this.servicio.listarConsultasRiesgo(); }

  @Post('consultas-riesgo') async crearConsultaRiesgo(@Body() datos: DatosConsultaRiesgo, @Res() response: Response) {
    if (!datos.usuarioId?.trim() || typeof datos.morosidad !== 'boolean') return response.status(400).json({ mensaje: 'usuarioId y morosidad son obligatorios' });
    const consulta = await this.servicio.crearConsultaRiesgo({ ...datos, usuarioId: datos.usuarioId.trim() });
    return response.status(201).json(consulta);
  }

  @Get('creditos') listarCreditos() { return this.servicio.listarCreditos(); }

  @Post('creditos') async crearCredito(@Body() datos: DatosCredito, @Res() response: Response) {
    if (!this.esNumeroPositivo(datos.monto) || !this.esNumeroNoNegativo(datos.tasaInteres)) return response.status(400).json({ mensaje: 'monto y tasaInteres deben ser números válidos' });
    const credito = await this.servicio.crearCredito(datos.monto, datos.tasaInteres);
    return response.status(201).json(credito);
  }

  @Get('solicitudes-credito') listarSolicitudes() { return this.servicio.listarSolicitudes(); }

  @Post('solicitudes-credito') async crearSolicitud(@Body() datos: DatosSolicitud, @Res() response: Response) {
    if (!datos.usuarioId?.trim() || !datos.creditoId?.trim() || !this.esNumeroPositivo(datos.montoSolicitado)) return response.status(400).json({ mensaje: 'usuarioId, creditoId y montoSolicitado son obligatorios' });
    const solicitud = await this.servicio.crearSolicitud(datos.usuarioId.trim(), datos.creditoId.trim(), datos.montoSolicitado);
    return response.status(201).json(solicitud);
  }

  @Patch('solicitudes-credito/:id/estado') actualizarEstado(@Param('id') id: string, @Body() datos: DatosEstado) {
    return this.servicio.actualizarEstadoSolicitud(id, datos.estado);
  }

  private validarMonto(datos: DatosMonto): string | undefined {
    if (!datos.usuarioId?.trim()) return 'usuarioId es obligatorio';
    if (!this.esNumeroPositivo(datos.monto)) return 'monto debe ser un número mayor que cero';
    return undefined;
  }

  private esNumeroPositivo(valor: number): boolean { return typeof valor === 'number' && Number.isFinite(valor) && valor > 0; }
  private esNumeroNoNegativo(valor: number): boolean { return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0; }
}