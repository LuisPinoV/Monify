import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { BaseDatos } from '../../base-datos';
import { Publica } from '../autenticacion/publico.decorador';
import { ContextoActual, Permiso, SesionActual, SinConsentimiento } from '../autorizacion/decoradores';
import type { Sesion } from '../autorizacion/roles';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { TEXTOS_NO_REPUDIO, VERSION_TEXTOS_CONFIRMACION } from '../auditoria/servicio-no-repudio';
import { ServicioConsentimientos, type AceptacionFinalidades } from './servicio-consentimientos';
import { CAMPO_ACEPTACION, TERMINOS, type Finalidad } from './terminos';

interface DatosRevocacion {
  confirmacionNoRepudio?: unknown;
}

@Controller()
export class ControladorTerminos {
  constructor(
    private readonly consentimientos: ServicioConsentimientos,
    private readonly baseDatos: BaseDatos
  ) {}

  @Get('terminos')
  @Publica()
  terminos() {
    // Se publican también los textos exactos de las casillas de no repudio, para mostrarlos antes de confirmar.
    return { ...TERMINOS, confirmaciones: { version: VERSION_TEXTOS_CONFIRMACION, textos: TEXTOS_NO_REPUDIO } };
  }

  // Catálogo de finalidades (tabla "Finalidad"): cada una se acepta con su propia casilla.
  @Get('finalidades')
  @Publica()
  async finalidades() {
    const resultado = await this.baseDatos.consultar<{ idFinalidad: number; nombreFinalidad: Finalidad; descripcion: string }>(
      'SELECT "idFinalidad", "nombreFinalidad", "descripcion" FROM "Finalidad" ORDER BY "idFinalidad"'
    );
    return resultado.rows.map((fila) => ({
      id: String(fila.idFinalidad), finalidad: fila.nombreFinalidad, descripcion: fila.descripcion,
      campo: CAMPO_ACEPTACION[fila.nombreFinalidad], obligatoria: true
    }));
  }

  @Get('consentimientos')
  @Permiso('consentimiento.gestionar')
  @SinConsentimiento()
  estado(@SesionActual() sesion: Sesion) {
    return this.consentimientos.estado(sesion.id);
  }

  @Get('consentimientos/historial')
  @Permiso('consentimiento.gestionar')
  @SinConsentimiento()
  historial(@SesionActual() sesion: Sesion) {
    return this.consentimientos.historial(sesion.id);
  }

  @Post('consentimientos/otorgar')
  @Permiso('consentimiento.gestionar')
  @SinConsentimiento()
  otorgar(@SesionActual() sesion: Sesion, @Body() datos: AceptacionFinalidades, @ContextoActual() contexto: ContextoCliente) {
    return this.consentimientos.otorgarPendientes(sesion, datos ?? {}, contexto);
  }

  @Post('consentimientos/rechazar')
  @HttpCode(200)
  @Permiso('consentimiento.gestionar')
  @SinConsentimiento()
  rechazar(@SesionActual() sesion: Sesion, @ContextoActual() contexto: ContextoCliente) {
    return this.consentimientos.rechazar(sesion, contexto);
  }

  @Post('consentimientos/:finalidad/revocar')
  @HttpCode(200)
  @Permiso('consentimiento.gestionar')
  @SinConsentimiento()
  revocar(
    @SesionActual() sesion: Sesion, @Param('finalidad') finalidad: string, @Body() datos: DatosRevocacion, @ContextoActual() contexto: ContextoCliente
  ) {
    return this.consentimientos.revocar(sesion, finalidad, datos?.confirmacionNoRepudio, contexto);
  }
}
