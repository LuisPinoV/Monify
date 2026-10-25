import { Injectable, Logger } from '@nestjs/common';
import { BaseDatos } from '../../base-datos';
import type { ContextoCliente } from '../../utilidades/contexto-cliente';
import { ServicioAuditoria } from '../auditoria/servicio-auditoria';
import { CODIGO_ROL } from '../autorizacion/roles';
import { ServicioUsuarios } from '../usuarios/servicio-usuarios';

const CONTEXTO_ARRANQUE: ContextoCliente = { canal: 'api', dispositivo: 'arranque-servidor' };

/**
 * El autoregistro solo crea titulares y las cuentas del personal las crea un Admin, así que el primer
 * Admin se crea al iniciar el servidor a partir de variables de entorno (solo si todavía no existe ninguno).
 * Tras crearlo conviene borrar ADMIN_INICIAL_CONTRASENA del .env.
 */
@Injectable()
export class ServicioAdminInicial {
  private readonly logger = new Logger(ServicioAdminInicial.name);

  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly usuarios: ServicioUsuarios,
    private readonly auditoria: ServicioAuditoria
  ) {}

  async asegurar(entorno: NodeJS.ProcessEnv = process.env): Promise<void> {
    const existe = await this.baseDatos.consultar(`
      SELECT 1 FROM "Usuario" u JOIN "Rol" r ON r."idRol" = u."idRol"
      WHERE r."codigoRol" = $1 AND u."estadoCuenta" = 'activa' LIMIT 1
    `, [CODIGO_ROL.admin]);
    if ((existe.rowCount ?? 0) > 0) return;

    const correo = entorno.ADMIN_INICIAL_CORREO;
    const contrasena = entorno.ADMIN_INICIAL_CONTRASENA;
    if (!correo || !contrasena) {
      this.logger.warn('No existe ningún Admin. Define ADMIN_INICIAL_CORREO y ADMIN_INICIAL_CONTRASENA en .env para crearlo al iniciar.');
      return;
    }
    const cuenta = await this.usuarios.crearCuentaPersonal('admin', {
      nombre: entorno.ADMIN_INICIAL_NOMBRE || 'Administrador Monify',
      rut: entorno.ADMIN_INICIAL_RUT || '11111111-1',
      correo,
      contrasena
    }, CONTEXTO_ARRANQUE);
    await this.auditoria.intentarRegistrar({
      actor: { id: Number(cuenta.id), cuenta: 'usuario' }, accion: 'cuenta.crear_admin_inicial', resultado: 'exito', contexto: CONTEXTO_ARRANQUE
    });
    this.logger.log(`Admin inicial creado (id ${cuenta.id}). Elimina ADMIN_INICIAL_CONTRASENA del .env.`);
  }
}
