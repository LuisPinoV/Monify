// Pruebas de la Actividad 6: mecanismos de derechos. Cada mecanismo se prueba con una solicitud concreta:
// canal y modelo de datos, verificación de identidad (incluido un solicitante no verificado), acceso y portabilidad,
// rectificación con registro del cambio, supresión (qué se elimina, qué se bloquea y cómo se propaga) y oposición.
// Requiere la API en ejecución en ENTORNO=desarrollo con la semilla cargada (pnpm run db:seed). No usar contra producción.
// Uso: pnpm run prueba:actividad6   (lee PUERTO y DATABASE_URL desde .env; BASE_URL lo sobrescribe)
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Client } = require('pg');

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PUERTO ?? 3000}`;
const CLAVE_SEMILLA = process.env.SEED_CONTRASENA || 'Monify2026!';
const sufijo = Date.now().toString().slice(-7);
let aprobadas = 0;
let fallidas = 0;
let omitidas = 0;

async function api(metodo, ruta, { token, cuerpo, motivo } = {}) {
  const respuesta = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'content-type': 'application/json', 'x-canal': 'api', 'x-dispositivo': 'pruebas-actividad6',
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(motivo ? { 'x-motivo-acceso': motivo } : {})
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
  return r.datos.accessToken;
}

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

// Presenta una solicitud y la verifica con la contraseña (y el código simulado, si se pide).
async function solicitarYVerificar(token, contrasena, cuerpo) {
  const creada = await api('POST', '/derechos/solicitudes', { token, cuerpo });
  assert.equal(creada.estado, 201, JSON.stringify(creada.datos));
  const r = await api('POST', `/derechos/solicitudes/${creada.datos.solicitud.id}/verificar`, {
    token, cuerpo: { contrasena, codigo: creada.datos.verificacion.codigoDesarrollo }
  });
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  return { creada: creada.datos, resultado: r.datos };
}

(async () => {
  const { version } = (await api('GET', '/terminos')).datos;
  const todas = { versionTerminos: version, aceptaTerminos: true, aceptaTratamientoDatos: true, aceptaEvaluacionCrediticia: true };
  const carla = { nombre: 'Carla Solicitante', correo: `carla${sufijo}@prueba.dev`, rut: `${sufijo}4-4`, fechaNacimiento: '1990-01-02', numeroCelular: '+56911112222', rentaMensual: 650000, contrasena: 'ClaveCarla2026' };
  const diego = { nombre: 'Diego Solicitante', correo: `diego${sufijo}@prueba.dev`, rut: `${sufijo}5-5`, fechaNacimiento: '1985-05-06', numeroCelular: '+56933334444', contrasena: 'ClaveDiego2026' };
  for (const titular of [carla, diego]) {
    const r = await api('POST', '/usuarios', { cuerpo: { ...titular, ...todas } });
    assert.equal(r.estado, 201, `registro de ${titular.correo}: ${JSON.stringify(r.datos)}`);
  }
  const tC = await login(carla.correo, carla.contrasena);
  const tD = await login(diego.correo, diego.contrasena);
  const idC = (await api('GET', '/usuarios/me', { token: tC })).datos.id;
  const idD = (await api('GET', '/usuarios/me', { token: tD })).datos.id;
  const riesgo = await login('administrador.riesgo@monify.dev', CLAVE_SEMILLA);
  const auditor = await login('auditor@monify.dev', CLAVE_SEMILLA);
  const motivo = 'Prueba Actividad 6: evaluación de crédito';

  console.log('\n1. Canal de solicitudes y modelo de datos');
  await prueba('el canal es la API autenticada /derechos (y el panel "Mis derechos"): sin sesión no se recibe nada', async () => espera(await api('POST', '/derechos/solicitudes', { cuerpo: { tipo: 'acceso' } }), 401));
  await prueba('el personal no presenta solicitudes por un titular (RBAC: solo el propio titular)', async () => espera(await api('POST', '/derechos/solicitudes', { token: riesgo, cuerpo: { tipo: 'oposicion', tratamiento: 'score_comportamiento' } }), 403));
  await prueba('el catálogo de tratamientos oponibles está publicado para el titular', async () => {
    const r = await api('GET', '/derechos/tratamientos', { token: tC });
    assert.equal(r.estado, 200);
    assert.deepEqual(r.datos.map((t) => t.id), ['score_comportamiento']);
    return r.datos.map((t) => `${t.id}: ${t.nombre}`).join('; ');
  });
  await prueba('cada solicitud se registra con tipo, estado, canal, fechas y plazo de 30 días, y se sigue por su historial', async () => {
    const r = await api('POST', '/derechos/solicitudes', { token: tC, cuerpo: { tipo: 'acceso' } });
    assert.equal(r.estado, 201);
    const s = r.datos.solicitud;
    assert.equal(s.estado, 'recibida');
    assert.equal(s.canal, 'api');
    const dias = Math.round((new Date(s.plazoRespuesta) - new Date(s.recibidaEn)) / 86_400_000);
    assert.equal(dias, 30);
    assert.deepEqual(s.historial.map((h) => h.estadoNuevo), ['recibida']);
    await api('POST', `/derechos/solicitudes/${s.id}/desistir`, { token: tC });
    const seguimiento = (await api('GET', '/derechos/solicitudes', { token: tC })).datos.find((x) => x.id === s.id);
    return `#${s.id} ${seguimiento.historial.map((h) => h.estadoNuevo).join(' → ')} (${seguimiento.resultado}), plazo ${dias} días`;
  });

  console.log('\n2. Verificación de identidad (solicitante no verificado)');
  let noVerificada;
  await prueba('Diego pide una copia de sus datos: queda "recibida" y exige contraseña + código de un solo uso', async () => {
    noVerificada = (await api('POST', '/derechos/solicitudes', { token: tD, cuerpo: { tipo: 'acceso' } })).datos;
    assert.deepEqual(noVerificada.verificacion.requiere, ['contrasena', 'codigo']);
    return `#${noVerificada.solicitud.id}, código enviado a ${noVerificada.verificacion.codigoEnviadoA}`;
  });
  await prueba('sin verificar no se entrega nada', async () => espera(await api('GET', `/derechos/solicitudes/${noVerificada.solicitud.id}/descarga`, { token: tD }), 409));
  await prueba('alguien con la sesión de Diego pero sin su contraseña no se verifica', async () => espera(await api('POST', `/derechos/solicitudes/${noVerificada.solicitud.id}/verificar`, {
    token: tD, cuerpo: { contrasena: 'NoEsLaClave1', codigo: noVerificada.verificacion.codigoDesarrollo }
  }), 401));
  await prueba('con la contraseña pero con un código equivocado tampoco', async () => espera(await api('POST', `/derechos/solicitudes/${noVerificada.solicitud.id}/verificar`, {
    token: tD, cuerpo: { contrasena: diego.contrasena, codigo: '999999' }
  }), 401));
  await prueba('otro titular (Carla) no puede verificar la solicitud de Diego ni con el código correcto', async () => espera(await api('POST', `/derechos/solicitudes/${noVerificada.solicitud.id}/verificar`, {
    token: tC, cuerpo: { contrasena: carla.contrasena, codigo: noVerificada.verificacion.codigoDesarrollo }
  }), 404));
  await prueba('al 5.º intento fallido la solicitud se rechaza y se cierra sin entregar datos', async () => {
    let r;
    for (let i = 0; i < 3; i += 1) {
      r = await api('POST', `/derechos/solicitudes/${noVerificada.solicitud.id}/verificar`, { token: tD, cuerpo: { contrasena: 'NoEsLaClave1', codigo: '000000' } });
    }
    espera(r, 403);
    const final = (await api('GET', '/derechos/solicitudes', { token: tD })).datos.find((s) => s.id === noVerificada.solicitud.id);
    assert.equal(final.estado, 'cerrada');
    assert.equal(final.resultado, 'rechazada');
    assert.equal(final.verificadaEn, null);
    espera(await api('GET', `/derechos/solicitudes/${noVerificada.solicitud.id}/descarga`, { token: tD }), 409);
    return `${final.historial.map((h) => h.estadoNuevo).join(' → ')}: "${final.respuesta}"`;
  });

  console.log('\n3. Rectificación con registro del cambio');
  let rectificacion;
  await prueba('Carla corrige su nombre y su renta: se verifica con contraseña y se aplica', async () => {
    rectificacion = await solicitarYVerificar(tC, carla.contrasena, { tipo: 'rectificacion', cambios: { nombre: 'Carla Andrea Solicitante', rentaMensual: 1_800_000 } });
    assert.deepEqual(rectificacion.creada.verificacion.requiere, ['contrasena']);
    assert.equal(rectificacion.resultado.solicitud.resultado, 'ejecutada');
    const perfil = (await api('GET', '/usuarios/me', { token: tC })).datos;
    assert.equal(perfil.nombre, 'Carla Andrea Solicitante');
    return `${rectificacion.resultado.solicitud.respuesta.split('.')[0]}; tramo nuevo ${perfil.tramoRentaEtiqueta ?? perfil.tramoRenta}`;
  });

  console.log('\n4. Oposición al score de comportamiento financiero');
  await prueba('un tratamiento que no existe en el catálogo es rechazado', async () => espera(await api('POST', '/derechos/solicitudes', { token: tC, cuerpo: { tipo: 'oposicion', tratamiento: 'marketing' } }), 400));
  await prueba('antes de oponerse, el administrador de riesgo puede registrar un score para Carla', async () => {
    const r = await api('POST', '/consultas-riesgo', { token: riesgo, cuerpo: { usuarioId: idC, score: 720, morosidad: false } });
    espera(r, 201);
    return `consulta #${r.datos.id} con score ${r.datos.score}`;
  });
  let oposicion;
  await prueba('Carla se opone: verificación con contraseña, la solicitud se ejecuta y la oposición queda vigente', async () => {
    oposicion = await solicitarYVerificar(tC, carla.contrasena, { tipo: 'oposicion', tratamiento: 'score_comportamiento', motivo: 'No quiero ser perfilada' });
    assert.deepEqual(oposicion.creada.verificacion.requiere, ['contrasena']);
    assert.equal(oposicion.resultado.solicitud.resultado, 'ejecutada');
    const vigentes = (await api('GET', '/derechos/oposiciones', { token: tC })).datos.filter((o) => o.vigente);
    assert.deepEqual(vigentes.map((o) => o.tratamiento), ['score_comportamiento']);
    return oposicion.resultado.solicitud.historial.map((h) => h.estadoNuevo).join(' → ');
  });
  await prueba('no se puede presentar una segunda oposición al mismo tratamiento mientras siga vigente', async () => espera(await api('POST', '/derechos/solicitudes', { token: tC, cuerpo: { tipo: 'oposicion', tratamiento: 'score_comportamiento' } }), 409));
  await prueba('bloqueo efectivo: registrar un score nuevo para Carla es rechazado', async () => espera(await api('POST', '/consultas-riesgo', { token: riesgo, cuerpo: { usuarioId: idC, score: 650, morosidad: false } }), 409));
  await prueba('el resto del tratamiento sigue: se registra la consulta de riesgo sin score', async () => {
    const r = await api('POST', '/consultas-riesgo', { token: riesgo, cuerpo: { usuarioId: idC, morosidad: false, diasEnDeuda: 0 } });
    espera(r, 201);
    return `consulta #${r.datos.id} sin score`;
  });
  await prueba('el score ya registrado queda bloqueado: el personal ya no lo ve', async () => {
    const r = await api('GET', `/consultas-riesgo?usuarioId=${idC}`, { token: riesgo, motivo });
    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    assert.ok(r.datos.length >= 2);
    assert.ok(r.datos.every((c) => c.score === undefined && c.scoreBloqueado === true));
    const info = (await api('GET', `/informacion-financiera?usuarioId=${idC}`, { token: riesgo, motivo })).datos;
    assert.deepEqual(info.oposiciones.map((o) => o.tratamiento), ['score_comportamiento']);
    return `${r.datos.length} consultas con scoreBloqueado=true; información financiera avisa la oposición`;
  });
  await prueba('levantar la oposición exige la contraseña', async () => espera(await api('POST', '/derechos/oposiciones/score_comportamiento/levantar', { token: tC, cuerpo: { contrasena: 'NoEsLaClave1' } }), 401));
  await prueba('levantada la oposición, el tratamiento vuelve a aplicarse', async () => {
    const r = await api('POST', '/derechos/oposiciones/score_comportamiento/levantar', { token: tC, cuerpo: { contrasena: carla.contrasena } });
    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    assert.ok(r.datos.every((o) => !o.vigente && o.levantadaEn));
    espera(await api('POST', '/consultas-riesgo', { token: riesgo, cuerpo: { usuarioId: idC, score: 700, morosidad: false } }), 201);
    const visibles = (await api('GET', `/consultas-riesgo?usuarioId=${idC}`, { token: riesgo, motivo })).datos;
    assert.ok(visibles.some((c) => c.score === 720));
    return 'scores visibles otra vez y se puede registrar uno nuevo';
  });
  await prueba('la oposición vuelve a quedar vigente con una nueva solicitud (para el resto de las pruebas)', async () => {
    const r = await solicitarYVerificar(tC, carla.contrasena, { tipo: 'oposicion', tratamiento: 'score_comportamiento' });
    assert.equal(r.resultado.solicitud.resultado, 'ejecutada');
    return `#${r.creada.solicitud.id} ejecutada`;
  });

  console.log('\n5. Acceso y portabilidad');
  let copia;
  await prueba('Carla pide su copia: contraseña + código, y la solicitud llega a "ejecutada"', async () => {
    const r = await solicitarYVerificar(tC, carla.contrasena, { tipo: 'acceso' });
    assert.equal(r.resultado.solicitud.estado, 'ejecutada');
    const d = await api('GET', `/derechos/solicitudes/${r.creada.solicitud.id}/descarga`, { token: tC });
    assert.equal(d.estado, 200, JSON.stringify(d.datos));
    copia = d.datos;
    return `formato ${copia.formato}, ${copia.secciones.length} secciones: ${copia.secciones.join(', ')}`;
  });
  await prueba('el archivo es JSON estructurado e íntegro (huella SHA-256 verificable)', async () => {
    assert.equal(copia.integridad.huella, createHash('sha256').update(JSON.stringify(copia.datos)).digest('hex'));
    return copia.integridad.huella.slice(0, 16) + '…';
  });
  await prueba('contiene todos sus datos: perfil corregido, rectificaciones, oposiciones y el score bloqueado', async () => {
    assert.equal(copia.datos.titular.nombre, 'Carla Andrea Solicitante');
    assert.equal(copia.datos.titular.correo, carla.correo);
    assert.deepEqual(copia.datos.rectificaciones.map((r) => r.campo).sort(), ['nombre', 'rentaMensual']);
    assert.ok(copia.datos.oposiciones.some((o) => o.tratamiento === 'score_comportamiento' && o.vigente));
    assert.ok(copia.datos.consultasRiesgo.some((c) => c.score === 720), 'el derecho de acceso incluye los datos bloqueados');
    for (const seccion of ['titular', 'billetera', 'transacciones', 'consentimientos', 'historialConsentimientos', 'actividad', 'rectificaciones', 'oposiciones']) {
      assert.ok(seccion in copia.datos, `falta la sección ${seccion}`);
    }
    return `${copia.datos.rectificaciones.length} rectificaciones, ${copia.datos.oposiciones.length} oposiciones, ${copia.datos.actividad.length} eventos de actividad`;
  });
  await prueba('y solo los suyos: ni datos de Diego, ni seudónimos, firmas o identificadores internos', async () => {
    const texto = JSON.stringify(copia);
    for (const prohibido of [diego.correo, diego.rut, 'Diego Solicitante', 'seudonimo.monify.invalid', '"firma"', '"hashRegistro"', '"huellaAnterior"', '"usuarioId"']) {
      assert.ok(!texto.includes(prohibido), `la copia contiene "${prohibido}"`);
    }
    return 'sin datos de terceros ni internos';
  });

  console.log('\n6. Supresión');
  await prueba('Carla tiene saldo: la supresión se rechaza con respuesta fundamentada y nada se borra', async () => {
    const tarjeta = (await api('POST', '/tarjetas', { token: tC, cuerpo: { bancoId: 1, numeroTarjeta: '4111111111111111' } })).datos;
    await api('POST', '/transacciones', { token: tC, cuerpo: { tarjetaId: tarjeta.id, tipo: 'abono', monto: 12000, confirmacionNoRepudio: true } });
    const r = await solicitarYVerificar(tC, carla.contrasena, { tipo: 'supresion', confirmacionNoRepudio: true });
    assert.equal(r.resultado.solicitud.resultado, 'rechazada');
    assert.match(r.resultado.solicitud.respuesta, /saldo de \$12\.000/);
    espera(await api('GET', '/usuarios/me', { token: tC }), 200);
    return r.resultado.solicitud.respuesta.slice(0, 90) + '…';
  });
  let informe;
  await prueba('Diego corrige su celular y luego pide la supresión: se ejecuta y la sesión termina', async () => {
    await solicitarYVerificar(tD, diego.contrasena, { tipo: 'rectificacion', cambios: { numeroCelular: '+56955556666' } });
    const tarjeta = (await api('POST', '/tarjetas', { token: tD, cuerpo: { bancoId: 2, numeroTarjeta: '5500000000000004' } })).datos;
    const r = await solicitarYVerificar(tD, diego.contrasena, { tipo: 'supresion', confirmacionNoRepudio: true });
    assert.equal(r.resultado.solicitud.resultado, 'ejecutada', JSON.stringify(r.resultado));
    assert.equal(r.resultado.sesionCerrada, true);
    informe = r.resultado.informeSupresion;
    assert.ok(tarjeta.id);
    espera(await api('GET', '/usuarios/me', { token: tD }), 401);
    espera(await api('POST', '/auth/login', { cuerpo: { correo: diego.correo, contrasena: diego.contrasena } }), 401);
    return 'token invalidado y login imposible';
  });
  await prueba('el informe indica qué se eliminó', async () => {
    assert.ok(informe.eliminado.length >= 6);
    assert.ok(informe.eliminado.some((e) => /bóveda/.test(e)));
    return informe.eliminado.slice(0, 3).join('; ') + '…';
  });
  await prueba('qué quedó bloqueado por obligación legal (con su motivo)', async () => {
    const tablas = informe.bloqueadoPorObligacionLegal.map((b) => b.tabla);
    for (const tabla of ['Usuario', 'Billetera', 'Tarjeta', 'UserConsent']) assert.ok(tablas.includes(tabla), `falta ${tabla}`);
    return informe.bloqueadoPorObligacionLegal.map((b) => `${b.tabla}(${b.registros})`).join(', ');
  });
  await prueba('y cómo se propagó (base, bóveda, sesiones, bitácora, respaldos y terceros)', async () => {
    const destinos = informe.propagacion.map((p) => p.destino);
    assert.ok(destinos.some((d) => /Bóveda/.test(d)) && destinos.some((d) => /terceros/.test(d)) && destinos.some((d) => /Respaldos/.test(d)));
    assert.equal(informe.propagacion.find((p) => /Bóveda/.test(p.destino)).estado, 'aplicada');
    return informe.propagacion.map((p) => `${p.destino}: ${p.estado}`).join(' | ');
  });

  console.log('\n7. Auditoría');
  await prueba('la bitácora registra cada mecanismo (oposición, levantamiento, rectificación y propagación de la supresión)', async () => {
    const logs = (await api('GET', '/auditoria/logs?limite=500', { token: auditor })).datos.filter((l) => l.accion.startsWith('derechos.'));
    const acciones = new Set(logs.map((l) => l.accion));
    for (const accion of ['derechos.oposicion.recibida', 'derechos.oposicion.verificada', 'derechos.oposicion.ejecutada', 'derechos.oposicion.levantada',
      'derechos.rectificacion.ejecutada', 'derechos.supresion.propagada', 'derechos.supresion.rechazada', 'derechos.acceso.verificacion']) {
      assert.ok(acciones.has(accion), `falta ${accion}`);
    }
    const texto = JSON.stringify(logs);
    assert.ok(!texto.includes(carla.contrasena) && !texto.includes('Carla Andrea Solicitante'));
    return `${acciones.size} tipos de evento de derechos`;
  });
  await prueba('Admin y Auditor ven las oposiciones en la supervisión de plazos', async () => {
    const r = await api('GET', '/derechos/supervision', { token: auditor });
    const propias = r.datos.filter((s) => s.usuarioId === idC && s.tipo === 'oposicion');
    assert.ok(propias.length >= 2);
    return `${propias.length} oposiciones de Carla: ${propias.map((s) => s.resultado).join(', ')}`;
  });
  await prueba('la cadena de hashes de la bitácora sigue íntegra', async () => {
    const r = (await api('GET', '/auditoria/integridad', { token: auditor })).datos;
    assert.equal(r.valida, true);
    return `${r.registrosVerificados} registros verificados`;
  });

  console.log('\n8. Modelo de datos y controles en la base (acceso directo)');
  if (!process.env.DATABASE_URL) {
    omitidas += 1;
    console.log('  - omitido: define DATABASE_URL para revisar las tablas y los triggers directamente en PostgreSQL');
  } else {
    const bd = new Client({ connectionString: process.env.DATABASE_URL });
    await bd.connect();
    try {
      await prueba('la rectificación dejó un registro por campo con huellas del valor anterior y del nuevo (sin datos en claro)', async () => {
        const filas = (await bd.query('SELECT * FROM "RegistroRectificacion" WHERE "idUsuario" = $1 ORDER BY "idRegistro"', [Number(idC)])).rows;
        assert.deepEqual(filas.map((f) => f.campo), ['nombre', 'rentaMensual']);
        assert.ok(filas.every((f) => /^[0-9a-f]{64}$/.test(f.huellaAnterior) && /^[0-9a-f]{64}$/.test(f.huellaNueva) && f.huellaAnterior !== f.huellaNueva));
        assert.ok(filas.every((f) => String(f.idSolicitudDerecho) === rectificacion.creada.solicitud.id));
        const texto = JSON.stringify(filas);
        assert.ok(!texto.includes('Carla') && !texto.includes('1800000'));
        return filas.map((f) => `${f.campo}: ${f.huellaAnterior.slice(0, 8)}… → ${f.huellaNueva.slice(0, 8)}…`).join('; ');
      });
      await prueba('el registro de rectificaciones no se puede modificar ni borrar', async () => {
        await rechazaEnBd(bd, 'DELETE FROM "RegistroRectificacion" WHERE "idUsuario" = $1', [Number(idC)]);
        return rechazaEnBd(bd, `UPDATE "RegistroRectificacion" SET "campo" = 'correo' WHERE "idUsuario" = $1`, [Number(idC)]);
      });
      await prueba('la supresión borró las huellas de las rectificaciones de Diego y bloqueó lo retenido', async () => {
        const huellas = (await bd.query('SELECT "campo", "huellaAnterior", "huellaNueva" FROM "RegistroRectificacion" WHERE "idUsuario" = $1', [Number(idD)])).rows;
        assert.equal(huellas.length, 1);
        assert.equal(huellas[0].huellaAnterior, null);
        assert.equal(huellas[0].huellaNueva, null);
        const u = (await bd.query('SELECT "estadoCuenta", "isBlocked", "rutHash", "emailHash", "rangoRentaMensual" FROM "Usuario" WHERE "idUsuario" = $1', [Number(idD)])).rows[0];
        assert.equal(u.estadoCuenta, 'eliminada');
        assert.equal(u.isBlocked, true);
        assert.equal(u.rutHash, null);
        assert.equal(u.emailHash, null);
        const credencial = (await bd.query('SELECT count(*)::int AS n FROM "CredAuthUser" WHERE "idUsuario" = $1', [Number(idD)])).rows[0].n;
        assert.equal(credencial, 0);
        return `campo "${huellas[0].campo}" sin huellas; Usuario eliminada/isBlocked; sin credencial`;
      });
      await prueba('una oposición no se puede borrar ni reactivar una vez levantada', async () => {
        await rechazaEnBd(bd, 'DELETE FROM "OposicionTratamiento" WHERE "idUsuario" = $1', [Number(idC)]);
        return rechazaEnBd(bd, 'UPDATE "OposicionTratamiento" SET "levantadaEn" = NULL, "canalLevantamiento" = NULL WHERE "idUsuario" = $1 AND "levantadaEn" IS NOT NULL', [Number(idC)]);
      });
      await prueba('no puede haber dos oposiciones vigentes al mismo tratamiento', async () => rechazaEnBd(bd,
        `INSERT INTO "OposicionTratamiento" ("idUsuario", "tratamiento", "idSolicitudDerecho") VALUES ($1, 'score_comportamiento', $2)`,
        [Number(idC), Number(oposicion.creada.solicitud.id)]));
      await prueba('el modelo admite el tipo "oposicion" y rechaza tipos desconocidos', async () => rechazaEnBd(bd,
        `INSERT INTO "SolicitudDerecho" ("idUsuario", "tipoDerecho", "nivelVerificacion", "canal", "plazoRespuesta") VALUES ($1, 'olvido_total', 'contrasena', 'api', now())`, [Number(idC)]));
    } finally {
      await bd.end();
    }
  }

  console.log(`\nResultado: ${aprobadas} aprobadas, ${fallidas} fallidas${omitidas ? `, ${omitidas} omitidas` : ''}`);
  process.exitCode = fallidas > 0 ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
