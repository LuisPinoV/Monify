const assert = require('node:assert/strict');
const test = require('node:test');
const { sanitizarParametros, sanitizarRecurso, sanitizarTexto } = require('../dist/modulos/auditoria/sanitizador-auditoria');

test('redacta datos personales y credenciales en texto', () => {
  const resultado = sanitizarTexto('rut 11.111.111-1 correo ana@prueba.dev telefono +56912345678 tarjeta 4111111111111111');
  assert.equal(resultado, 'rut [redactado] correo [redactado] telefono [redactado] tarjeta [redactado]');
});

test('conserva ids internos y no conserva query strings', () => {
  assert.equal(
    sanitizarRecurso('GET /usuarios/11?correo=ana@prueba.dev', 'titular:11'),
    'GET /usuarios/11 titular:11'
  );
});

test('redacta datos personales incrustados en una ruta', () => {
  assert.equal(sanitizarRecurso('GET /usuarios/ana@prueba.dev', 'titular:11'), 'GET /usuarios/[redactado] titular:11');
});

test('redacta claves sensibles en parámetros', () => {
  assert.deepEqual(sanitizarParametros({ id: '22', correo: 'ana@prueba.dev', rut: '11.111.111-1' }), {
    id: '22', correo: '[redactado]', rut: '[redactado]'
  });
});