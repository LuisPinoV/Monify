// Prueba de humo end-to-end contra un servidor en ejecución (no usar contra producción).
// Uso: BASE_URL=http://localhost:3000 ADMIN_CORREO=... ADMIN_CONTRASENA=... node scripts/prueba-humo.js
const assert = require('node:assert/strict');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN = { correo: process.env.ADMIN_CORREO ?? process.env.ADMIN_INICIAL_CORREO, contrasena: process.env.ADMIN_CONTRASENA ?? process.env.ADMIN_INICIAL_CONTRASENA };
const sufijo = Date.now().toString().slice(-7);

async function api(metodo, ruta, { token, cuerpo, motivo } = {}) {
  const respuesta = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'content-type': 'application/json', 'x-canal': 'api', 'x-dispositivo': 'prueba-humo',
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(motivo ? { 'x-motivo-acceso': motivo } : {})
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, datos: texto ? JSON.parse(texto) : null };
}

async function login(correo, contrasena) {
  const r = await api('POST', '/auth/login', { cuerpo: { correo, contrasena } });
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  return r.datos;
}

function paso(nombre) { console.log(`✓ ${nombre}`); }

// Solicitud de derechos completa: recepción + verificación de identidad (contraseña y, si corresponde, código de desarrollo).
async function ejercerDerecho(token, cuerpo, contrasena) {
  const creada = await api('POST', '/derechos/solicitudes', { token, cuerpo });
  assert.equal(creada.estado, 201, JSON.stringify(creada.datos));
  const r = await api('POST', `/derechos/solicitudes/${creada.datos.solicitud.id}/verificar`, {
    token, cuerpo: { contrasena, codigo: creada.datos.verificacion.codigoDesarrollo }
  });
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  return r.datos.solicitud;
}

(async () => {
  assert.ok(ADMIN.correo && ADMIN.contrasena, 'define ADMIN_CORREO y ADMIN_CONTRASENA');
  const { version } = (await api('GET', '/terminos')).datos;

  const correo = `titular${sufijo}@correo.cl`;
  const datos = { nombre: 'Titular de Prueba', correo, rut: `${sufijo}-K`, fechaNacimiento: '1990-05-10', rentaMensual: 850000, numeroCelular: '+56911112222', contrasena: 'ClaveTitular1' };
  let r = await api('POST', '/usuarios', { cuerpo: datos });
  assert.equal(r.estado, 400, 'el registro sin aceptar el TOS debe fallar');
  r = await api('POST', '/usuarios', { cuerpo: { ...datos, versionTerminos: version, aceptaTerminos: true, aceptaTratamientoDatos: true, aceptaEvaluacionCrediticia: true } });
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.tramoRenta, 'T2');
  paso('registro exige TOS; renta guardada como tramo');

  const titular = await login(correo, datos.contrasena);
  const t = titular.accessToken;
  assert.equal(titular.requiereConsentimiento, false);

  const bancos = (await api('GET', '/bancos', { token: t })).datos;
  const tarjeta = (await api('POST', '/tarjetas', { token: t, cuerpo: { bancoId: bancos[0].id, numeroTarjeta: '4111111111111111' } })).datos;
  assert.equal(tarjeta.numeroEnmascarado, '•••• 1111');
  r = await api('POST', '/transacciones', { token: t, cuerpo: { tarjetaId: tarjeta.id, tipo: 'abono', monto: 5000 } });
  assert.equal(r.estado, 400, 'sin casilla de no repudio debe fallar');
  r = await api('POST', '/transacciones', { token: t, cuerpo: { tarjetaId: tarjeta.id, tipo: 'abono', monto: 5000, confirmacionNoRepudio: true } });
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  assert.ok(r.datos.evidenciaId);
  paso('transacción exige casilla de no repudio y guarda evidencia');

  let solicitud = await ejercerDerecho(t, { tipo: 'supresion', confirmacionNoRepudio: true }, datos.contrasena);
  assert.equal(solicitud.resultado, 'rechazada', 'no se puede suprimir la cuenta con saldo');
  assert.match(solicitud.respuesta, /saldo/);
  paso('supresión rechazada con respuesta fundamentada mientras el saldo no sea $0');

  const admin = (await login(ADMIN.correo, ADMIN.contrasena)).accessToken;
  r = await api('GET', '/billeteras', { token: admin });
  assert.equal(r.estado, 403, 'el Admin no ve billeteras');
  const auditorCorreo = `auditor${sufijo}@monify.cl`;
  r = await api('POST', '/admin/cuentas', { token: admin, cuerpo: { rol: 'auditor', nombre: 'Auditor Prueba', correo: auditorCorreo, rut: `${sufijo}-1`, contrasena: 'ClaveAuditor1' } });
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  assert.match(r.datos.nombre, /^[A-Za-z]+-[A-Za-z]+-[0-9a-f]{6}$/, 'el personal ve seudónimos');
  r = await api('GET', '/auditoria/logs', { token: admin });
  assert.equal(r.estado, 403, 'el Admin necesita autorización de un auditor para ver logs');
  paso('RBAC: Admin sin acceso a billeteras ni logs; ve solo seudónimos');

  const auditor = (await login(auditorCorreo, 'ClaveAuditor1')).accessToken;
  r = await api('GET', '/auditoria/logs?limite=20', { token: auditor });
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  assert.ok(r.datos.some((log) => log.accion === 'transaccion.crear' && log.canal === 'api' && log.dispositivo === 'prueba-humo'));
  r = await api('GET', '/auditoria/integridad', { token: auditor });
  assert.equal(r.datos.valida, true);
  r = await api('GET', '/auditoria/evidencias', { token: auditor });
  assert.ok(r.datos.length > 0 && r.datos.every((e) => e.firmaValida));
  r = await api('GET', '/transacciones', { token: auditor });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.length, 0, 'sin autorización expresa el auditor no ve movimientos');
  paso('auditoría: bitácora con canal/dispositivo, cadena íntegra y firmas válidas');

  r = await api('POST', '/transacciones', { token: t, cuerpo: { tarjetaId: tarjeta.id, tipo: 'cargo', monto: 5000, confirmacionNoRepudio: true } });
  assert.equal(r.estado, 201);
  solicitud = await ejercerDerecho(t, { tipo: 'acceso' }, datos.contrasena);
  assert.equal(solicitud.estado, 'ejecutada');
  r = await api('GET', `/derechos/solicitudes/${solicitud.id}/descarga`, { token: t });
  assert.equal(r.datos.datos.titular.correo, correo);
  assert.ok(r.datos.datos.transacciones.length === 2);
  paso('acceso y portabilidad: copia JSON de los datos propios tras verificar la identidad');

  solicitud = await ejercerDerecho(t, { tipo: 'supresion', confirmacionNoRepudio: true }, datos.contrasena);
  assert.equal(solicitud.resultado, 'ejecutada', JSON.stringify(solicitud));
  r = await api('POST', '/auth/login', { cuerpo: { correo, contrasena: datos.contrasena } });
  assert.equal(r.estado, 401);
  paso('cuenta eliminada con saldo $0 y datos anonimizados');

  console.log('\nPrueba de humo completa.');
})().catch((error) => { console.error('✗', error.message); process.exit(1); });
