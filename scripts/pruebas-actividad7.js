// Pruebas de la Actividad 7: registro de auditoría, protección y conservación de los registros, alertas de acceso
// anómalo y simulación de un incidente reconstruido desde la bitácora.
// Requiere la API en ejecución en ENTORNO=desarrollo con la semilla cargada (pnpm run db:seed). No usar contra producción.
// Uso: pnpm run prueba:actividad7   (lee PUERTO y DATABASE_URL desde .env; BASE_URL lo sobrescribe)
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Client } = require('pg');

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PUERTO ?? 3000}`;
const CLAVE_SEMILLA = process.env.SEED_CONTRASENA || 'Monify2026!';
const sufijo = Date.now().toString().slice(-7);
let aprobadas = 0;
let fallidas = 0;
let omitidas = 0;

async function api(metodo, ruta, { token, cuerpo, motivo, dispositivo = 'pruebas-actividad7', canal = 'api' } = {}) {
  const respuesta = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'content-type': 'application/json', 'x-canal': canal, 'x-dispositivo': dispositivo,
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

async function login(correo, contrasena, dispositivo) {
  const r = await api('POST', '/auth/login', { cuerpo: { correo, contrasena }, dispositivo });
  assert.equal(r.estado, 200, `login de ${correo}: ${JSON.stringify(r.datos)}`);
  return r.datos;
}

async function rechazaEnBd(bd, sql, parametros = []) {
  await bd.query('BEGIN');
  try {
    await bd.query(sql, parametros.length ? parametros : undefined);
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
  const registrar = async (n) => {
    const titular = { nombre: `Titular Siete ${n}`, correo: `t7.${n}.${sufijo}@prueba.dev`, rut: `${sufijo}${String(n).padStart(2, '0')}-${n % 10}`, fechaNacimiento: '1990-01-01', contrasena: `ClaveSiete${n}x` };
    const r = await api('POST', '/usuarios', { cuerpo: { ...titular, ...todas } });
    assert.equal(r.estado, 201, `registro ${n}: ${JSON.stringify(r.datos)}`);
    return { ...titular, id: r.datos.id };
  };

  const admin = await login('admin@monify.dev', CLAVE_SEMILLA);
  const auditor = await login('auditor@monify.dev', CLAVE_SEMILLA);
  const riesgo = await login('administrador.riesgo@monify.dev', CLAVE_SEMILLA);
  const tAdmin = admin.accessToken;
  const tAuditor = auditor.accessToken;
  const titulares = [];
  for (let n = 1; n <= 27; n += 1) titulares.push(await registrar(n));
  const [ana, bruno, ...perfiles] = titulares;
  const tAna = (await login(ana.correo, ana.contrasena)).accessToken;

  console.log('\n1. Catálogo de eventos y campos de cada registro');
  await prueba('el catálogo formal (evento, actor, datos registrados, datos excluidos) está publicado para el Auditor', async () => {
    const r = await api('GET', '/auditoria/politica', { token: tAuditor });
    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    const eventos = r.datos.eventos.map((e) => e.evento);
    for (const e of ['auth.login', 'perfil.ver', 'transaccion.crear', 'kyc.ver', 'info_financiera.ver', 'logs.revisar']) assert.ok(eventos.includes(e), `falta ${e}`);
    assert.ok(r.datos.eventos.every((e) => e.actor && e.datosRegistrados && e.datosExcluidos));
    return `${r.datos.eventos.length} eventos, ${r.datos.campos.length} campos por registro`;
  });

  console.log('\n2. Registro de accesos y operaciones sobre datos personales (sin los datos)');
  await prueba('leer el perfil propio queda registrado como perfil.ver, sin el nombre ni el correo', async () => {
    espera(await api('GET', '/usuarios/me', { token: tAna }), 200);
    const logs = (await api('GET', `/auditoria/logs?usuarioId=${ana.id}&accion=perfil.ver`, { token: tAuditor })).datos;
    assert.ok(logs.length >= 1);
    const texto = JSON.stringify(logs);
    assert.ok(!texto.includes(ana.correo) && !texto.includes(ana.nombre) && !texto.includes(ana.rut));
    return `${logs[0].accion} ${logs[0].recurso} (${logs[0].canal}, ${logs[0].dispositivo})`;
  });
  await prueba('un acceso del personal a datos de un titular registra qué titular se consultó (solo su id) y el motivo', async () => {
    espera(await api('GET', `/informacion-financiera?usuarioId=${ana.id}`, { token: riesgo.accessToken, motivo: 'Evaluación de crédito de prueba' }), 200);
    const logs = (await api('GET', `/auditoria/logs?adminRiesgoId=${riesgo.usuario.id}&limite=5`, { token: tAuditor })).datos;
    const acceso = logs.find((l) => l.accion === 'info_financiera.ver');
    assert.equal(acceso.recurso, `GET /informacion-financiera titular:${ana.id}`);
    assert.ok(logs.some((l) => l.accion === 'acceso.por_necesidad' && l.detalle.motivo));
    assert.ok(!JSON.stringify(logs).includes('saldoTotal'));
    return acceso.recurso;
  });

  console.log('\n3. Protección: acceso restringido y plazo de conservación');
  const operadorBase = await login('operador.financiero@monify.dev', CLAVE_SEMILLA, 'pc-oficina-operador');
  for (const [nombre, token] of [['Admin sin autorización', tAdmin], ['Operador financiero', operadorBase.accessToken], ['Administrador de riesgo', riesgo.accessToken], ['Titular', tAna]]) {
    await prueba(`${nombre}: no accede a la bitácora, las alertas, la política ni la línea de tiempo (403)`, async () => {
      for (const ruta of ['/auditoria/logs', '/auditoria/alertas', '/auditoria/politica', `/auditoria/linea-tiempo?usuarioId=1&desde=2026-01-01&hasta=2026-12-31`]) {
        espera(await api('GET', ruta, { token }), 403);
      }
      return '4 rutas → 403';
    });
  }
  await prueba('el Auditor sí accede', async () => espera(await api('GET', '/auditoria/logs?limite=1', { token: tAuditor }), 200));
  await prueba('excepción: el Admin accede solo mientras tenga una autorización otorgada por un Auditor', async () => {
    const aut = await api('POST', '/autorizaciones', { token: tAuditor, cuerpo: { beneficiarioId: admin.usuario.id, ambito: 'logs', horas: 1 } });
    assert.equal(aut.estado, 201, JSON.stringify(aut.datos));
    espera(await api('GET', '/auditoria/logs?limite=1', { token: tAdmin }), 200);
    espera(await api('DELETE', `/autorizaciones/${aut.datos.id}`, { token: tAuditor }), 200);
    espera(await api('GET', '/auditoria/logs?limite=1', { token: tAdmin }), 403);
    return 'con autorización 200; revocada 403';
  });
  await prueba('cada titular ve solo su propia actividad', async () => {
    const r = (await api('GET', '/usuarios/me/actividad', { token: tAna })).datos;
    assert.ok(r.length > 0 && r.every((l) => l.usuarioId === ana.id));
    return `${r.length} eventos, todos de U#${ana.id}`;
  });
  await prueba('plazo de conservación definido: 5 años para cada tipo de registro, con base legal (Ley 19.913 art. 5)', async () => {
    const r = (await api('GET', '/auditoria/politica', { token: tAuditor })).datos;
    assert.ok(r.conservacion.plazos.every((p) => /5 años/.test(p.plazo)));
    assert.match(r.conservacion.baseLegal, /19\.913.*art\. 5/);
    return r.conservacion.plazos.map((p) => p.registro.split(' (')[0]).join(', ');
  });

  console.log('\n4. Alertas de acceso anómalo');
  await prueba('A1: 3 logins fallidos en 15 min bloquean la cuenta 15 minutos (aun con la contraseña correcta), alertan al Auditor y avisan al titular', async () => {
    for (let i = 0; i < 3; i += 1) espera(await api('POST', '/auth/login', { cuerpo: { correo: bruno.correo, contrasena: 'equivocada1' } }), 401);
    const r = await api('POST', '/auth/login', { cuerpo: { correo: bruno.correo, contrasena: bruno.contrasena } });
    espera(r, 429);
    assert.equal(r.datos.codigo, 'BLOQUEO_TEMPORAL');
    const minutos = (new Date(r.datos.bloqueadoHasta) - Date.now()) / 60_000;
    assert.ok(minutos > 14 && minutos <= 15, `el bloqueo debería durar 15 minutos (quedan ${minutos.toFixed(1)})`);
    const alerta = (await api('GET', '/auditoria/alertas?codigo=A1', { token: tAuditor })).datos.find((a) => a.usuarioId === bruno.id);
    assert.ok(alerta, 'no se creó la alerta A1');
    const aviso = (await api('GET', `/auditoria/logs?usuarioId=${bruno.id}&accion=alerta.aviso_titular`, { token: tAuditor })).datos;
    assert.equal(aviso.length, 1);
    return `429 BLOQUEO_TEMPORAL por ${minutos.toFixed(1)} min (se levanta solo); alerta #${alerta.id}; aviso al titular registrado`;
  });
  await prueba('A1: 10 fallos en cuentas distintas desde un mismo dispositivo bloquean ese dispositivo', async () => {
    const dispositivo = `script-ataque-${sufijo}`;
    for (let i = 0; i < 10; i += 1) await api('POST', '/auth/login', { cuerpo: { correo: `no.existe.${i}.${sufijo}@prueba.dev`, contrasena: 'x' }, dispositivo });
    const r = await api('POST', '/auth/login', { cuerpo: { correo: ana.correo, contrasena: ana.contrasena }, dispositivo });
    espera(r, 429);
    espera(await api('POST', '/auth/login', { cuerpo: { correo: ana.correo, contrasena: ana.contrasena } }), 200);
    const alerta = (await api('GET', '/auditoria/alertas?codigo=A1', { token: tAuditor })).datos.find((a) => a.dispositivo === dispositivo);
    assert.ok(alerta);
    return `dispositivo bloqueado (429), el mismo titular entra desde su dispositivo habitual; alerta #${alerta.id}`;
  });
  await prueba('A3: un titular que entra desde un dispositivo nuevo debe confirmar su contraseña antes de una operación sensible', async () => {
    const carla = perfiles[0];
    await login(carla.correo, carla.contrasena, 'celular-habitual');
    const tNuevo = (await login(carla.correo, carla.contrasena, `notebook-desconocido-${sufijo}`)).accessToken;
    const tarjeta = { bancoId: 1, numeroTarjeta: '4111111111111111' };
    const r = await api('POST', '/tarjetas', { token: tNuevo, cuerpo: tarjeta, dispositivo: `notebook-desconocido-${sufijo}` });
    espera(r, 403);
    assert.equal(r.datos.codigo, 'VERIFICACION_ADICIONAL_REQUERIDA');
    espera(await api('POST', '/auth/verificacion-adicional', { token: tNuevo, cuerpo: { contrasena: 'equivocada1' } }), 401);
    espera(await api('POST', '/auth/verificacion-adicional', { token: tNuevo, cuerpo: { contrasena: carla.contrasena } }), 200);
    espera(await api('POST', '/tarjetas', { token: tNuevo, cuerpo: tarjeta, dispositivo: `notebook-desconocido-${sufijo}` }), 201);
    const alerta = (await api('GET', '/auditoria/alertas?codigo=A3', { token: tAuditor })).datos.find((a) => a.usuarioId === carla.id);
    assert.ok(alerta);
    return `403 → verificación (401 con clave errónea, 200 con la correcta) → 201; alerta #${alerta.id}`;
  });

  console.log('\n6. Simulación de incidente: consulta masiva desde un dispositivo nuevo');
  const t0 = new Date(Date.now() - 1000).toISOString();
  const dispositivoNuevo = `notebook-personal-${sufijo}`;
  let operador;
  const idOperador = operadorBase.usuario.id;
  // Estado inicial limpio: el Auditor cierra las alertas abiertas que el operador pudiera arrastrar de otras pruebas.
  for (const a of (await api('GET', '/auditoria/alertas?estado=abierta', { token: tAuditor })).datos.filter((x) => x.usuarioId === idOperador)) {
    await api('PATCH', `/auditoria/alertas/${a.id}`, { token: tAuditor, cuerpo: { estado: 'cerrada', nota: 'Cierre previo a la simulación' } });
  }
  await prueba('paso 1: el operador financiero inicia sesión desde un dispositivo nuevo', async () => {
    operador = await login('operador.financiero@monify.dev', CLAVE_SEMILLA, dispositivoNuevo);
    return `U#${idOperador} desde "${dispositivoNuevo}" (antes: "pc-oficina-operador")`;
  });
  await prueba('paso 4: consulta 25 perfiles distintos en pocos minutos (20 historiales y 5 informaciones financieras sin autorización)', async () => {
    let ok = 0;
    let denegadas = 0;
    for (const [i, t] of perfiles.slice(0, 25).entries()) {
      const ruta = i < 20 ? `/transacciones?usuarioId=${t.id}` : `/informacion-financiera?usuarioId=${t.id}`;
      const r = await api('GET', ruta, { token: operador.accessToken, motivo: 'Revisión de movimientos', dispositivo: dispositivoNuevo });
      if (r.estado === 200) ok += 1;
      if (r.estado === 403) denegadas += 1;
    }
    assert.equal(ok, 20);
    assert.equal(denegadas, 5);
    return '20 respuestas 200 y 5 rechazos 403 (el operador necesita autorización expresa para la información financiera)';
  });
  await prueba('pasos 2 y 3: cada acceso aparece en UserLogs con actor, acción, fecha, recurso, canal y dispositivo', async () => {
    const todos = (await api('GET', `/auditoria/logs?usuarioId=${idOperador}&desde=${t0}&limite=200`, { token: tAuditor })).datos;
    const logs = todos.filter((l) => ['historial.ver', 'info_financiera.ver'].includes(l.accion));
    assert.equal(logs.length, 25);
    assert.ok(logs.every((l) => l.usuarioId === idOperador && l.fechaAccion && /^GET \/(transacciones|informacion-financiera) titular:\d+$/.test(l.recurso) && l.canal === 'api' && l.dispositivo === dispositivoNuevo));
    assert.equal(new Set(logs.map((l) => l.recurso.split('titular:')[1])).size, 25);
    assert.equal(logs.filter((l) => l.resultado === 'denegado').length, 5);
    return `25 registros (20 éxito, 5 denegado), p. ej. ${logs[0].fechaAccion} U#${logs[0].usuarioId} ${logs[0].accion} "${logs[0].recurso}" ${logs[0].canal}/${logs[0].dispositivo} ${logs[0].resultado}`;
  });
  let alertaA2;
  await prueba('paso 5: se generan las alertas A2 (consulta masiva), A3 (dispositivo nuevo) y A4 (accesos denegados repetidos)', async () => {
    const alertas = (await api('GET', '/auditoria/alertas', { token: tAuditor })).datos.filter((a) => a.usuarioId === idOperador && a.creadaEn >= t0);
    alertaA2 = alertas.find((a) => a.codigo === 'A2');
    const a3 = alertas.find((a) => a.codigo === 'A3');
    const a4 = alertas.find((a) => a.codigo === 'A4');
    assert.ok(alertaA2, 'falta A2');
    assert.ok(a3, 'falta A3');
    assert.ok(a4, 'falta A4');
    return `A2 #${alertaA2.id}: ${alertaA2.descripcion} | A3 #${a3.id} | A4 #${a4.id}: ${a4.descripcion}`;
  });
  await prueba('paso 6: contención: el Admin revoca las sesiones y bloquea la cuenta; el token deja de valer al instante', async () => {
    espera(await api('POST', '/admin/contencion', { token: operador.accessToken, cuerpo: { usuarioId: idOperador, motivo: 'intento de auto-contención' } }), 403);
    const r = await api('POST', '/admin/contencion', { token: tAdmin, cuerpo: { usuarioId: idOperador, motivo: `Consulta masiva (alerta A2 #${alertaA2.id})`, alertaId: alertaA2.id, bloquear: true } });
    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    espera(await api('GET', '/usuarios/me', { token: operador.accessToken, dispositivo: dispositivoNuevo }), 401);
    espera(await api('GET', '/usuarios/me', { token: operadorBase.accessToken }), 401);
    espera(await api('POST', '/auth/login', { cuerpo: { correo: 'operador.financiero@monify.dev', contrasena: CLAVE_SEMILLA }, dispositivo: dispositivoNuevo }), 403);
    return `sesiones revocadas ${r.datos.sesionesRevocadasEn}; ambos tokens → 401; login → 403 (bloqueada)`;
  });
  const t1 = new Date(Date.now() + 1000).toISOString();
  await prueba('paso 7: el Auditor filtra la bitácora por actor y rango de tiempo y reconstruye lo ocurrido', async () => {
    const logs = (await api('GET', `/auditoria/logs?usuarioId=${idOperador}&desde=${t0}&hasta=${t1}&limite=200`, { token: tAuditor })).datos.reverse();
    const acciones = logs.map((l) => l.accion);
    assert.equal(acciones[0], 'auth.login');
    assert.ok(acciones.includes('alerta.A3') && acciones.includes('alerta.A2') && acciones.includes('alerta.A4') && acciones.includes('acceso_denegado'));
    const resumen = {};
    for (const a of acciones) resumen[a] = (resumen[a] ?? 0) + 1;
    return Object.entries(resumen).map(([a, n]) => `${a}×${n}`).join(', ');
  });
  let linea;
  await prueba('paso 9: se exporta la línea de tiempo con huella SHA-256 y firma (cadena de custodia)', async () => {
    const r = await api('GET', `/auditoria/linea-tiempo?usuarioId=${idOperador}&desde=${t0}&hasta=${t1}`, { token: tAuditor });
    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    linea = r.datos;
    assert.equal(linea.cadenaDeCustodia.huella, createHash('sha256').update(JSON.stringify(linea.eventos)).digest('hex'));
    assert.ok(linea.cadenaDeCustodia.firma.length > 100);
    assert.equal(linea.cadenaDeCustodia.bitacoraIntegra, true);
    const primera = new Date(linea.eventos[0].fechaAccion);
    const ultima = new Date(linea.eventos.at(-1).fechaAccion);
    return `${linea.totalEventos} eventos entre ${primera.toISOString().slice(11, 19)} y ${ultima.toISOString().slice(11, 19)}; SHA-256 ${linea.cadenaDeCustodia.huella.slice(0, 16)}…`;
  });
  await prueba('la exportación queda registrada y la cadena de la bitácora sigue íntegra', async () => {
    const exp = (await api('GET', '/auditoria/logs?accion=auditoria.exportar&limite=1', { token: tAuditor })).datos[0];
    assert.equal(exp.detalle.huella, linea.cadenaDeCustodia.huella);
    const integridad = (await api('GET', '/auditoria/integridad', { token: tAuditor })).datos;
    assert.equal(integridad.valida, true);
    return `auditoria.exportar con la misma huella; ${integridad.registrosVerificados} registros íntegros`;
  });
  await prueba('cierre: el Auditor revisa y cierra las alertas; el Admin rehabilita la cuenta', async () => {
    const abiertas = (await api('GET', '/auditoria/alertas?estado=abierta', { token: tAuditor })).datos.filter((a) => a.creadaEn >= t0 || a.usuarioId === bruno.id);
    for (const a of abiertas) espera(await api('PATCH', `/auditoria/alertas/${a.id}`, { token: tAuditor, cuerpo: { estado: 'cerrada', nota: 'Simulación Actividad 7' } }), 200);
    espera(await api('PATCH', `/usuarios/${idOperador}/bloqueo`, { token: tAdmin, cuerpo: { bloqueado: false } }), 200);
    await login('operador.financiero@monify.dev', CLAVE_SEMILLA, 'pc-oficina-operador');
    return `${abiertas.length} alertas cerradas; el operador vuelve a entrar con un token nuevo`;
  });

  console.log('\n8. Controles en la base de datos (paso 8 y conservación)');
  if (!process.env.DATABASE_URL) {
    omitidas += 1;
    console.log('  - omitido: define DATABASE_URL para probar los triggers directamente en PostgreSQL');
  } else {
    const bd = new Client({ connectionString: process.env.DATABASE_URL });
    await bd.connect();
    try {
      await prueba('paso 8: un UPDATE sobre UserLogs es rechazado', async () => rechazaEnBd(bd, `UPDATE "UserLogs" SET "accion" = 'nada' WHERE "idUsuario" = $1`, [Number(idOperador)]));
      await prueba('paso 8: un DELETE sobre UserLogs es rechazado', async () => rechazaEnBd(bd, 'DELETE FROM "UserLogs" WHERE "idUsuario" = $1', [Number(idOperador)]));
      await prueba('ni siquiera activando el modo de depuración se borra un registro vigente', async () => rechazaEnBd(bd,
        `SELECT set_config('monify.depuracion', 'plazo_vencido', true); DELETE FROM "UserLogs" WHERE "idUsuario" = ${Number(idOperador)}`));
      await prueba('las alertas no se borran ni se reescriben', async () => {
        await rechazaEnBd(bd, 'DELETE FROM "AlertaSeguridad" WHERE "idAlerta" = $1', [Number(alertaA2.id)]);
        return rechazaEnBd(bd, `UPDATE "AlertaSeguridad" SET "descripcion" = 'nada' WHERE "idAlerta" = $1`, [Number(alertaA2.id)]);
      });
      await prueba('la depuración borra solo lo que superó los 5 años y deja constancia', async () => {
        const plazo = (await bd.query('SELECT fn_plazo_conservacion()::text AS p')).rows[0].p;
        const solicitud = (await api('POST', '/derechos/solicitudes', { token: tAna, cuerpo: { tipo: 'acceso' } })).datos.solicitud.id;
        await api('POST', `/derechos/solicitudes/${solicitud}/desistir`, { token: tAna });
        await bd.query('BEGIN');
        try {
          await bd.query(`INSERT INTO "HistorialSolicitudDerecho" ("idSolicitudDerecho", "estadoNuevo", "fecha", "actor", "canal")
                          VALUES ($1, 'recibida', now() - interval '7 years', 'prueba', 'api')`, [Number(solicitud)]);
          const r = (await bd.query('SELECT * FROM fn_depurar_registros_vencidos()')).rows;
          const constancia = (await bd.query(`SELECT * FROM "DepuracionRegistros" WHERE "tabla" = 'HistorialSolicitudDerecho' ORDER BY "idDepuracion" DESC LIMIT 1`)).rows[0];
          assert.deepEqual(r.map((f) => `${f.tabla}:${f.eliminados}`), ['HistorialSolicitudDerecho:1']);
          assert.equal(constancia.registrosEliminados, 1);
          return `plazo ${plazo}; registro de hace 7 años eliminado y constancia creada (transacción revertida)`;
        } finally {
          await bd.query('ROLLBACK');
        }
      });
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
