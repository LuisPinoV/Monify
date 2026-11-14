const assert = require('node:assert/strict');
const test = require('node:test');
const { Client } = require('pg');

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PUERTO ?? 3000}`;
const credenciales = {
  titular: { correo: process.env.TITULAR_CORREO, contrasena: process.env.TITULAR_CONTRASENA },
  riesgo: { correo: process.env.RIESGO_CORREO ?? 'administrador.riesgo@monify.dev', contrasena: process.env.RIESGO_CONTRASENA },
  auditor: { correo: process.env.AUDITOR_CORREO ?? 'auditor@monify.dev', contrasena: process.env.AUDITOR_CONTRASENA },
  admin: { correo: process.env.ADMIN_CORREO ?? 'admin@monify.dev', contrasena: process.env.ADMIN_CONTRASENA }
};

async function api(metodo, ruta, opciones = {}) {
  const respuesta = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      'x-canal': 'api',
      'x-dispositivo': 'e2e-auditoria',
      ...(opciones.token ? { authorization: `Bearer ${opciones.token}` } : {}),
      ...(opciones.motivo ? { 'x-motivo-acceso': opciones.motivo } : {})
    },
    body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo)
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, datos: texto ? JSON.parse(texto) : null };
}

async function login(cuenta) {
  assert.ok(cuenta.correo && cuenta.contrasena, 'faltan credenciales de prueba');
  const respuesta = await api('POST', '/auth/login', { cuerpo: cuenta });
  assert.equal(respuesta.estado, 200, JSON.stringify(respuesta.datos));
  return respuesta.datos;
}

const entornoDisponible = Boolean(
  process.env.TITULAR_CORREO && process.env.TITULAR_CONTRASENA
    && process.env.RIESGO_CONTRASENA && process.env.AUDITOR_CONTRASENA
    && process.env.ADMIN_CONTRASENA && process.env.DATABASE_URL
);

test('registra lecturas, operaciones y denegaciones sin datos personales legibles', { skip: !entornoDisponible }, async () => {
  const titular = await login(credenciales.titular);
  const auditor = await login(credenciales.auditor);
  const admin = await login(credenciales.admin);
  const riesgo = await login(credenciales.riesgo);

  const logsAntesPerfil = (await api('GET', `/auditoria/logs?usuarioId=${titular.usuario.id}&accion=perfil.ver&limite=100`, { token: auditor.accessToken })).datos;
  const perfil = await api('GET', '/usuarios/me', { token: titular.accessToken });
  assert.equal(perfil.estado, 200);
  const logsDespuesPerfil = (await api('GET', `/auditoria/logs?usuarioId=${titular.usuario.id}&accion=perfil.ver&limite=100`, { token: auditor.accessToken })).datos;
  assert.equal(logsDespuesPerfil.length, logsAntesPerfil.length + 1);

  const logsAntesHistorial = (await api('GET', `/auditoria/logs?usuarioId=${titular.usuario.id}&accion=historial.ver&limite=100`, { token: auditor.accessToken })).datos;
  const historial = await api('GET', '/transacciones', { token: titular.accessToken });
  assert.equal(historial.estado, 200);
  const logsDespuesHistorial = (await api('GET', `/auditoria/logs?usuarioId=${titular.usuario.id}&accion=historial.ver&limite=100`, { token: auditor.accessToken })).datos;
  assert.equal(logsDespuesHistorial.length, logsAntesHistorial.length + 1);

  const logsAntesKyc = (await api('GET', `/auditoria/logs?adminRiesgoId=${riesgo.usuario.id}&accion=kyc.ver&limite=100`, { token: auditor.accessToken })).datos;
  const kyc = await api('GET', '/verificaciones-identidad', { token: riesgo.accessToken, motivo: 'revision KYC de prueba' });
  assert.equal(kyc.estado, 200);
  const logsDespuesKyc = (await api('GET', `/auditoria/logs?adminRiesgoId=${riesgo.usuario.id}&accion=kyc.ver&limite=100`, { token: auditor.accessToken })).datos;
  assert.equal(logsDespuesKyc.length, logsAntesKyc.length + 1);

  const titularLogs = await api('GET', `/auditoria/logs?usuarioId=${titular.usuario.id}&limite=100`, { token: auditor.accessToken });
  assert.equal(titularLogs.estado, 200);
  assert.ok(titularLogs.datos.some((log) => log.accion === 'perfil.ver'));
  assert.ok(titularLogs.datos.some((log) => log.accion === 'historial.ver'));
  assert.ok(titularLogs.datos.every((log) => log.canal && log.dispositivo && log.resultado));
  assert.ok(titularLogs.datos
    .filter((log) => ['perfil.ver', 'historial.ver'].includes(log.accion))
    .every((log) => log.recurso));

  const titularNoPuedeLeer = await api('GET', '/auditoria/logs', { token: titular.accessToken });
  assert.equal(titularNoPuedeLeer.estado, 403);
  const adminSinAutorizacion = await api('GET', '/auditoria/logs', { token: admin.accessToken });
  assert.equal(adminSinAutorizacion.estado, 403);

  const texto = JSON.stringify(titularLogs.datos);
  assert.doesNotMatch(texto, /@/);
  assert.doesNotMatch(texto, /\d{1,2}\.?\d{3}\.?\d{3}-[0-9kK]/);
  assert.doesNotMatch(texto, /\d{13,19}/);

  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL es obligatorio para verificar el detalle cifrado');
  const bd = new Client({ connectionString: process.env.DATABASE_URL });
  await bd.connect();
  try {
    const filas = await bd.query(`
      SELECT "recurso", "detalle", "resultado", "canal", "dispositivo"
      FROM "UserLogs"
      WHERE "idUsuario" = $1 OR "idAdminRiesgo" = $2
      ORDER BY "secuencia" DESC LIMIT 100
    `, [Number(titular.usuario.id), Number(riesgo.usuario.id)]);
    const plano = JSON.stringify(filas.rows);
    assert.doesNotMatch(plano, /@/);
    assert.doesNotMatch(plano, /\d{1,2}\.?\d{3}\.?\d{3}-[0-9kK]/);
    assert.doesNotMatch(plano, /\d{13,19}/);
    assert.ok(filas.rows.some((fila) => fila.resultado === 'denegado'));
    assert.ok(filas.rows.every((fila) => fila.canal && fila.dispositivo));
  } finally {
    await bd.end();
  }
});
