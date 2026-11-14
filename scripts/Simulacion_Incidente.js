// Simula una consulta masiva del operador y guarda toda la evidencia en JSON.
// Requiere la API levantada y PostgreSQL disponible en el entorno de desarrollo.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PUERTO ?? 3000}`;
const CONTRASENA = process.env.SEED_CONTRASENA || 'Monify2026!';
const DISPOSITIVO = `simulacion-incidente-${Date.now()}`;
const IDENTIFICADOR_CORRIDA = Date.now() % 8_000_000;
const RESULTADO = path.join(__dirname, 'resultado_simulacion.json');
const pasos = [];

async function api(metodo, ruta, opciones = {}) {
  const respuesta = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      'x-canal': opciones.canal ?? 'api',
      'x-dispositivo': opciones.dispositivo ?? DISPOSITIVO,
      ...(opciones.token ? { authorization: `Bearer ${opciones.token}` } : {}),
      ...(opciones.motivo ? { 'x-motivo-acceso': opciones.motivo } : {})
    },
    body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo)
  });
  const texto = await respuesta.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  return { estado: respuesta.status, datos };
}

function registrarPaso(nombre, esperado, respuesta) {
  const resultado = { nombre, esperado, estado: respuesta.estado, datos: respuesta.datos };
  pasos.push(resultado);
  return resultado;
}

async function login(correo, dispositivo = DISPOSITIVO) {
  const respuesta = await api('POST', '/auth/login', {
    cuerpo: { correo, contrasena: CONTRASENA }, dispositivo
  });
  assert.equal(respuesta.estado, 200, `login fallido para ${correo}: ${JSON.stringify(respuesta.datos)}`);
  return respuesta.datos;
}

async function crearTitular(indice, versionTerminos) {
  const respuesta = await api('POST', '/usuarios', {
    dispositivo: 'simulacion-incidente-datos',
    cuerpo: {
      nombre: `Titular Simulacion ${indice}`,
      correo: `simulacion.incidente.${Date.now()}.${indice}@prueba.dev`,
      rut: `${10_000_000 + IDENTIFICADOR_CORRIDA + indice}-${indice % 10}`,
      fechaNacimiento: '1990-01-01',
      contrasena: CONTRASENA,
      versionTerminos,
      aceptaTerminos: true,
      aceptaTratamientoDatos: true,
      aceptaEvaluacionCrediticia: true
    }
  });
  assert.equal(respuesta.estado, 201, `titular ${indice}: ${JSON.stringify(respuesta.datos)}`);
  return respuesta.datos;
}

async function rechazarOperacionBD(cliente, sql, parametros) {
  await cliente.query('BEGIN');
  try {
    await cliente.query(sql, parametros);
    throw new Error('la base de datos acepto una operacion protegida');
  } catch (error) {
    if (error.message === 'la base de datos acepto una operacion protegida') throw error;
    return error.message.split('\n')[0];
  } finally {
    await cliente.query('ROLLBACK');
  }
}

async function guardarResultado(resultado) {
  await fs.writeFile(RESULTADO, `${JSON.stringify(resultado, null, 2)}\n`, 'utf8');
}

async function main() {
  const inicio = new Date(Date.now() - 1000).toISOString();
  const resultado = {
    incidente: 'Consulta masiva de perfiles por operador',
    iniciadoEn: new Date().toISOString(),
    baseUrl: BASE,
    dispositivo: DISPOSITIVO,
    pasos,
    alertas: [],
    baseDatos: {},
    lineaTiempo: null,
    revisiones: [],
    errores: []
  };

  try {
    const terminos = await api('GET', '/terminos');
    assert.equal(terminos.estado, 200, 'no se pudo consultar la version de terminos');
    const [admin, auditor] = await Promise.all([
      login('admin@monify.dev', 'pc-admin-simulacion'),
      login('auditor@monify.dev', 'pc-auditor-simulacion')
    ]);
    // Un login previo permite que el siguiente acceso desde DISPOSITIVO dispare A3.
    await login('operador.financiero@monify.dev', 'pc-oficina-operador');
    const operador = await login('operador.financiero@monify.dev', DISPOSITIVO);
    const idOperador = Number(operador.usuario.id);
    const titulares = [];
    for (let indice = 1; indice <= 25; indice += 1) {
      titulares.push(await crearTitular(indice, terminos.datos.version));
    }
    registrarPaso('1. Operador inicia sesion desde dispositivo nuevo', 200, {
      estado: 200,
      datos: { usuarioId: idOperador, dispositivo: DISPOSITIVO }
    });

    const accesoSinVerificar = await api('GET', `/transacciones?usuarioId=${titulares[0].id}`, {
      token: operador.accessToken, motivo: 'Simulacion de incidente autorizada', dispositivo: DISPOSITIVO
    });
    registrarPaso('2. A3 bloquea el primer acceso desde dispositivo nuevo', 403, accesoSinVerificar);
    assert.equal(accesoSinVerificar.estado, 403);
    const verificacion = await api('POST', '/auth/verificacion-adicional', {
      token: operador.accessToken, cuerpo: { contrasena: CONTRASENA }, dispositivo: DISPOSITIVO
    });
    registrarPaso('3. Operador completa verificacion adicional', 200, verificacion);
    assert.equal(verificacion.estado, 200);

    let exitosas = 0;
    let denegadas = 0;
    let revocadas = 0;
    for (let indice = 0; indice < 25; indice += 1) {
      const esRechazoIntencional = indice < 5;
      const titular = esRechazoIntencional ? titulares[0] : titulares[indice - 5];
      const ruta = esRechazoIntencional
        ? `/informacion-financiera?usuarioId=${titular.id}`
        : `/transacciones?usuarioId=${titular.id}`;
      const respuesta = await api('GET', ruta, {
        token: operador.accessToken,
        motivo: 'Simulacion de incidente autorizada',
        dispositivo: DISPOSITIVO
      });
      if (respuesta.estado === 200) exitosas += 1;
      if (respuesta.estado === 403) denegadas += 1;
      if (respuesta.estado === 401) revocadas += 1;
    }
    registrarPaso('4. A2 contiene al superar 10 titulares en 1 minuto', { exitosas: 11, denegadas: 5, revocadas: 9 }, {
      estado: exitosas === 11 && denegadas === 5 && revocadas === 9 ? 200 : 500,
      datos: { consultas: 25, titularesExpuestos: 11, exitosas, denegadas, revocadas }
    });

    const logs = await api('GET', `/auditoria/logs?usuarioId=${idOperador}&desde=${inicio}&limite=200`, { token: auditor.accessToken });
    registrarPaso('5. Sistema registra las consultas en UserLogs', 200, logs);

    const alertas = await api('GET', '/auditoria/alertas', { token: auditor.accessToken });
    resultado.alertas = alertas.datos.filter((alerta) => alerta.usuarioId === String(idOperador) && new Date(alerta.creadaEn) >= new Date(inicio));
    registrarPaso('6. Alertas de acceso anomalo', ['A2', 'A3', 'A4'], {
      estado: alertas.estado,
      datos: resultado.alertas
    });
    const alertaA2 = resultado.alertas.find((alerta) => alerta.codigo === 'A2');
    assert.ok(alertaA2, 'no se genero la alerta A2');

    const tokenRevocado = await api('GET', '/usuarios/me', { token: operador.accessToken });
    registrarPaso('7. Contencion automatica invalida el token', 401, tokenRevocado);
    assert.equal(tokenRevocado.estado, 401);
    const loginBloqueado = await api('POST', '/auth/login', {
      cuerpo: { correo: 'operador.financiero@monify.dev', contrasena: CONTRASENA }, dispositivo: DISPOSITIVO
    });
    registrarPaso('8. El login posterior queda rechazado', 403, loginBloqueado);

    const auditoria = await api('GET', `/auditoria/logs?usuarioId=${idOperador}&desde=${inicio}&limite=200`, { token: auditor.accessToken });
    registrarPaso('9. Auditor filtra logs por actor y rango', 200, auditoria);

    const final = new Date(Date.now() + 1000).toISOString();
    const linea = await api('GET', `/auditoria/linea-tiempo?usuarioId=${idOperador}&adminRiesgoId=${admin.usuario.id}&desde=${inicio}&hasta=${final}`, { token: auditor.accessToken });
    assert.equal(linea.estado, 200, JSON.stringify(linea.datos));
    const huellaCalculada = createHash('sha256').update(JSON.stringify(linea.datos.eventos)).digest('hex');
    assert.equal(linea.datos.cadenaDeCustodia.huella, huellaCalculada);
    resultado.lineaTiempo = {
      estado: linea.estado,
      totalEventos: linea.datos.totalEventos,
      eventos: linea.datos.eventos,
      filtros: linea.datos.filtros,
      cadenaDeCustodia: linea.datos.cadenaDeCustodia,
      huellaCalculada,
      huellaCoincide: true
    };
    registrarPaso('10. Exportacion con SHA-256 y firma RSA', 200, resultado.lineaTiempo);

    for (const alerta of resultado.alertas) {
      const revisada = await api('PATCH', `/auditoria/alertas/${alerta.id}`, {
        token: auditor.accessToken,
        cuerpo: { estado: 'revisada', nota: 'Auditor revisa la evidencia y confirma la contencion aplicada.' }
      });
      const cerrada = await api('PATCH', `/auditoria/alertas/${alerta.id}`, {
        token: auditor.accessToken,
        cuerpo: { estado: 'cerrada', nota: 'Incidente documentado; sin inferir intencion del actor.' }
      });
      assert.equal(revisada.estado, 200, JSON.stringify(revisada.datos));
      assert.equal(cerrada.estado, 200, JSON.stringify(cerrada.datos));
      resultado.revisiones.push(cerrada.datos);
    }
    resultado.alertas = resultado.revisiones;
    registrarPaso('11. Auditor revisa y cierra A2, A3 y A4', 200, { estado: 200, datos: resultado.revisiones });

    const cliente = new Client({ connectionString: process.env.DATABASE_URL });
    await cliente.connect();
    try {
      resultado.baseDatos.update = await rechazarOperacionBD(cliente,
        'UPDATE "UserLogs" SET "accion" = \'incidente.alterado\' WHERE "idUsuario" = $1', [idOperador]);
      resultado.baseDatos.delete = await rechazarOperacionBD(cliente,
        'DELETE FROM "UserLogs" WHERE "idUsuario" = $1', [idOperador]);
    } finally {
      await cliente.end();
    }
    registrarPaso('12. UPDATE y DELETE sobre UserLogs son rechazados', 'dos errores del trigger de inmutabilidad', {
      estado: 200,
      datos: resultado.baseDatos
    });
    resultado.finalizadoEn = new Date().toISOString();
    resultado.estado = 'completado';
  } catch (error) {
    resultado.estado = 'fallido';
    resultado.errores.push({ mensaje: error.message, pila: error.stack });
  } finally {
    await guardarResultado(resultado);
  }

  console.log(`Resultado guardado en ${RESULTADO}`);
  console.log(JSON.stringify({ estado: resultado.estado, alertas: resultado.alertas.map((a) => a.codigo), errores: resultado.errores }, null, 2));
  if (resultado.estado !== 'completado') process.exitCode = 1;
}

main().catch(async (error) => {
  await guardarResultado({ estado: 'fallido', errores: [{ mensaje: error.message, pila: error.stack }] });
  console.error(error);
  process.exitCode = 1;
});