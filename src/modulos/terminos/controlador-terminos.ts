import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Publica } from '../autenticacion/publico.decorador';
import { ContextoActual, Permiso, SesionActual } from '../autorizacion/decoradores';
import type { Sesion } from '../autorizacion/roles';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { TEXTOS_NO_REPUDIO, VERSION_TEXTOS_CONFIRMACION } from '../auditoria/servicio-no-repudio';
import { ServicioConsentimientos } from './servicio-consentimientos';
import { TERMINOS } from './terminos';

interface DatosAceptacion {
  versionTerminos?: string;
  aceptaTerminos?: unknown;
  aceptaTratamientoDatos?: unknown;
}

@Controller()
export class ControladorTerminos {
  constructor(private readonly consentimientos: ServicioConsentimientos) {}

  @Get('terminos')
  @Publica()
  terminos() {
    // Se publican también los textos exactos de las casillas de no repudio, para mostrarlos antes de confirmar.
    return { ...TERMINOS, confirmaciones: { version: VERSION_TEXTOS_CONFIRMACION, textos: TEXTOS_NO_REPUDIO } };
  }

  @Get('consentimientos')
  @Permiso('consentimiento.gestionar')
  listar(@SesionActual() sesion: Sesion) {
    return this.consentimientos.listar(sesion.id);
  }

  @Post('consentimientos/terminos')
  @Permiso('consentimiento.gestionar')
  aceptar(@SesionActual() sesion: Sesion, @Body() datos: DatosAceptacion, @ContextoActual() contexto: ContextoCliente) {
    return this.consentimientos.aceptarTerminos(sesion, datos ?? {}, contexto);
  }

  @Post('consentimientos/:id/revocar')
  @Permiso('consentimiento.gestionar')
  revocar(@SesionActual() sesion: Sesion, @Param('id', ParseIntPipe) id: number) {
    return this.consentimientos.revocar(sesion, id);
  }
}
