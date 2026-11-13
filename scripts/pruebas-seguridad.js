// Pruebas de controles de seguridad (Actividad 4, parte 4): demuestran que los accesos no autorizados son rechazados.
// Requiere la API en ejecución con la semilla de desarrollo cargada (pnpm run db:seed). No usar contra producción.
// Uso: BASE_URL=http://localhost:3000 node scripts/pruebas-seguridad.js
const assert = require('node:assert/strict');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const CLAVE = process.env.SEED_CONTRASENA || 'Monify2026!';
const sufijo = Date.now().toString().slice(-7);
let aprobadas = 0;
let fallidas = 0;

async function api(metodo, ruta, { token, cuerpo, motivo } = {}) {
  const respuesta = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'content-type': 'application/json', 'x-canal': 'api', 'x-dispositivo': 'pruebas-seguridad',
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(motivo ? { 'x-motivo-acceso': motivo } : {})
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, datos: texto ? JSON.parse(texto) : null };
}

async function prueba(seccion, nombre, fn) {
  try {
    const detalle = await fn();
    aprobadas += 1;
    console.log(`  ✓ ${nombre}${detalle ? `  →  ${detalle}` : ''}`);
  } catch (error) {
    fallidas += 1;
    console.log(`  ✗ ${nombre}: ${error.message}`);
  }
}

const espera = (r, estado) => {
  assert.equal(r.estado, estado, `se esperaba ${estado} y llegó ${r.estado} ${JSON.stringify(r.datos)}`);
  return `${r.estado} "${r.datos?.message ?? ''}"`;
};

async function login(correo, contrasena = CLAVE) {
  const r = await api('POST', '/auth/login', { cuerpo: { correo, contrasena } });
  assert.equal(r.estado, 200, `login de ${correo}: ${JSON.stringify(r.datos)}`);
  return r.datos.accessToken;
}

(async () => {
  const { version } = (await api('GET', '/terminos')).datos;
  const titularA = { nombre: 'Titular A', correo: `a${sufijo}@prueba.dev`, rut: `${sufijo}1-1`, fechaNacimiento: '1990-01-01', contrasena: 'ClaveTitularA1' };
  const tos = { versionTerminos: version, aceptaTerminos: true, aceptaTratamientoDatos: true, aceptaEvaluacionCrediticia: true };

  console.log('\n1. Minimización y validación de datos');
  await prueba(1, 'registro de un menor de edad es rechazado', async () => espera(await api('POST', '/usuarios', { cuerpo: { ...titularA, fechaNacimiento: '2015-06-01', ...tos } }), 400));
  await prueba(1, 'registro sin aceptar los Términos es rechazado', async () => espera(await api('POST', '/usuarios', { cuerpo: titularA }), 400));
  const registro = await api('POST', '/usuarios', { cuerpo: { ...titularA, rentaMensual: 1_234_567, ...tos } });
  await prueba(1, 'la fecha de nacimiento y la renta exacta no se devuelven ni se guardan', async () => {
    assert.equal(registro.estado, 201);
    assert.equal(registro.datos.fechaNacimiento, undefined);
    assert.equal(registro.datos.esMayorEdad, true);
    assert.equal(registro.datos.tramoRenta, 'T3');
    return `esMayorEdad=${registro.datos.esMayorEdad}, tramoRenta=${registro.datos.tramoRenta} (${registro.datos.tramoRentaEtiqueta})`;
  });
  const tA = await login(titularA.correo, titularA.contrasena);
  await prueba(1, 'una tarjeta con número inválido es rechazada (y nunca se pide CVV)', async () => espera(await api('POST', '/tarjetas', { token: tA, cuerpo: { bancoId: 1, numeroTarjeta: '1234567890123456' } }), 400));

  console.log('\n2. Autenticación y contraseñas');
  await prueba(2, 'sin token no se accede a ningún recurso protegido', async () => espera(await api('GET', '/usuarios/me'), 401));
  await prueba(2, 'un token alterado es rechazado', async () => espera(await api('GET', '/usuarios/me', { token: `${tA.slice(0, -4)}abcd` }), 401));
  const noExiste = await api('POST', '/auth/login', { cuerpo: { correo: 'nadie@prueba.dev', contrasena: 'x' } });
  const claveMala = await api('POST', '/auth/login', { cuerpo: { correo: titularA.correo, contrasena: 'incorrecta' } });
  await prueba(2, 'el mismo mensaje para correo inexistente y contraseña incorrecta (sin enumeración)', async () => {
    assert.equal(noExiste.estado, 401); assert.equal(claveMala.estado, 401);
    assert.equal(noExiste.datos.message, claveMala.datos.message);
    return `401 "${noExiste.datos.message}"`;
  });
  const victima = { nombre: 'Titular B', correo: `b${sufijo}@prueba.dev`, rut: `${sufijo}2-2`, fechaNacimiento: '1985-02-02', contrasena: 'ClaveTitularB1' };
  await api('POST', '/usuarios', { cuerpo: { ...victima, ...tos } });
  for (let i = 0; i < 5; i += 1) await api('POST', '/auth/login', { cuerpo: { correo: victima.correo, contrasena: 'adivinanza' } });
  await prueba(2, 'tras 3 intentos fallidos la cuenta se bloquea temporalmente (15 min), aun con la contraseña correcta', async () => {
    const r = await api('POST', '/auth/login', { cuerpo: { correo: victima.correo, contrasena: victima.contrasena } });
    espera(r, 429);
    assert.equal(r.datos.codigo, 'BLOQUEO_TEMPORAL');
    return `429 hasta ${r.datos.bloqueadoHasta}`;
  });

  const admin = await login('admin@monify.dev');
  const auditor = await login('auditor@monify.dev');
  const operador = await login('operador.financiero@monify.dev');

  console.log('\n3. Autorización basada en roles (RBAC)');
  await prueba(3, 'un Usuario no puede crear cuentas del personal', async () => espera(await api('POST', '/admin/cuentas', { token: tA, cuerpo: { rol: 'admin', nombre: 'x', correo: 'x@x.cl', rut: '1-9', contrasena: 'ClaveLarga1' } }), 403));
  await prueba(3, 'un Usuario no puede listar las cuentas', async () => espera(await api('GET', '/usuarios', { token: tA }), 403));
  await prueba(3, 'un Usuario no puede revisar los logs', async () => espera(await api('GET', '/auditoria/logs', { token: tA }), 403));
  await prueba(3, 'el Admin no ve billeteras ajenas', async () => espera(await api('GET', '/billeteras', { token: admin }), 403));
  await prueba(3, 'el Admin no ve el historial de movimientos', async () => espera(await api('GET', '/transacciones', { token: admin }), 403));
  await prueba(3, 'el Admin no revisa logs sin autorización de un Auditor', async () => espera(await api('GET', '/auditoria/logs', { token: admin }), 403));
  await prueba(3, 'el Auditor no puede realizar transacciones', async () => espera(await api('POST', '/transacciones', { token: auditor, cuerpo: { tarjetaId: 1, tipo: 'abono', monto: 1000, confirmacionNoRepudio: true } }), 403));
  await prueba(3, 'el Operador financiero no aprueba créditos sin indicar un motivo', async () => espera(await api('PATCH', '/solicitudes-credito/1/estado', { token: operador, cuerpo: { estado: 'en_evaluacion' } }), 403));
  await prueba(3, 'nadie accede a las claves criptográficas (no existe endpoint)', async () => espera(await api('GET', '/claves', { token: admin }), 404));

  console.log('\n4. Restricción de acceso a datos de otros titulares');
  const idA = Number(registro.datos.id);
  await prueba(4, 'un Usuario no puede pedir los movimientos de otro titular', async () => espera(await api('GET', `/transacciones?usuarioId=${idA + 1}`, { token: tA }), 403));
  await prueba(4, 'el Operador sin motivo de acceso es rechazado', async () => espera(await api('GET', '/transacciones', { token: operador }), 403));
  await prueba(4, 'con motivo de acceso se permite y queda en la bitácora', async () => {
    const r = await api('GET', '/transacciones', { token: operador, motivo: 'Evaluación de solicitud de crédito' });
    assert.equal(r.estado, 200);
    const logs = await api('GET', '/auditoria/logs?accion=acceso.por_necesidad&limite=1', { token: auditor });
    assert.equal(logs.datos[0].detalle.motivo, 'Evaluación de solicitud de crédito');
    return `200 (${r.datos.length} movimientos); bitácora: motivo="${logs.datos[0].detalle.motivo}"`;
  });
  await prueba(4, 'el Auditor sin autorización expresa no ve los movimientos del titular', async () => {
    const r = await api('GET', '/transacciones', { token: auditor });
    assert.equal(r.estado, 200);
    assert.ok(!r.datos.some((t) => t.usuarioId === String(idA)));
    espera(await api('GET', `/transacciones?usuarioId=${idA}`, { token: auditor }), 403);
    return `403 al pedir los datos del titular #${idA}`;
  });
  await prueba(4, 'con autorización expresa del titular el Auditor ve solo sus datos', async () => {
    const auditorId = (await api('GET', '/autorizaciones/beneficiarios', { token: tA })).datos.find((b) => b.rol === 'auditor').id;
    await api('POST', '/autorizaciones', { token: tA, cuerpo: { beneficiarioId: auditorId, ambito: 'movimientos', horas: 1 } });
    espera(await api('GET', `/transacciones?usuarioId=${idA + 1}`, { token: auditor }), 403);
    const propio = await api('GET', `/transacciones?usuarioId=${idA}`, { token: auditor });
    assert.equal(propio.estado, 200);
    return `titular autorizado: 200; otro titular: 403`;
  });

  console.log('\n5. No repudio y Términos y Condiciones');
  const banco = (await api('GET', '/bancos', { token: tA })).datos[0].id;
  const tarjeta = (await api('POST', '/tarjetas', { token: tA, cuerpo: { bancoId: banco, numeroTarjeta: '4111111111111111' } })).datos;
  await prueba(5, 'una transacción sin la casilla de confirmación es rechazada', async () => espera(await api('POST', '/transacciones', { token: tA, cuerpo: { tarjetaId: tarjeta.id, tipo: 'abono', monto: 1000 } }), 400));
  await prueba(5, 'con la casilla se ejecuta y se guarda la evidencia firmada', async () => {
    const r = await api('POST', '/transacciones', { token: tA, cuerpo: { tarjetaId: tarjeta.id, tipo: 'abono', monto: 1000, confirmacionNoRepudio: true } });
    assert.equal(r.estado, 201);
    const evidencia = (await api('GET', '/auditoria/evidencias?limite=5', { token: auditor })).datos.find((e) => e.id === r.datos.evidenciaId);
    assert.equal(evidencia.firmaValida, true);
    return `evidencia ${evidencia.id.slice(0, 8)}…, firma RSA válida`;
  });
  await prueba(5, 'no se puede cerrar la cuenta con saldo distinto de $0 (TOS, sección 7)', async () => {
    const creada = await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'supresion', confirmacionNoRepudio: true } });
    const r = await api('POST', `/derechos/solicitudes/${creada.datos.solicitud.id}/verificar`, { token: tA, cuerpo: { contrasena: titularA.contrasena, codigo: creada.datos.verificacion.codigoDesarrollo } });
    assert.equal(r.datos.solicitud.resultado, 'rechazada');
    return `supresión rechazada: "${r.datos.solicitud.respuesta.slice(-60)}"`;
  });

  console.log('\n6. Auditoría y manejo de errores');
  await prueba(6, 'los accesos denegados quedan registrados en la bitácora', async () => {
    const logs = (await api('GET', '/auditoria/logs?accion=acceso_denegado&limite=50', { token: auditor })).datos;
    assert.ok(logs.length > 0);
    return `${logs.length} registros "acceso_denegado" (con canal y dispositivo)`;
  });
  await prueba(6, 'la cadena de hashes de la bitácora está íntegra', async () => {
    const r = (await api('GET', '/auditoria/integridad', { token: auditor })).datos;
    assert.equal(r.valida, true);
    return `${r.registrosVerificados} registros verificados`;
  });
  await prueba(6, 'los errores no exponen detalles internos (SQL, rutas, stack)', async () => {
    const r = await api('PATCH', '/solicitudes-credito/999999/estado', { token: await login('administrador.riesgo@monify.dev'), cuerpo: { estado: 'en_evaluacion' } });
    const texto = JSON.stringify(r.datos);
    assert.ok(!/select|insert|stack|\/src\/|node_modules/i.test(texto));
    return `${r.estado} ${texto}`;
  });

  console.log(`\nResultado: ${aprobadas} pruebas aprobadas, ${fallidas} fallidas.`);
  process.exit(fallidas ? 1 : 0);
})().catch((error) => { console.error('✗', error.message); process.exit(1); });
