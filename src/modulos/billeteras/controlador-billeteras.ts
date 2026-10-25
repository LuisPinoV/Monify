import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import type { Sesion } from '../autorizacion/roles';
import { Permiso, SesionActual, SoloAutenticado } from '../autorizacion/decoradores';
import { ServicioBilleteras } from './servicio-billeteras';

interface DatosNuevaTarjeta {
  bancoId: string | number;
  numeroTarjeta: string;
}

@Controller()
export class ControladorBilleteras {
  constructor(private readonly servicio: ServicioBilleteras) {}

  @Get('bancos')
  @SoloAutenticado('bancos.listar')
  bancos() {
    return this.servicio.listarBancos();
  }

  // La billetera y sus tarjetas solo las ve su titular (regla "propio").
  @Get('billeteras')
  @Permiso('billetera.ver')
  billetera(@SesionActual() sesion: Sesion) {
    return this.servicio.obtenerBilletera(sesion.id);
  }

  @Post('tarjetas')
  @Permiso('tarjeta.agregar')
  agregarTarjeta(@SesionActual() sesion: Sesion, @Body() datos: DatosNuevaTarjeta) {
    const bancoId = Number(datos?.bancoId);
    if (!Number.isInteger(bancoId) || bancoId <= 0 || typeof datos?.numeroTarjeta !== 'string') {
      throw new BadRequestException('bancoId y numeroTarjeta son obligatorios');
    }
    return this.servicio.agregarTarjeta(sesion.id, bancoId, datos.numeroTarjeta);
  }
}
