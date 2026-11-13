import { BadRequestException, Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { ContextoActual, SesionActual, SinConsentimiento, SoloAutenticado } from '../autorizacion/decoradores';
import type { Sesion } from '../autorizacion/roles';
import { Publica } from './publico.decorador';
import { ServicioAutenticacion } from './servicio-autenticacion';

interface DatosLogin { correo: string; contrasena: string; }

@Controller('auth')
export class ControladorAutenticacion {
  constructor(private readonly servicio: ServicioAutenticacion) {}

  @Publica()
  @Post('login')
  @HttpCode(200)
  login(@Body() datos: DatosLogin, @ContextoActual() contexto: ContextoCliente) {
    if (typeof datos?.correo !== 'string' || !datos.correo.trim() || typeof datos.contrasena !== 'string' || !datos.contrasena) {
      throw new BadRequestException('correo y contrasena son obligatorios');
    }
    return this.servicio.iniciarSesion(datos.correo, datos.contrasena, contexto);
  }

  // Alerta A3 (Actividad 7): tras un login desde un dispositivo nuevo, el titular confirma su contraseña antes de una
  // operación sensible. El interceptor registra el resultado como "auth.verificacion_adicional".
  @Post('verificacion-adicional')
  @HttpCode(200)
  @SoloAutenticado('auth.verificacion_adicional')
  @SinConsentimiento()
  async verificacionAdicional(@SesionActual() sesion: Sesion, @Body() datos: { contrasena?: unknown }) {
    const valida = typeof datos?.contrasena === 'string' && await this.servicio.verificarContrasena(sesion, datos.contrasena);
    if (!valida) throw new UnauthorizedException('no pudimos verificar tu identidad: revisa la contraseña');
    return { verificado: true, mensaje: 'Identidad confirmada: ya puedes realizar operaciones sensibles en esta sesión.' };
  }
}
