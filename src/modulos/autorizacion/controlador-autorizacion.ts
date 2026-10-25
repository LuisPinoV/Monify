import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Permiso, SesionActual, SoloAutenticado } from './decoradores';
import { ACCIONES, AMBITO_POR_ACCION, MATRIZ_PERMISOS, reglaPara, type AmbitoAutorizacion } from './permisos';
import { ROLES, type Sesion } from './roles';
import { ServicioAutorizaciones } from './servicio-autorizaciones';

interface DatosAutorizacion {
  beneficiarioId: string | number;
  ambito: AmbitoAutorizacion;
  horas?: number;
}

@Controller()
export class ControladorAutorizacion {
  constructor(private readonly autorizaciones: ServicioAutorizaciones) {}

  @Get('rbac/matriz')
  @Permiso('roles.gestionar')
  matriz() {
    return { roles: ROLES, acciones: ACCIONES, matriz: MATRIZ_PERMISOS, ambitos: AMBITO_POR_ACCION };
  }

  // Reglas del rol de la sesión: el frontend las usa para mostrar solo lo que el rol puede hacer (el backend las vuelve a exigir).
  @Get('rbac/mis-permisos')
  @SoloAutenticado('rbac.consultar')
  misPermisos(@SesionActual() sesion: Sesion) {
    return {
      rol: sesion.rol,
      cuenta: sesion.cuenta,
      permisos: Object.fromEntries(ACCIONES.map((accion) => [accion, reglaPara(sesion.rol, accion)]))
    };
  }

  @Get('autorizaciones/beneficiarios')
  @Permiso('autorizacion.gestionar')
  beneficiarios(@SesionActual() sesion: Sesion) {
    return this.autorizaciones.beneficiariosPosibles(sesion);
  }

  @Get('autorizaciones')
  @Permiso('autorizacion.gestionar')
  listar(@SesionActual() sesion: Sesion) {
    return this.autorizaciones.listar(sesion);
  }

  @Post('autorizaciones')
  @Permiso('autorizacion.gestionar')
  otorgar(@SesionActual() sesion: Sesion, @Body() datos: DatosAutorizacion) {
    const beneficiarioId = Number(datos?.beneficiarioId);
    if (!Number.isInteger(beneficiarioId) || beneficiarioId <= 0 || !datos?.ambito) {
      throw new BadRequestException('beneficiarioId y ambito son obligatorios');
    }
    return this.autorizaciones.otorgar(sesion, { beneficiarioId, ambito: datos.ambito, horas: datos.horas });
  }

  @Delete('autorizaciones/:id')
  @Permiso('autorizacion.gestionar')
  revocar(@SesionActual() sesion: Sesion, @Param('id', ParseIntPipe) id: number) {
    return this.autorizaciones.revocar(sesion, id);
  }
}
