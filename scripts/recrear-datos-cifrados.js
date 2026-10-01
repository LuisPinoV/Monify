const { createCipheriv, randomBytes } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY || '', 'base64');

if (!databaseUrl) throw new Error('DATABASE_URL es obligatoria');
if (encryptionKey.length !== 32) throw new Error('ENCRYPTION_KEY debe ser base64 de 32 bytes');

function encryptPacked(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ciphertext.toString('base64')}`;
}

async function cifrarColumnas(client, tabla, columnas) {
  const seleccion = columnas.map((columna) => `"${columna}"`).join(', ');
  const filas = await client.query(`SELECT * FROM "${tabla}"`);
  for (const fila of filas.rows) {
    const cambios = {};
    const parametros = [];
    const condiciones = [];
    for (const columna of columnas) {
      const valor = fila[columna];
      if (valor !== null && valor !== undefined && !String(valor).startsWith('v1.')) {
        parametros.push(encryptPacked(valor));
        cambios[columna] = `$${parametros.length}`;
      }
    }
    if (Object.keys(cambios).length === 0) continue;
    const asignaciones = Object.entries(cambios)
      .map(([columna, parametro]) => `"${columna}" = ${parametro}`)
      .join(', ');
    parametros.push(fila[Object.keys(fila).find((key) => key.toLowerCase().startsWith('id'))]);
    const idParametro = `$${parametros.length}`;
    const idColumna = Object.keys(fila).find((key) => key.startsWith('id'));
    await client.query(`UPDATE "${tabla}" SET ${asignaciones} WHERE "${idColumna}" = ${idParametro}`, parametros);
  }
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    const schema = await readFile('db/init/01-monify_schema.sql', 'utf8');
    await client.query(schema);
    await client.query('TRUNCATE TABLE "UsuarioCredito", "SolicitudCredito", "Credito", "Deuda", "Transaccion", "ConsultaDeRiesgo", "VerificadorDeIdentidad", "credencialesAutenticacion", "Usuario", "TipoUsuario", "EstadoSolicitud" RESTART IDENTITY CASCADE');
    const seed = await readFile('db/seed/10-seed.sql', 'utf8');
    await client.query(seed);
    await client.query('BEGIN');
    await cifrarColumnas(client, 'Usuario', ['nombreCompleto', 'fechaNacimiento', 'Saldo', 'rentaMensual', 'numeroCelular']);
    await cifrarColumnas(client, 'VerificadorDeIdentidad', ['fechaVerificacion', 'fechaExpiracion', 'metodoDeVerificacion']);
    await cifrarColumnas(client, 'ConsultaDeRiesgo', ['ScoreDeRiesgo', 'morosidad', 'tiempoDeMorosidad', 'cantidadDeuda', 'tiempoEnDeuda']);
    await cifrarColumnas(client, 'Transaccion', ['montoTransaccion']);
    await cifrarColumnas(client, 'Deuda', ['montoDeuda']);
    await cifrarColumnas(client, 'Credito', ['montoCredito', 'tasaInteres']);
    await cifrarColumnas(client, 'UsuarioCredito', ['cuota', 'montoAcumulado', 'montoFinal']);
    await client.query('COMMIT');
    console.log('Datos generados desde db/seed/10-seed.sql y cifrados en sus columnas originales.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* el seed puede haber cerrado su transaccion */ }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
