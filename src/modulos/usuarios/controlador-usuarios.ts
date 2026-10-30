import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { Publica } from '../autenticacion/publico.decorador';
import { ServicioAuditoria } from '../auditoria/servicio-auditoria';
import { ContextoActual, MotivoAcceso, Permiso, SesionActual, SoloAutenticado } from '../autorizacion/decoradores';
import type { Sesion } from '../autorizacion/roles';
import { ServicioAutorizacion } from '../autorizacion/servicio-autorizacion';
import { ServicioUsuarios, type DatosCuenta } from './servicio-usuarios';
import type { AceptacionFinalidades } from '../terminos/servicio-consentimientos';

interface DatosRegistro extends Partial<DatosCuenta>, AceptacionFinalidades {}

interface DatosBloqueo {
  bloqueado: boolean;
  cuenta?: 'usuario' | 'administrador_riesgo';
}

@Controller('usuarios')
export class ControladorUsuarios {
  constructor(
    private readonly servicio: ServicioUsuarios,
    private readonly autorizacion: ServicioAutorizacion,
    private readonly auditoria: ServicioAuditoria
  ) {}

  // Autoregistro público: siempre crea un titular (rol usuario) y exige aceptar los Términos y Condiciones.
  @Post()
  @Publica()
  registrar(@Body() datos: DatosRegistro, @ContextoActual() contexto: ContextoCliente) {
    return this.servicio.registrar(datos as DatosCuenta, datos ?? {}, contexto);
  }

  @Get()
  @Permiso('usuarios.listar')
  listar() {
    return this.servicio.listar();
  }

  @Get('me')
  @SoloAutenticado('perfil.ver')
  perfil(@SesionActual() sesion: Sesion) {
    return this.servicio.obtenerPerfil(sesion);
  }

  // La rectificación, la copia de los datos (acceso y portabilidad) y la eliminación de la cuenta (supresión)
  // ya no son endpoints directos: se piden como solicitudes en el módulo de derechos (/derechos).

  // Auditoría: cada persona ve el registro de sus propias acciones.
  @Get('me/actividad')
  @SoloAutenticado('actividad.ver')
  actividad(@SesionActual() sesion: Sesion) {
    return this.auditoria.listar(sesion.cuenta === 'usuario' ? { usuarioId: sesion.id, limite: 200 } : { adminRiesgoId: sesion.id, limite: 200 });
  }

  @Patch(':id/bloqueo')
  @Permiso('perfil.actualizar')
  async bloquear(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente, @MotivoAcceso() motivo: string | undefined,
    @Param('id', ParseIntPipe) id: number, @Body() datos: DatosBloqueo
  ) {
    if (typeof datos?.bloqueado !== 'boolean') throw new BadRequestException('bloqueado debe ser verdadero o falso');
    const cuenta = datos.cuenta ?? 'usuario';
    if (cuenta !== 'usuario' && cuenta !== 'administrador_riesgo') throw new BadRequestException('cuenta no es válida');
    // Solo quien tiene alcance sobre cualquier perfil (Admin) puede bloquear cuentas ajenas.
    const alcance = await this.autorizacion.alcance(sesion, 'perfil.actualizar', { motivo, contexto });
    if (alcance.tipo !== 'todos') throw new ForbiddenException('solo un administrador puede bloquear o desbloquear cuentas');
    return this.servicio.establecerBloqueo(sesion, cuenta, id, datos.bloqueado);
  }
}
