import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ContextoActual, MotivoAcceso, Permiso, SesionActual } from '../autorizacion/decoradores';
import type { Sesion } from '../autorizacion/roles';
import { ServicioAutorizacion } from '../autorizacion/servicio-autorizacion';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { ServicioAuditoria } from './servicio-auditoria';
import { ServicioNoRepudio } from './servicio-no-repudio';

interface ConsultaLogs {
  usuarioId?: string;
  accion?: string;
  desde?: string;
  hasta?: string;
  limite?: string;
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
    private readonly autorizacion: ServicioAutorizacion
  ) {}

  @Get('logs')
  @Permiso('logs.revisar')
  async logs(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente,
    @MotivoAcceso() motivo: string | undefined, @Query() consulta: ConsultaLogs
  ) {
    await this.autorizacion.alcance(sesion, 'logs.revisar', { motivo, contexto });
    const usuarioId = consulta.usuarioId === undefined ? undefined : Number(consulta.usuarioId);
    if (usuarioId !== undefined && !Number.isInteger(usuarioId)) throw new BadRequestException('usuarioId debe ser un entero');
    return this.auditoria.listar({
      usuarioId, accion: consulta.accion || undefined,
      desde: fechaOpcional(consulta.desde, 'desde'), hasta: fechaOpcional(consulta.hasta, 'hasta'),
      limite: consulta.limite === undefined ? undefined : Number(consulta.limite)
    });
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
