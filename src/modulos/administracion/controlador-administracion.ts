import { BadRequestException, Body, Controller, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
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
  constructor(private readonly usuarios: ServicioUsuarios) {}

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
