import { BadRequestException, Body, Controller, HttpCode, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ServicioAuditoria } from '../auditoria/servicio-auditoria';
import { ServicioAutenticacion } from '../autenticacion/servicio-autenticacion';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { ContextoActual, Permiso, SesionActual } from '../autorizacion/decoradores';
import { esRol, type Rol, type Sesion } from '../autorizacion/roles';
import { ServicioUsuarios, type DatosCuenta } from '../usuarios/servicio-usuarios';

interface DatosNuevaCuenta extends Partial<DatosCuenta> {
  rol?: Rol;
}

interface DatosContrasena {
  cuenta?: 'usuario' | 'administrador_riesgo';
  contrasena?: string;
}

// Gestión interna a cargo del rol Admin: creación de cuentas del personal y administración de roles.
@Controller('admin')
export class ControladorAdministracion {
  constructor(
    private readonly usuarios: ServicioUsuarios,
    private readonly autenticacion: ServicioAutenticacion,
    private readonly auditoria: ServicioAuditoria
  ) {}

  // Actividad 7: contención de un incidente. Revoca todas las sesiones (JWT) de la cuenta y, si se pide, la bloquea.
  @Post('contencion')
  @HttpCode(200)
  @Permiso('sesiones.revocar')
  async contencion(
    @SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente,
    @Body() datos: { cuenta?: string; usuarioId?: unknown; motivo?: unknown; alertaId?: unknown; bloquear?: unknown }
  ) {
    const cuenta = datos?.cuenta ?? 'usuario';
    if (cuenta !== 'usuario' && cuenta !== 'administrador_riesgo') throw new BadRequestException('cuenta no es válida');
    const id = Number(datos?.usuarioId);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('usuarioId es obligatorio');
    if (typeof datos.motivo !== 'string' || datos.motivo.trim().length < 10) throw new BadRequestException('motivo es obligatorio (al menos 10 caracteres)');
    const alertaId = datos.alertaId === undefined ? undefined : Number(datos.alertaId);
    if (alertaId !== undefined && !Number.isInteger(alertaId)) throw new BadRequestException('alertaId debe ser un entero');
    if (cuenta === 'usuario' && id === sesion.id) throw new BadRequestException('no puedes aplicar una contención a tu propia cuenta');
    const revocacion = await this.autenticacion.revocarSesiones(cuenta, id, datos.motivo.trim(), alertaId);
    const bloqueada = datos.bloquear === true;
    if (bloqueada) await this.usuarios.establecerBloqueo(sesion, cuenta, id, true);
    await this.auditoria.intentarRegistrar({
      actor: sesion, accion: 'incidente.contencion', resultado: 'exito', contexto, recurso: `${cuenta}:${id}`,
      detalle: { alertaId: alertaId ?? null, bloqueada, motivo: datos.motivo.trim().slice(0, 200) }
    });
    return { cuenta, usuarioId: String(id), sesionesRevocadasEn: revocacion.revocadaEn, bloqueada };
  }

  @Post('cuentas')
  @Permiso('cuenta.crear')
  crearCuenta(@Body() datos: DatosNuevaCuenta, @ContextoActual() contexto: ContextoCliente) {
    if (!esRol(datos?.rol)) throw new BadRequestException('rol es obligatorio');
    return this.usuarios.crearCuentaPersonal(datos.rol, datos as DatosCuenta, contexto);
  }

  @Patch('usuarios/:id/rol')
  @Permiso('roles.gestionar')
  cambiarRol(@SesionActual() sesion: Sesion, @Param('id', ParseIntPipe) id: number, @Body() datos: { rol?: Rol }) {
    if (!esRol(datos?.rol)) throw new BadRequestException('rol es obligatorio');
    return this.usuarios.cambiarRol(sesion, id, datos.rol);
  }

  @Post('cuentas/:id/contrasena')
  @Permiso('cuenta.crear')
  restablecerContrasena(@Param('id', ParseIntPipe) id: number, @Body() datos: DatosContrasena) {
    const cuenta = datos?.cuenta ?? 'usuario';
    if (cuenta !== 'usuario' && cuenta !== 'administrador_riesgo') throw new BadRequestException('cuenta no es válida');
    return this.usuarios.restablecerContrasena(cuenta, id, datos?.contrasena as string);
  }
}
