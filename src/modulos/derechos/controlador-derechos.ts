import { Body, Controller, Get, Header, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { ContextoActual, Permiso, SesionActual, SinConsentimiento } from '../autorizacion/decoradores';
import type { Sesion } from '../autorizacion/roles';
import { ServicioDerechos, type DatosNuevaSolicitud, type DatosVerificacion } from './servicio-derechos';

/**
 * Ejercicio de derechos del titular. Disponible aunque falte un consentimiento (@SinConsentimiento),
 * pero siempre con sesión, RBAC ("derechos.ejercer": solo el propio titular) y verificación de identidad.
 */
@Controller('derechos')
export class ControladorDerechos {
  constructor(private readonly servicio: ServicioDerechos) {}

  @Get('solicitudes')
  @Permiso('derechos.ejercer')
  @SinConsentimiento()
  listar(@SesionActual() sesion: Sesion) {
    return this.servicio.listar(sesion);
  }

  @Post('solicitudes')
  @Permiso('derechos.ejercer')
  @SinConsentimiento()
  crear(@SesionActual() sesion: Sesion, @Body() datos: DatosNuevaSolicitud, @ContextoActual() contexto: ContextoCliente) {
    return this.servicio.crear(sesion, datos ?? {}, contexto);
  }

  @Post('solicitudes/:id/verificar')
  @HttpCode(200)
  @Permiso('derechos.ejercer')
  @SinConsentimiento()
  verificar(
    @SesionActual() sesion: Sesion, @Param('id', ParseIntPipe) id: number, @Body() datos: DatosVerificacion, @ContextoActual() contexto: ContextoCliente
  ) {
    return this.servicio.verificar(sesion, id, datos ?? {}, contexto);
  }

  @Post('solicitudes/:id/desistir')
  @HttpCode(200)
  @Permiso('derechos.ejercer')
  @SinConsentimiento()
  desistir(@SesionActual() sesion: Sesion, @Param('id', ParseIntPipe) id: number, @ContextoActual() contexto: ContextoCliente) {
    return this.servicio.desistir(sesion, id, contexto);
  }

  // Acceso y portabilidad: copia en JSON estructurado; se entrega una sola vez y la descarga cierra la solicitud.
  @Get('solicitudes/:id/descarga')
  @Permiso('derechos.ejercer')
  @SinConsentimiento()
  @Header('Content-Disposition', 'attachment; filename="monify-mis-datos.json"')
  descargar(@SesionActual() sesion: Sesion, @Param('id', ParseIntPipe) id: number, @ContextoActual() contexto: ContextoCliente) {
    return this.servicio.descargar(sesion, id, contexto);
  }

  // Oposición (Actividad 6): catálogo de tratamientos a los que el titular se puede oponer, sus oposiciones y el levantamiento.
  @Get('tratamientos')
  @Permiso('derechos.ejercer')
  @SinConsentimiento()
  tratamientos() {
    return this.servicio.tratamientosOponibles();
  }

  @Get('oposiciones')
  @Permiso('derechos.ejercer')
  @SinConsentimiento()
  oposiciones(@SesionActual() sesion: Sesion) {
    return this.servicio.listarOposiciones(sesion);
  }

  @Post('oposiciones/:tratamiento/levantar')
  @HttpCode(200)
  @Permiso('derechos.ejercer')
  @SinConsentimiento()
  levantar(
    @SesionActual() sesion: Sesion, @Param('tratamiento') tratamiento: string, @Body() datos: DatosVerificacion, @ContextoActual() contexto: ContextoCliente
  ) {
    return this.servicio.levantarOposicion(sesion, tratamiento, datos ?? {}, contexto);
  }

  // Supervisión de plazos (Admin y Auditor): sin los datos pedidos ni la respuesta, solo estados y fechas.
  @Get('supervision')
  @Permiso('derechos.supervisar')
  supervisar() {
    return this.servicio.supervisar();
  }
}
