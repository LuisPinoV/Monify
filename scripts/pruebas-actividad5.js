// Pruebas de la Actividad 5: gestión del consentimiento (parte 1 y 5.1) y ejercicio de derechos (parte 2).
// Demuestran el registro, la consulta y la revocación del consentimiento, el flujo de las solicitudes de derechos
// y que los controles no se pueden eludir con peticiones directas a la API ni a la base de datos.
// Requiere la API en ejecución en ENTORNO=desarrollo (el código de verificación simulado viene en la respuesta).
// Uso: pnpm run prueba:actividad5   (lee PUERTO y DATABASE_URL desde .env; BASE_URL lo sobrescribe)
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Client } = require('pg');

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PUERTO ?? 3000}`;
const sufijo = Date.now().toString().slice(-7);
let aprobadas = 0;
let fallidas = 0;
let omitidas = 0;

async function api(metodo, ruta, { token, cuerpo, canal = 'api' } = {}) {
  const respuesta = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'content-type': 'application/json', 'x-canal': canal, 'x-dispositivo': 'pruebas-actividad5',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, datos: texto ? JSON.parse(texto) : null };
}

async function prueba(nombre, fn) {
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

async function login(correo, contrasena) {
  const r = await api('POST', '/auth/login', { cuerpo: { correo, contrasena } });
  assert.equal(r.estado, 200, `login de ${correo}: ${JSON.stringify(r.datos)}`);
  return r.datos;
}

// Errores de PostgreSQL esperados al intentar saltarse los controles directamente en la base.
async function rechazaEnBd(bd, sql, parametros = []) {
  await bd.query('BEGIN');
  try {
    await bd.query(sql, parametros);
    throw new Error('la base de datos aceptó la operación');
  } catch (error) {
    if (error.message === 'la base de datos aceptó la operación') throw error;
    return error.message.split('\n')[0];
  } finally {
    await bd.query('ROLLBACK');
  }
}

(async () => {
  const { version } = (await api('GET', '/terminos')).datos;
  const todas = { versionTerminos: version, aceptaTerminos: true, aceptaTratamientoDatos: true, aceptaEvaluacionCrediticia: true };
  const titularA = { nombre: 'Ana Titular', correo: `ana${sufijo}@prueba.dev`, rut: `${sufijo}2-2`, fechaNacimiento: '1991-03-04', numeroCelular: '+56912345678', contrasena: 'ClaveAna2026' };
  const titularB = { nombre: 'Bruno Titular', correo: `bruno${sufijo}@prueba.dev`, rut: `${sufijo}3-3`, fechaNacimiento: '1988-07-08', contrasena: 'ClaveBruno2026' };

  console.log('\n1. Registro del consentimiento por finalidad');
  await prueba('el catálogo de finalidades viene de la tabla "Finalidad"', async () => {
    const r = await api('GET', '/finalidades');
    assert.equal(r.estado, 200);
    assert.deepEqual(r.datos.map((f) => f.finalidad), ['terminos_y_condiciones', 'tratamiento_datos_personales', 'evaluacion_crediticia']);
    return r.datos.map((f) => `${f.id}:${f.finalidad}`).join(', ');
  });
  await prueba('no se puede registrar sin aceptar cada finalidad por separado', async () => espera(await api('POST', '/usuarios', {
    cuerpo: { ...titularA, ...todas, aceptaEvaluacionCrediticia: undefined }
  }), 400));
  await prueba('una casilla con un valor distinto de true no cuenta como aceptación', async () => espera(await api('POST', '/usuarios', {
    cuerpo: { ...titularA, ...todas, aceptaTratamientoDatos: 'si' }
  }), 400));
  const registroA = await api('POST', '/usuarios', { cuerpo: { ...titularA, ...todas }, canal: 'web' });
  await api('POST', '/usuarios', { cuerpo: { ...titularB, ...todas } });
  let sesionA = await login(titularA.correo, titularA.contrasena);
  let tA = sesionA.accessToken;
  const tB = (await login(titularB.correo, titularB.contrasena)).accessToken;
  await prueba('al registrarse quedan las 3 finalidades otorgadas, cada una con su registro', async () => {
    assert.equal(registroA.estado, 201);
    const r = await api('GET', '/consentimientos', { token: tA });
    assert.equal(r.datos.completo, true);
    assert.ok(r.datos.finalidades.every((f) => f.estado === 'otorgado' && f.versionTexto === version && f.canal === 'web' && f.otorgadoEl));
    return r.datos.finalidades.map((f) => `${f.finalidad}=${f.estado} (v${f.versionTexto}, ${f.canal})`).join('; ');
  });

  console.log('\n2. Revocación y bloqueo del sistema');
  await prueba('revocar sin marcar la casilla de confirmación es rechazado', async () => espera(await api('POST', '/consentimientos/evaluacion_crediticia/revocar', { token: tA, cuerpo: {} }), 400));
  await prueba('una finalidad inexistente no se puede revocar', async () => espera(await api('POST', '/consentimientos/marketing/revocar', { token: tA, cuerpo: { confirmacionNoRepudio: true } }), 404));
  await prueba('la revocación registra la fecha y hora', async () => {
    const r = await api('POST', '/consentimientos/evaluacion_crediticia/revocar', { token: tA, cuerpo: { confirmacionNoRepudio: true } });
    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    const evaluacion = r.datos.finalidades.find((f) => f.finalidad === 'evaluacion_crediticia');
    assert.equal(evaluacion.estado, 'revocado');
    assert.ok(evaluacion.revocadoEl);
    assert.equal(r.datos.completo, false);
    return `revocado_el = ${evaluacion.revocadoEl}`;
  });
  await prueba('el login avisa que falta un consentimiento (ventana de consentimiento)', async () => {
    sesionA = await login(titularA.correo, titularA.contrasena);
    tA = sesionA.accessToken;
    assert.equal(sesionA.requiereConsentimiento, true);
    assert.deepEqual(sesionA.finalidadesPendientes, ['evaluacion_crediticia']);
    return `requiereConsentimiento=true, pendientes=${sesionA.finalidadesPendientes}`;
  });
  for (const [metodo, ruta, cuerpo] of [['GET', '/usuarios/me'], ['GET', '/billeteras'], ['GET', '/transacciones'], ['POST', '/solicitudes-credito', { creditoId: 1, montoSolicitado: 1000, confirmacionNoRepudio: true }]]) {
    await prueba(`sin consentimiento, ${metodo} ${ruta} es rechazado aunque se llame directo a la API`, async () => {
      const r = await api(metodo, ruta, { token: tA, cuerpo });
      espera(r, 403);
      assert.equal(r.datos.codigo, 'CONSENTIMIENTO_REQUERIDO');
      return `403 ${r.datos.codigo}`;
    });
  }
  await prueba('sin consentimiento, el módulo de derechos sigue disponible', async () => espera(await api('GET', '/derechos/solicitudes', { token: tA }), 200));
  await prueba('rechazar en la ventana de consentimiento queda registrado', async () => {
    const r = await api('POST', '/consentimientos/rechazar', { token: tA });
    assert.equal(r.estado, 200);
    assert.equal(r.datos.registrados, 1);
    return r.datos.mensaje;
  });
  await prueba('volver a otorgar la finalidad devuelve el acceso', async () => {
    const r = await api('POST', '/consentimientos/otorgar', { token: tA, cuerpo: { versionTerminos: version, aceptaEvaluacionCrediticia: true } });
    assert.equal(r.estado, 201, JSON.stringify(r.datos));
    assert.equal(r.datos.completo, true);
    return `completo=true; GET /billeteras → ${(await api('GET', '/billeteras', { token: tA })).estado}`;
  });

  console.log('\n3. Consulta del historial de consentimientos');
  await prueba('el historial muestra cada cambio de estado con fecha, canal y dispositivo', async () => {
    const r = await api('GET', '/consentimientos/historial', { token: tA });
    assert.equal(r.estado, 200);
    const acciones = r.datos.map((e) => `${e.finalidad}:${e.accion}`).reverse();
    assert.deepEqual(acciones.slice(-3), ['evaluacion_crediticia:revocado', 'evaluacion_crediticia:rechazado', 'evaluacion_crediticia:otorgado']);
    assert.equal(acciones.filter((a) => a.endsWith(':otorgado')).length, 4);
    assert.ok(r.datos.every((e) => e.fechaHora && e.canal && e.dispositivo));
    return acciones.join(' → ');
  });
  await prueba('un titular no ve el historial de otro (cada uno ve solo el propio)', async () => {
    const r = await api('GET', '/consentimientos/historial', { token: tB });
    assert.ok(r.datos.every((e) => e.dispositivo !== 'pruebas-actividad5' || e.canal === 'api'));
    assert.equal(r.datos.length, 3);
    return `titular B ve ${r.datos.length} eventos propios`;
  });
  const admin = (await login('admin@monify.dev', process.env.SEED_CONTRASENA || 'Monify2026!')).accessToken;
  const auditor = (await login('auditor@monify.dev', process.env.SEED_CONTRASENA || 'Monify2026!')).accessToken;
  await prueba('el personal no gestiona ni consulta consentimientos de titulares', async () => espera(await api('GET', '/consentimientos', { token: admin }), 403));

  console.log('\n4. Acceso y portabilidad');
  let acceso;
  await prueba('el personal no puede presentar solicitudes de derechos (RBAC)', async () => espera(await api('POST', '/derechos/solicitudes', { token: auditor, cuerpo: { tipo: 'acceso' } }), 403));
  await prueba('un tipo de derecho desconocido es rechazado', async () => espera(await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'oposicion_total' } }), 400));
  await prueba('la solicitud queda "recibida" y exige contraseña + código de un solo uso', async () => {
    acceso = (await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'acceso' } })).datos;
    assert.equal(acceso.solicitud.estado, 'recibida');
    assert.deepEqual(acceso.verificacion.requiere, ['contrasena', 'codigo']);
    assert.match(acceso.verificacion.codigoEnviadoA, /^a\*\*\*@prueba\.dev$/);
    return `#${acceso.solicitud.id}: código enviado a ${acceso.verificacion.codigoEnviadoA}, plazo de respuesta ${acceso.solicitud.plazoRespuesta.slice(0, 10)}`;
  });
  await prueba('no hay dos solicitudes del mismo tipo abiertas', async () => espera(await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'acceso' } }), 409));
  await prueba('no se descarga nada antes de verificar la identidad', async () => espera(await api('GET', `/derechos/solicitudes/${acceso.solicitud.id}/descarga`, { token: tA }), 409));
  await prueba('otro titular no puede ver, verificar ni descargar la solicitud ajena', async () => {
    espera(await api('POST', `/derechos/solicitudes/${acceso.solicitud.id}/verificar`, { token: tB, cuerpo: { contrasena: titularB.contrasena, codigo: acceso.verificacion.codigoDesarrollo } }), 404);
    return espera(await api('GET', `/derechos/solicitudes/${acceso.solicitud.id}/descarga`, { token: tB }), 404);
  });
  await prueba('con la contraseña correcta pero sin el código, la identidad no se verifica', async () => espera(await api('POST', `/derechos/solicitudes/${acceso.solicitud.id}/verificar`, { token: tA, cuerpo: { contrasena: titularA.contrasena, codigo: '000000' } }), 401));
  await prueba('verificada la identidad, la solicitud recorre el flujo hasta "ejecutada"', async () => {
    const r = await api('POST', `/derechos/solicitudes/${acceso.solicitud.id}/verificar`, { token: tA, cuerpo: { contrasena: titularA.contrasena, codigo: acceso.verificacion.codigoDesarrollo } });
    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    assert.equal(r.datos.solicitud.estado, 'ejecutada');
    const flujo = r.datos.solicitud.historial.map((h) => h.estadoNuevo);
    assert.deepEqual(flujo, ['recibida', 'verificada', 'en_evaluacion', 'ejecutada']);
    return flujo.join(' → ');
  });
  await prueba('la copia es JSON estructurado, íntegro y sin datos de terceros ni internos', async () => {
    const r = await api('GET', `/derechos/solicitudes/${acceso.solicitud.id}/descarga`, { token: tA });
    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    assert.equal(r.datos.formato, 'monify.portabilidad/1');
    assert.equal(r.datos.integridad.huella, createHash('sha256').update(JSON.stringify(r.datos.datos)).digest('hex'));
    assert.equal(r.datos.datos.titular.correo, titularA.correo);
    const texto = JSON.stringify(r.datos);
    for (const prohibido of ['seudonimo.monify.invalid', '"firma"', '"hashRegistro"', '"huellaDatos"', '"usuarioId"', '"evidenciaResolucionId"', titularB.correo]) {
      assert.ok(!texto.includes(prohibido), `la copia contiene "${prohibido}"`);
    }
    return `${r.datos.secciones.length} secciones, SHA-256 ${r.datos.integridad.huella.slice(0, 16)}…`;
  });
  await prueba('la copia se entrega una sola vez: la descarga cierra la solicitud', async () => espera(await api('GET', `/derechos/solicitudes/${acceso.solicitud.id}/descarga`, { token: tA }), 409));

  console.log('\n5. Rectificación');
  await prueba('el RUT no se rectifica en línea (identificador validado por KYC)', async () => espera(await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'rectificacion', cambios: { rut: '1-9' } } }), 400));
  await prueba('campos que no existen o no se pueden rectificar son rechazados', async () => espera(await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'rectificacion', cambios: { rol: 'admin' } } }), 400));
  await prueba('los datos nuevos cumplen las mismas reglas del registro', async () => espera(await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'rectificacion', cambios: { numeroCelular: 'abc' } } }), 400));
  await prueba('no se puede tomar el correo de otro titular', async () => espera(await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'rectificacion', cambios: { correo: titularB.correo } } }), 409));
  await prueba('nombre y celular: verificación con contraseña, se aplica y se cierra', async () => {
    const creada = (await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'rectificacion', cambios: { nombre: 'Ana María Titular', numeroCelular: '+56987654321' } } })).datos;
    assert.deepEqual(creada.verificacion.requiere, ['contrasena']);
    const r = await api('POST', `/derechos/solicitudes/${creada.solicitud.id}/verificar`, { token: tA, cuerpo: { contrasena: titularA.contrasena } });
    assert.equal(r.datos.solicitud.estado, 'cerrada');
    assert.equal(r.datos.solicitud.resultado, 'ejecutada');
    const perfil = (await api('GET', '/usuarios/me', { token: tA })).datos;
    assert.equal(perfil.nombre, 'Ana María Titular');
    assert.equal(perfil.numeroCelular, '+56987654321');
    return r.datos.solicitud.historial.map((h) => h.estadoNuevo).join(' → ');
  });
  const correoNuevo = `ana.nueva${sufijo}@prueba.dev`;
  await prueba('cambiar el correo exige además un código enviado al correo nuevo', async () => {
    const creada = (await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'rectificacion', cambios: { correo: correoNuevo } } })).datos;
    assert.deepEqual(creada.verificacion.requiere, ['contrasena', 'codigo']);
    assert.match(creada.verificacion.codigoEnviadoA, /^a\*\*\*@prueba\.dev$/);
    const r = await api('POST', `/derechos/solicitudes/${creada.solicitud.id}/verificar`, { token: tA, cuerpo: { contrasena: titularA.contrasena, codigo: creada.verificacion.codigoDesarrollo } });
    assert.equal(r.datos.solicitud.resultado, 'ejecutada');
    assert.equal((await api('POST', '/auth/login', { cuerpo: { correo: titularA.correo, contrasena: titularA.contrasena } })).estado, 401);
    tA = (await login(correoNuevo, titularA.contrasena)).accessToken;
    return 'el login funciona con el correo nuevo y no con el anterior';
  });
  await prueba('se puede desistir de una solicitud antes de que se ejecute', async () => {
    const creada = (await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'acceso' } })).datos;
    const r = await api('POST', `/derechos/solicitudes/${creada.solicitud.id}/desistir`, { token: tA });
    assert.equal(r.datos.estado, 'cerrada');
    assert.equal(r.datos.resultado, 'desistida');
    return 'recibida → cerrada (desistida)';
  });

  console.log('\n6. Supresión');
  await prueba('sin la casilla de confirmación no se recibe la solicitud', async () => espera(await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'supresion' } }), 400));
  await prueba('con obligaciones pendientes se rechaza con una respuesta fundamentada', async () => {
    const tarjeta = (await api('POST', '/tarjetas', { token: tA, cuerpo: { bancoId: 1, numeroTarjeta: '4111111111111111' } })).datos;
    await api('POST', '/transacciones', { token: tA, cuerpo: { tarjetaId: tarjeta.id, tipo: 'abono', monto: 5000, confirmacionNoRepudio: true } });
    const creada = (await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'supresion', confirmacionNoRepudio: true } })).datos;
    const r = await api('POST', `/derechos/solicitudes/${creada.solicitud.id}/verificar`, { token: tA, cuerpo: { contrasena: titularA.contrasena, codigo: creada.verificacion.codigoDesarrollo } });
    assert.equal(r.datos.solicitud.resultado, 'rechazada');
    assert.match(r.datos.solicitud.respuesta, /Ley N° 21\.719.*saldo de \$5\.000/);
    assert.equal((await api('GET', '/billeteras', { token: tA })).estado, 200, 'la cuenta sigue activa');
    return r.datos.solicitud.historial.map((h) => h.estadoNuevo).join(' → ');
  });
  let idB;
  await prueba('sin obligaciones se ejecuta: anonimización irreversible y fin de la sesión', async () => {
    idB = (await api('GET', '/usuarios/me', { token: tB })).datos.id;
    const creada = (await api('POST', '/derechos/solicitudes', { token: tB, cuerpo: { tipo: 'supresion', confirmacionNoRepudio: true } })).datos;
    const r = await api('POST', `/derechos/solicitudes/${creada.solicitud.id}/verificar`, { token: tB, cuerpo: { contrasena: titularB.contrasena, codigo: creada.verificacion.codigoDesarrollo } });
    assert.equal(r.datos.solicitud.resultado, 'ejecutada', JSON.stringify(r.datos));
    assert.equal(r.datos.sesionCerrada, true);
    espera(await api('GET', '/derechos/solicitudes', { token: tB }), 401);
    espera(await api('POST', '/auth/login', { cuerpo: { correo: titularB.correo, contrasena: titularB.contrasena } }), 401);
    return 'token invalidado y login imposible';
  });
  await prueba('Admin y Auditor supervisan plazos sin ver los datos pedidos ni la respuesta', async () => {
    const r = await api('GET', '/derechos/supervision', { token: auditor });
    assert.equal(r.estado, 200);
    const fila = r.datos.find((s) => s.usuarioId === idB);
    assert.equal(fila.resultado, 'ejecutada');
    assert.equal(fila.respuesta, undefined);
    assert.equal(fila.camposSolicitados, undefined);
    espera(await api('GET', '/derechos/supervision', { token: tA }), 403);
    return `${r.datos.length} solicitudes, campos: ${Object.keys(fila).join(', ')}`;
  });

  console.log('\n7. Auditoría de las operaciones');
  await prueba('la bitácora registra los eventos de derechos sin códigos ni contraseñas', async () => {
    const logs = (await api('GET', '/auditoria/logs?limite=400', { token: auditor })).datos.filter((l) => l.accion.startsWith('derechos.'));
    const acciones = new Set(logs.map((l) => l.accion));
    for (const accion of ['derechos.acceso.recibida', 'derechos.acceso.verificada', 'derechos.acceso.descargada', 'derechos.rectificacion.ejecutada', 'derechos.supresion.rechazada', 'derechos.supresion.ejecutada']) {
      assert.ok(acciones.has(accion), `falta ${accion}`);
    }
    const texto = JSON.stringify(logs);
    assert.ok(!texto.includes(acceso.verificacion.codigoDesarrollo) && !texto.includes(titularA.contrasena) && !texto.includes(correoNuevo));
    return `${logs.length} eventos: ${[...acciones].slice(0, 6).join(', ')}…`;
  });
  await prueba('la cadena de hashes de la bitácora sigue íntegra', async () => {
    const r = (await api('GET', '/auditoria/integridad', { token: auditor })).datos;
    assert.equal(r.valida, true);
    return `${r.registrosVerificados} registros verificados`;
  });

  console.log('\n8. Controles en la base de datos (acceso directo, sin pasar por la API)');
  if (!process.env.DATABASE_URL) {
    omitidas += 1;
    console.log('  - omitido: define DATABASE_URL para probar los triggers directamente en PostgreSQL');
  } else {
    const bd = new Client({ connectionString: process.env.DATABASE_URL });
    await bd.connect();
    try {
      const idA = Number((await api('GET', '/usuarios/me', { token: tA })).datos.id);
      await prueba('el log de consentimientos no se puede modificar', async () => rechazaEnBd(bd, `UPDATE "ConsentLogs" SET "accion" = 'otorgado' WHERE "idUsuario" = $1`, [idA]));
      await prueba('el log de consentimientos no se puede borrar', async () => rechazaEnBd(bd, 'DELETE FROM "ConsentLogs" WHERE "idUsuario" = $1', [idA]));
      await prueba('un consentimiento no se puede borrar (solo revocar)', async () => rechazaEnBd(bd, 'DELETE FROM "UserConsent" WHERE "idUsuario" = $1', [idA]));
      await prueba('un consentimiento revocado no se puede "reactivar" con un UPDATE', async () => rechazaEnBd(bd,
        `UPDATE "UserConsent" SET "estadoActual" = 'otorgado', "revocado_el" = NULL WHERE "idUsuario" = $1 AND "estadoActual" = 'revocado'`, [idA]));
      await prueba('no puede haber dos consentimientos vigentes de la misma finalidad', async () => rechazaEnBd(bd,
        `INSERT INTO "UserConsent" ("idUsuario", "idFinalidad", "finalidad", "versionTexto", "canal") VALUES ($1, 1, 'terminos_y_condiciones', '1.1', 'api')`, [idA]));
      await prueba('una solicitud de derechos no puede saltarse la verificación', async () => {
        const nueva = (await api('POST', '/derechos/solicitudes', { token: tA, cuerpo: { tipo: 'acceso' } })).datos;
        const mensaje = await rechazaEnBd(bd, `UPDATE "SolicitudDerecho" SET "estado" = 'ejecutada' WHERE "idSolicitudDerecho" = $1`, [Number(nueva.solicitud.id)]);
        await api('POST', `/derechos/solicitudes/${nueva.solicitud.id}/desistir`, { token: tA });
        return mensaje;
      });
      await prueba('el historial de solicitudes no se puede alterar', async () => rechazaEnBd(bd, 'DELETE FROM "HistorialSolicitudDerecho"'));
      await prueba('una revocación hecha directo en la BD igual queda en el log (canal "bd_directa")', async () => {
        await bd.query(`UPDATE "UserConsent" SET "estadoActual" = 'revocado' WHERE "idUsuario" = $1 AND "finalidad" = 'tratamiento_datos_personales' AND "estadoActual" = 'otorgado'`, [idA]);
        const ultimo = (await api('GET', '/consentimientos/historial', { token: tA })).datos[0];
        assert.equal(ultimo.accion, 'revocado');
        assert.equal(ultimo.canal, 'bd_directa');
        espera(await api('GET', '/billeteras', { token: tA }), 403);
        return `evento #${ultimo.idEvento} ${ultimo.finalidad}:${ultimo.accion} canal=${ultimo.canal}; la API bloquea al titular de inmediato`;
      });
      await prueba('BDD v5: cada tabla del diagrama tiene isBlocked, createdAt y updatedAt', async () => {
        const tablas = ['Usuario', 'AdministradorRiesgo', 'CredAuthUser', 'CredAuthAdministrador', 'Finalidad', 'UserConsent',
          'VerificadorDeIdentidad', 'ConsultaDeRiesgo', 'Deuda', 'Tarjeta', 'Banco', 'Billetera', 'Transaccion',
          'Credito', 'SolicitudCredito', 'UsuarioCredito', 'EstadoSolicitud'];
        const r = await bd.query(`
          SELECT table_name, count(*)::int AS n FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = ANY($1) AND column_name IN ('isBlocked', 'createdAt', 'updatedAt')
          GROUP BY table_name`, [tablas]);
        assert.deepEqual(r.rows.filter((f) => f.n === 3).map((f) => f.table_name).sort(), [...tablas].sort());
        return `${tablas.length} tablas`;
      });
      await prueba('BDD v5: columnas renombradas y Transaccion con PK (idTransaccion, idTarjeta)', async () => {
        const columnas = (await bd.query(`
          SELECT table_name || '.' || column_name AS c FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name IN ('Usuario', 'AdministradorRiesgo', 'ConsultaDeRiesgo', 'Transaccion')`)).rows.map((f) => f.c);
        for (const c of ['Usuario.rangoRentaMensual', 'Usuario.esMayorDeEdad', 'AdministradorRiesgo.isAccessBlocked', 'ConsultaDeRiesgo.scoreDeRiesgo']) assert.ok(columnas.includes(c), c);
        for (const c of ['Usuario.tramoRenta', 'AdministradorRiesgo.flagAcc', 'ConsultaDeRiesgo.ScoreDeRiesgo', 'Transaccion.idUsuario']) assert.ok(!columnas.includes(c), c);
        const pk = (await bd.query(`
          SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = '"Transaccion"'::regclass AND i.indisprimary ORDER BY a.attname`)).rows.map((f) => f.attname);
        assert.deepEqual(pk, ['idTarjeta', 'idTransaccion']);
        return `PK Transaccion = (${pk.join(', ')})`;
      });
      await prueba('BDD v5: updatedAt lo actualiza un trigger en cada cambio', async () => {
        const antes = (await bd.query('SELECT "updatedAt" FROM "Usuario" WHERE "idUsuario" = $1', [idA])).rows[0].updatedAt;
        await bd.query('UPDATE "Usuario" SET "isAccessBlocked" = "isAccessBlocked" WHERE "idUsuario" = $1', [idA]);
        const despues = (await bd.query('SELECT "updatedAt" FROM "Usuario" WHERE "idUsuario" = $1', [idA])).rows[0].updatedAt;
        assert.ok(despues > antes);
        return `${antes.toISOString()} → ${despues.toISOString()}`;
      });
      await prueba('BDD v5: tras la supresión, los registros conservados quedan con isBlocked', async () => {
        const r = await bd.query(`
          SELECT (SELECT "isBlocked" FROM "Usuario" WHERE "idUsuario" = $1) AS usuario,
                 (SELECT bool_and("isBlocked") FROM "UserConsent" WHERE "idUsuario" = $1) AS consentimientos,
                 (SELECT count(*)::int FROM "ConsentLogs" WHERE "idUsuario" = $1 AND "accion" = 'otorgado') AS otorgados,
                 (SELECT count(*)::int FROM "ConsentLogs" WHERE "idUsuario" = $1) AS eventos`, [Number(idB)]);
        const f = r.rows[0];
        assert.equal(f.usuario, true);
        assert.equal(f.consentimientos, true);
        assert.equal(f.eventos, f.otorgados * 2, 'bloquear no agrega eventos: solo otorgado y revocado');
        return `Usuario y UserConsent bloqueados; ConsentLogs sin eventos extra (${f.eventos})`;
      });
    } finally {
      await bd.end();
    }
  }

  console.log(`\nResultado: ${aprobadas} pruebas aprobadas, ${fallidas} fallidas${omitidas ? `, ${omitidas} sección omitida` : ''}.`);
  process.exit(fallidas ? 1 : 0);
})().catch((error) => { console.error('✗', error.message); process.exit(1); });
