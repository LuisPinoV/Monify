import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { randomInt } from 'node:crypto';
import { BaseDatos } from './base-datos';
import { ServicioUsuarios } from './modulos/usuarios/servicio-usuarios';
import { ServicioBilleteras } from './modulos/billeteras/servicio-billeteras';
import { ServicioOperacionesFinancieras } from './modulos/operaciones-financieras/servicio-operaciones-financieras';
import { ServicioAuditoria } from './modulos/auditoria/servicio-auditoria';
import { VERSION_TERMINOS } from './modulos/terminos/terminos';
import type { Rol, Sesion } from './modulos/autorizacion/roles';
import { urlBoveda } from './seguridad/servicio-seudonimos';
import type { ContextoCliente } from './utilidades/contexto-cliente';
import { ModuloPrincipal } from './servidor';

/**
 * Datos de desarrollo (Actividad 4, parte 2): la base de desarrollo se llena con datos ALEATORIOS, nunca reales.
 * Todo se crea a través de los servicios de la aplicación, de modo que pasa por la misma seudonimización,
 * minimización, cifrado, consentimientos, evidencias de no repudio y bitácora que en producción.
 */
const CONTRASENA_DESARROLLO = process.env.SEED_CONTRASENA || 'Monify2026!';
const CANTIDAD_TITULARES = Number(process.env.SEED_TITULARES || 12);
const CONTEXTO: ContextoCliente = { canal: 'api', dispositivo: 'semilla-desarrollo' };

const NOMBRES = ['Camila', 'Benjamín', 'Valentina', 'Matías', 'Isidora', 'Vicente', 'Florencia', 'Agustín', 'Antonia', 'Tomás', 'Josefa', 'Martín'];
const APELLIDOS = ['González', 'Muñoz', 'Rojas', 'Díaz', 'Pérez', 'Soto', 'Contreras', 'Silva', 'Morales', 'Sepúlveda', 'Fuentes', 'Torres'];
const TARJETAS_PRUEBA = ['4111111111111111', '5555555555554444', '4012888888881881', '378282246310005', '6011111111111117'];

const elegir = <T>(lista: readonly T[]): T => lista[randomInt(lista.length)];

function rutAleatorio(): string {
  const cuerpo = randomInt(5_000_000, 25_000_000);
  let suma = 0;
  let factor = 2;
  for (const digito of String(cuerpo).split('').reverse()) {
    suma += Number(digito) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  return `${cuerpo}-${resto === 11 ? '0' : resto === 10 ? 'K' : resto}`;
}

function fechaNacimientoAdulta(): string {
  const anio = randomInt(1960, 2005);
  return `${anio}-${String(randomInt(1, 13)).padStart(2, '0')}-${String(randomInt(1, 29)).padStart(2, '0')}`;
}

async function vaciar(baseDatos: BaseDatos): Promise<void> {
  // TRUNCATE no dispara los triggers de fila, así que también vacía las tablas de solo anexado (solo en desarrollo).
  await baseDatos.consultar(`
    TRUNCATE "UsuarioCredito", "SolicitudCredito", "Credito", "Deuda", "Transaccion", "Billetera", "Tarjeta",
             "ConsultaDeRiesgo", "VerificadorDeIdentidad", "AutorizacionAcceso", "HistorialSolicitudDerecho", "SolicitudDerecho", "ConsentLogs", "UserConsent", "UserLogs",
             "EvidenciaNoRepudio", "CredAuthUser", "CredAuthAdministrador", "Usuario", "AdministradorRiesgo"
    RESTART IDENTITY CASCADE
  `);
  const boveda = new Pool({ connectionString: urlBoveda(), max: 1 });
  try {
    await boveda.query('TRUNCATE "BovedaSeudonimos"');
  } finally {
    await boveda.end();
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(ModuloPrincipal, { logger: ['error', 'warn'] });
  try {
    // Se revisa después de crear el contexto, cuando ConfigModule ya cargó el .env.
    const entorno = process.env.ENTORNO ?? 'desarrollo';
    if (entorno !== 'desarrollo') throw new Error(`la semilla solo se ejecuta con ENTORNO=desarrollo (actual: ${entorno})`);
    const baseDatos = app.get(BaseDatos);
    const usuarios = app.get(ServicioUsuarios);
    const billeteras = app.get(ServicioBilleteras);
    const operaciones = app.get(ServicioOperacionesFinancieras);
    const auditoria = app.get(ServicioAuditoria);

    await vaciar(baseDatos);
    const credenciales: Array<{ rol: Rol; correo: string }> = [];

    const personal: Rol[] = ['admin', 'administrador_riesgo', 'auditor', 'operador_financiero'];
    const ids: Partial<Record<Rol, number>> = {};
    for (const rol of personal) {
      const correo = `${rol.replace(/_/g, '.')}@monify.dev`;
      const cuenta = await usuarios.crearCuentaPersonal(rol, {
        nombre: `${elegir(NOMBRES)} ${elegir(APELLIDOS)}`, rut: rutAleatorio(), correo, contrasena: CONTRASENA_DESARROLLO
      }, CONTEXTO);
      ids[rol] = Number(cuenta.id);
      credenciales.push({ rol, correo });
    }

    const creditos = [];
    for (const [monto, tasa] of [[500_000, 1.9], [1_500_000, 1.6], [3_000_000, 1.4]]) {
      creditos.push(await operaciones.crearCredito(monto, tasa));
    }
    const bancos = await billeteras.listarBancos();

    for (let indice = 0; indice < CANTIDAD_TITULARES; indice += 1) {
      const nombre = elegir(NOMBRES);
      const apellido = elegir(APELLIDOS);
      const correo = `${nombre}.${apellido}${indice + 1}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() + '@ejemplo.dev';
      const perfil = await usuarios.registrar({
        nombre: `${nombre} ${apellido}`, correo, rut: rutAleatorio(), fechaNacimiento: fechaNacimientoAdulta(),
        rentaMensual: randomInt(350_000, 5_000_000), numeroCelular: `+569${randomInt(10_000_000, 99_999_999)}`, contrasena: CONTRASENA_DESARROLLO
      }, { versionTerminos: VERSION_TERMINOS, aceptaTerminos: true, aceptaTratamientoDatos: true, aceptaEvaluacionCrediticia: true }, CONTEXTO);
      if (indice < 2) credenciales.push({ rol: 'usuario', correo });
      const id = Number(perfil.id);
      const sesion: Sesion = { id, cuenta: 'usuario', rol: 'usuario' };

      const tarjeta = await billeteras.agregarTarjeta(id, Number(elegir(bancos).id), elegir(TARJETAS_PRUEBA));
      const abono = randomInt(20, 800) * 1_000;
      await operaciones.crearTransaccion(sesion, { tarjetaId: Number(tarjeta.id), tipo: 'abono', monto: abono }, true, CONTEXTO);
      for (let movimiento = 0; movimiento < randomInt(1, 4); movimiento += 1) {
        await operaciones.crearTransaccion(sesion, { tarjetaId: Number(tarjeta.id), tipo: 'cargo', monto: randomInt(1, Math.floor(abono / 4_000)) * 1_000 }, true, CONTEXTO);
      }

      await operaciones.crearVerificacion({
        usuarioId: id, estado: elegir(['verificada', 'verificada', 'en_revision', 'pendiente'] as const), metodo: 'biometria',
        fechaVerificacion: new Date().toISOString(), comprobante: `kyc-${id}-${randomInt(1e9)}`
      });
      const moroso = randomInt(4) === 0;
      await operaciones.crearConsultaRiesgo({
        usuarioId: id, score: randomInt(300, 900), morosidad: moroso,
        diasMorosidad: moroso ? randomInt(1, 200) : 0, diasEnDeuda: randomInt(0, 400)
      });
      if (moroso) await operaciones.crearDeuda(id, randomInt(50, 900) * 1_000);

      if (indice % 3 === 0) {
        const credito = elegir(creditos);
        const solicitud = await operaciones.crearSolicitud(sesion, { creditoId: Number(credito.id), montoSolicitado: credito.monto }, true, CONTEXTO);
        if (indice % 2 === 0) {
          const revisor: Sesion = { id: ids.administrador_riesgo!, cuenta: 'administrador_riesgo', rol: 'administrador_riesgo' };
          await operaciones.resolverSolicitud(revisor, Number(solicitud.id), moroso ? 'rechazada' : 'aprobada', true, CONTEXTO);
        }
      }
    }

    await auditoria.registrar({ accion: 'semilla.desarrollo', resultado: 'exito', contexto: CONTEXTO, detalle: { titulares: CANTIDAD_TITULARES } });
    console.log(`Semilla de desarrollo cargada: ${personal.length} cuentas del personal y ${CANTIDAD_TITULARES} titulares ficticios.`);
    console.log(`Contraseña de todas las cuentas: ${CONTRASENA_DESARROLLO} (la del administrador de riesgo vence en 24 horas).`);
    console.table(credenciales);
  } finally {
    await app.close();
  }
}

main().catch((error: Error) => {
  console.error(`No se pudo cargar la semilla: ${error.message}`);
  process.exit(1);
});
