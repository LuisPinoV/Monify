// Panel de Monify. Cada vista se muestra según los permisos del rol (RBAC); el backend vuelve a validar todo.

// ---------------------------------------------------------------- utilidades
const formatCurrency = (amount) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(amount) || 0);
const formatDate = (value, conHora = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CL', conHora
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (selector, root = document) => root.querySelector(selector);
const contar = (n) => `${n} ${n === 1 ? 'registro' : 'registros'}`;
const emptyRow = (colspan, message = 'Todavía no hay registros.') => `<tr><td colspan="${colspan}" class="empty-state">${message}</td></tr>`;

const ROLES = {
  admin: 'Admin', usuario: 'Usuario', administrador_riesgo: 'Administrador de riesgo', auditor: 'Auditor', operador_financiero: 'Operador financiero'
};
const ESTADO_VERIFICACION = { pendiente: 'Pendiente', en_revision: 'En revisión', verificada: 'Verificada', rechazada: 'Rechazada' };
const ESTADO_SOLICITUD = { recibida: 'Recibida', en_evaluacion: 'En evaluación', aprobada: 'Aprobada', rechazada: 'Rechazada' };
const REGLAS = {
  denegado: 'Denegado', propio: 'Solo propio', permitido: 'Permitido', necesidad: 'Según necesidad', autorizacion: 'Con autorización expresa'
};
const ACCIONES = {
  'info_financiera.ver': 'Ver información financiera', 'perfil.actualizar': 'Actualizar / modificar perfil', 'billetera.ver': 'Ver billetera',
  'historial.ver': 'Ver historial de movimientos', 'deuda.ver': 'Ver deuda', 'transaccion.crear': 'Realizar transacción',
  'solicitud_credito.crear': 'Crear solicitud de crédito', 'solicitud_credito.aprobar': 'Aprobar solicitud de crédito',
  'roles.gestionar': 'Gestionar roles y permisos', 'claves.acceder': 'Acceso a claves criptográficas', 'cuenta.crear': 'Crear cuentas',
  'logs.revisar': 'Revisar logs del sistema', 'usuarios.listar': 'Listar cuentas (seudonimizadas)', 'tarjeta.agregar': 'Agregar tarjeta',
  'solicitud_credito.ver': 'Ver solicitudes de crédito', 'credito.gestionar': 'Gestionar catálogo de créditos', 'riesgo.registrar': 'Registrar riesgo y deudas',
  'kyc.ver': 'Ver verificación de identidad', 'kyc.registrar': 'Registrar verificación de identidad',
  'consentimiento.gestionar': 'Gestionar consentimientos', 'autorizacion.gestionar': 'Otorgar autorizaciones de acceso',
  'derechos.ejercer': 'Ejercer derechos (acceso, rectificación, supresión)', 'derechos.supervisar': 'Supervisar solicitudes de derechos'
};
const AMBITOS = { financiera: 'Información financiera', movimientos: 'Historial de movimientos', deuda: 'Deudas', logs: 'Logs del sistema' };
const FINALIDADES = {
  terminos_y_condiciones: 'Términos y Condiciones', tratamiento_datos_personales: 'Tratamiento de datos personales', evaluacion_crediticia: 'Evaluación crediticia'
};
const ESTADO_CONSENTIMIENTO = { otorgado: 'Otorgado', revocado: 'Revocado', reemplazado: 'Reemplazado (versión anterior)', pendiente: 'Pendiente', rechazado: 'Rechazado' };
const TIPO_DERECHO = { acceso: 'Acceso y portabilidad', rectificacion: 'Rectificación', supresion: 'Supresión' };
const ESTADO_DERECHO = {
  recibida: 'Recibida', verificada: 'Identidad verificada', en_evaluacion: 'En evaluación', ejecutada: 'Ejecutada', rechazada: 'Rechazada', cerrada: 'Cerrada'
};
const CAMPOS_RECTIFICACION = { nombre: 'Nombre', numeroCelular: 'Celular', correo: 'Correo', rentaMensual: 'Renta mensual' };

const S = {
  token: sessionStorage.getItem('monify.accessToken'),
  sesion: JSON.parse(sessionStorage.getItem('monify.sesion') || 'null'),
  permisos: {},
  terminos: null,
  cuentas: [],
  consentimiento: null,
  codigos: {}
};

const regla = (accion) => S.permisos[accion] ?? 'denegado';
const puede = (accion) => regla(accion) !== 'denegado';
const esTitular = () => S.sesion?.rol === 'usuario';
const usaMotivo = () => Object.values(S.permisos).includes('necesidad');
// Titular al que le falta (o revocó) un consentimiento: solo puede usar Mis derechos (el backend lo exige igual).
const restringido = () => esTitular() && S.consentimiento !== null && !S.consentimiento.completo;

// ---------------------------------------------------------------- API
// Canal y dispositivo viajan en cada petición: la bitácora los registra (no se guarda la IP).
function encabezados(extra = {}) {
  const motivo = $('#motivo-acceso')?.value.trim();
  return {
    Accept: 'application/json', 'X-Canal': 'web', 'X-Dispositivo': navigator.userAgent.slice(0, 160),
    ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}),
    ...(motivo ? { 'X-Motivo-Acceso': motivo } : {}),
    ...extra
  };
}

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: encabezados(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && S.token && path !== '/auth/login') {
    cerrarSesion();
    throw new Error('tu sesión expiró o fue bloqueada; vuelve a iniciar sesión');
  }
  if (response.status === 403 && payload.codigo === 'CONSENTIMIENTO_REQUERIDO' && S.token) {
    await actualizarConsentimiento();
    abrirConsentimiento();
  }
  if (!response.ok) {
    const mensaje = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
    throw new Error(mensaje || `${path}: ${response.status}`);
  }
  return payload;
}
const getData = (path) => api('GET', path);
const postData = (path, body = {}) => api('POST', path, body);
const patchData = (path, body = {}) => api('PATCH', path, body);
const deleteData = (path, body) => api('DELETE', path, body);

let toastTimer;
function showToast(message, type = 'success') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast toast-${type} visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3800);
}

// ---------------------------------------------------------------- piezas de interfaz
const heading = (eyebrow, titulo, descripcion) => `
  <section class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${titulo}</h1><p>${descripcion}</p></div></section>`;

const panel = (eyebrow, titulo, cuerpo, { contador, clase = 'table-panel' } = {}) => `
  <article class="panel ${clase}">
    <div class="panel-heading"><div><div class="eyebrow">${eyebrow}</div><h2>${titulo}</h2></div>${contador !== undefined ? `<span class="panel-count">${contar(contador)}</span>` : ''}</div>
    ${cuerpo}
  </article>`;

const tabla = (columnas, filas, vacio) => `
  <div class="table-responsive"><table class="table data-table mb-0">
    <thead><tr>${columnas.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${filas.length ? filas.join('') : emptyRow(columnas.length, vacio)}</tbody>
  </table></div>`;

const formulario = (id, campos, boton) => `
  <form class="form-grid" id="${id}"><div class="form-error d-none"></div>${campos}<button class="btn btn-primary" type="submit">${boton}</button></form>`;

const campo = (etiqueta, input) => `<label class="field"><span>${etiqueta}</span>${input}</label>`;
const reglaChip = (valor) => `<span class="regla regla-${valor}">${REGLAS[valor] ?? valor}</span>`;
const cuentaNombre = (id) => {
  const cuenta = S.cuentas.find((c) => c.cuenta === 'usuario' && c.id === String(id));
  return cuenta ? `#${id} · ${escapeHtml(cuenta.nombre)}` : `#${id}`;
};
const selectorTitulares = (name = 'usuarioId', requerido = true) => S.cuentas.length
  ? `<select name="${name}" ${requerido ? 'required' : ''}>${requerido ? '' : '<option value="">Todos los permitidos</option>'}${S.cuentas
    .filter((c) => c.cuenta === 'usuario' && c.rol === 'usuario' && c.estadoCuenta === 'activa')
    .map((c) => `<option value="${c.id}">#${c.id} · ${escapeHtml(c.nombre)}</option>`).join('')}</select>`
  : `<input type="number" name="${name}" min="1" step="1" ${requerido ? 'required' : ''} placeholder="ID del titular">`;

// Casilla de no repudio: muestra el texto exacto que queda firmado en la base de datos.
function casillaNoRepudio(accion) {
  const texto = S.terminos?.confirmaciones?.textos?.[accion] ?? 'Confirmo esta acción.';
  return `<div class="confirmacion">
    <label class="field checkbox-field"><input type="checkbox" name="confirmacionNoRepudio" required><span>${escapeHtml(texto)}</span></label>
    <small class="confirmacion-nota">Se guardará como evidencia firmada (quién, cuándo, canal y dispositivo).</small>
  </div>`;
}

function bindForm(id, handler, { reset = true } = {}) {
  const form = document.getElementById(id);
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = $('.form-error', form);
    const boton = $('button[type="submit"]', form);
    errorBox?.classList.add('d-none');
    boton.disabled = true;
    try {
      const mensaje = await handler(new FormData(form), form);
      if (reset) form.reset();
      showToast(typeof mensaje === 'string' ? mensaje : 'Guardado correctamente');
    } catch (error) {
      if (errorBox) { errorBox.textContent = error.message; errorBox.classList.remove('d-none'); }
      showToast(error.message, 'error');
    } finally {
      boton.disabled = false;
    }
  });
}

const numeroOpcional = (valor) => (valor === null || valor === '' ? undefined : Number(valor));
const marcado = (data, nombre) => data.get(nombre) === 'on';

// ---------------------------------------------------------------- vistas
async function vistaResumen() {
  const perfil = await getData('/usuarios/me');
  const pagina = $('#page-resumen');
  const datosCuenta = [
    ['Rol', ROLES[perfil.rol] ?? perfil.rol], ['Nombre', perfil.nombre], ['Correo', perfil.correo], ['RUT', perfil.rut],
    ['Celular', perfil.numeroCelular ?? '—'],
    ...(perfil.rol === 'usuario' ? [['Mayor de edad', perfil.esMayorEdad ? 'Sí' : 'No'], ['Tramo de renta', perfil.tramoRentaEtiqueta ?? 'No informado']] : []),
    ['Cuenta creada', formatDate(perfil.creadoEn)]
  ];
  let extra = '';
  if (puede('billetera.ver')) {
    const billetera = await getData('/billeteras');
    extra = `<section class="metric-grid">
      <article class="metric-card balance-card"><div class="metric-topline"><span>Saldo disponible</span><span class="metric-icon icon-mint">$</span></div>
        <div class="metric-value">${formatCurrency(billetera.saldo)}</div><div class="metric-caption">Suma de tus tarjetas</div><div class="balance-decoration" aria-hidden="true"></div></article>
      <article class="metric-card"><div class="metric-topline"><span>Tarjetas</span><span class="metric-icon icon-coral">◇</span></div>
        <div class="metric-value">${billetera.tarjetas.length}</div><div class="metric-caption">Asociadas a tu billetera</div></article>
    </section>`;
  }
  const filasPermisos = Object.entries(S.permisos).map(([accion, valor]) => `<tr><td>${ACCIONES[accion] ?? accion}</td><td>${reglaChip(valor)}</td></tr>`);
  pagina.innerHTML = `${heading('VISTA GENERAL', `Hola, ${escapeHtml(perfil.nombre.split(' ')[0])}`, 'Tus datos personales solo los ves tú: el personal de Monify ve seudónimos.')}
    ${extra}
    <section class="content-grid content-grid-form">
      ${panel('MI CUENTA', 'Datos de la cuenta', tabla(['Campo', 'Valor'], datosCuenta.map(([k, v]) => `<tr><td>${k}</td><td>${escapeHtml(v)}</td></tr>`)), { clase: 'form-panel' })}
      ${panel('RBAC', `Permisos del rol ${ROLES[perfil.rol] ?? perfil.rol}`, tabla(['Acción o recurso', 'Regla'], filasPermisos))}
    </section>
    ${esTitular() ? `<section class="content-grid">${panel('MIS DATOS', '¿Algún dato está incorrecto?', `<p class="mb-0">La corrección de tus datos, la copia de tu información y la eliminación de la cuenta se piden en <a href="#/derechos">Mis derechos</a>, con verificación de identidad.</p>`, { clase: 'form-panel' })}</section>` : ''}`;
}

async function vistaBilletera() {
  const [billetera, bancos] = await Promise.all([getData('/billeteras'), getData('/bancos')]);
  const pagina = $('#page-billetera');
  const filas = billetera.tarjetas.map((t) => `<tr><td>#${t.id}</td><td>${escapeHtml(t.banco)}</td><td class="mono">${escapeHtml(t.numeroEnmascarado)}</td><td class="amount">${formatCurrency(t.saldo)}</td></tr>`);
  pagina.innerHTML = `${heading('FONDOS', 'Mi billetera', 'Solo guardamos el número de tus tarjetas (cifrado). El CVV y la fecha de vencimiento los valida el procesador de pagos.')}
    <section class="content-grid content-grid-form">
      ${panel('NUEVA TARJETA', 'Agregar tarjeta', formulario('tarjeta-form', `
        ${campo('Banco', `<select name="bancoId" required>${bancos.map((b) => `<option value="${b.id}">${escapeHtml(b.nombre)}</option>`).join('')}</select>`)}
        ${campo('Número de tarjeta', '<input type="text" name="numeroTarjeta" inputmode="numeric" placeholder="4111 1111 1111 1111" required>')}`, 'Agregar tarjeta'), { clase: 'form-panel' })}
      ${panel('TARJETAS', `Saldo total ${formatCurrency(billetera.saldo)}`, tabla(['ID', 'Banco', 'Número', 'Saldo'], filas, 'Agrega una tarjeta para operar.'), { contador: filas.length })}
    </section>
    <section class="content-grid content-grid-form">
      ${panel('OPERAR', 'Realizar transacción', billetera.tarjetas.length ? formulario('transaccion-form', `
        ${campo('Tarjeta', `<select name="tarjetaId" required>${billetera.tarjetas.map((t) => `<option value="${t.id}">${escapeHtml(t.banco)} ${escapeHtml(t.numeroEnmascarado)} · ${formatCurrency(t.saldo)}</option>`).join('')}</select>`)}
        ${campo('Tipo', '<select name="tipo"><option value="abono">Abono (ingreso)</option><option value="cargo">Cargo (pago o retiro)</option></select>')}
        ${campo('Monto (CLP)', '<input type="number" name="monto" min="1" step="1" required>')}
        ${casillaNoRepudio('transaccion.crear')}`, 'Confirmar transacción') : '<div class="empty-state">Primero agrega una tarjeta.</div>', { clase: 'form-panel' })}
    </section>`;
  bindForm('tarjeta-form', async (data) => {
    await postData('/tarjetas', { bancoId: data.get('bancoId'), numeroTarjeta: data.get('numeroTarjeta') });
    await vistaBilletera();
    return 'Tarjeta agregada';
  });
  bindForm('transaccion-form', async (data) => {
    const r = await postData('/transacciones', {
      tarjetaId: data.get('tarjetaId'), tipo: data.get('tipo'), monto: Number(data.get('monto')), confirmacionNoRepudio: marcado(data, 'confirmacionNoRepudio')
    });
    await vistaBilletera();
    return `Transacción registrada. Evidencia ${r.evidenciaId?.slice(0, 8) ?? ''}…`;
  });
}

async function vistaMovimientos() {
  const pagina = $('#page-movimientos');
  const filtro = new URLSearchParams(location.hash.split('?')[1] ?? '').get('usuarioId') ?? '';
  const query = filtro ? `?usuarioId=${encodeURIComponent(filtro)}` : '';
  const [transacciones, deudas] = await Promise.all([
    puede('historial.ver') ? getData(`/transacciones${query}`) : Promise.resolve(null),
    puede('deuda.ver') ? getData(`/deudas${query}`) : Promise.resolve(null)
  ]);
  const ajeno = !esTitular();
  const filtroHtml = ajeno ? `<form class="form-grid filtro-inline" id="filtro-movimientos">${campo('Filtrar por titular', selectorTitulares('usuarioId', false))}<button class="btn btn-primary" type="submit">Filtrar</button></form>` : '';
  pagina.innerHTML = `${heading('HISTORIAL', 'Movimientos', ajeno
    ? `Tu acceso: historial ${reglaChip(regla('historial.ver'))} · deudas ${reglaChip(regla('deuda.ver'))}. Cada consulta queda en la bitácora.`
    : 'Tus transacciones y deudas registradas.')}
    ${filtroHtml}
    <section class="content-grid">
      ${transacciones ? panel('TRANSACCIONES', 'Historial', tabla(['ID', ...(ajeno ? ['Titular'] : []), 'Tarjeta', 'Fecha', 'Monto', 'Evidencia'], transacciones.map((t) => `<tr><td>#${t.id}</td>${ajeno ? `<td>${cuentaNombre(t.usuarioId)}</td>` : ''}<td>#${t.tarjetaId}</td><td class="activity-date">${formatDate(t.creadaEn, true)}</td><td class="amount">${formatCurrency(t.monto)}</td><td class="mono">${t.evidenciaId ? escapeHtml(t.evidenciaId.slice(0, 8)) + '…' : '—'}</td></tr>`), ajeno ? 'Sin movimientos a los que tengas acceso.' : undefined), { contador: transacciones.length }) : ''}
      ${deudas ? panel('DEUDAS', 'Deudas registradas', tabla(['ID', ...(ajeno ? ['Titular'] : []), 'Fecha', 'Monto'], deudas.map((d) => `<tr><td>#${d.id}</td>${ajeno ? `<td>${cuentaNombre(d.usuarioId)}</td>` : ''}<td class="activity-date">${formatDate(d.creadaEn)}</td><td class="amount">${formatCurrency(d.monto)}</td></tr>`)), { contador: deudas.length }) : ''}
    </section>
    ${puede('riesgo.registrar') ? `<section class="content-grid content-grid-form">${panel('NUEVO REGISTRO', 'Registrar deuda', formulario('deuda-form', `${campo('Titular', selectorTitulares())}${campo('Monto (CLP)', '<input type="number" name="monto" min="1" step="1" required>')}`, 'Registrar deuda'), { clase: 'form-panel' })}</section>` : ''}`;
  if (filtro) { const select = $('#filtro-movimientos [name="usuarioId"]'); if (select) select.value = filtro; }
  $('#filtro-movimientos')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const valor = new FormData(event.currentTarget).get('usuarioId');
    location.hash = `#/movimientos${valor ? `?usuarioId=${valor}` : ''}`;
  });
  bindForm('deuda-form', async (data) => {
    await postData('/deudas', { usuarioId: data.get('usuarioId'), monto: Number(data.get('monto')) });
    await vistaMovimientos();
    return 'Deuda registrada';
  });
}

async function vistaCreditos() {
  const pagina = $('#page-creditos');
  const [creditos, solicitudes] = await Promise.all([
    getData('/creditos'), puede('solicitud_credito.ver') ? getData('/solicitudes-credito') : Promise.resolve([])
  ]);
  const ajeno = !esTitular();
  const resolvibles = solicitudes.filter((s) => s.estado === 'recibida' || s.estado === 'en_evaluacion');
  pagina.innerHTML = `${heading('LÍNEAS DE CRÉDITO', 'Créditos', esTitular()
    ? 'Solicita una línea de crédito. Tu solicitud será evaluada por el equipo de riesgo.'
    : `Tu acceso: aprobar ${reglaChip(regla('solicitud_credito.aprobar'))} · ver solicitudes ${reglaChip(regla('solicitud_credito.ver'))}.`)}
    <section class="content-grid content-grid-form">
      ${puede('credito.gestionar') ? panel('CATÁLOGO', 'Crear crédito', formulario('credito-form', `${campo('Monto (CLP)', '<input type="number" name="monto" min="1" step="1" required>')}${campo('Tasa de interés mensual (%)', '<input type="number" name="tasaInteres" min="0" step="0.01" required>')}`, 'Crear crédito'), { clase: 'form-panel' }) : ''}
      ${puede('solicitud_credito.crear') ? panel('NUEVA SOLICITUD', 'Solicitar crédito', creditos.length ? formulario('solicitud-form', `
        ${campo('Crédito', `<select name="creditoId" required>${creditos.map((c) => `<option value="${c.id}" data-monto="${c.monto}">#${c.id} · ${formatCurrency(c.monto)} · ${Number(c.tasaInteres)}%</option>`).join('')}</select>`)}
        ${campo('Monto solicitado (CLP)', '<input type="number" name="montoSolicitado" min="1" step="1" required>')}
        ${casillaNoRepudio('solicitud_credito.crear')}`, 'Enviar solicitud') : '<div class="empty-state">No hay créditos disponibles.</div>', { clase: 'form-panel' }) : ''}
      ${panel('CATÁLOGO', 'Créditos disponibles', tabla(['ID', 'Monto', 'Tasa'], creditos.map((c) => `<tr><td>#${c.id}</td><td class="amount">${formatCurrency(c.monto)}</td><td>${Number(c.tasaInteres)}%</td></tr>`)), { contador: creditos.length })}
    </section>
    <section class="content-grid content-grid-form">
      ${puede('solicitud_credito.aprobar') ? panel('RESOLUCIÓN', 'Resolver solicitud', resolvibles.length ? formulario('resolver-form', `
        ${campo('Solicitud', `<select name="id" required>${resolvibles.map((s) => `<option value="${s.id}">#${s.id} · ${cuentaNombre(s.usuarioId)} · ${formatCurrency(s.montoSolicitado)}</option>`).join('')}</select>`)}
        ${campo('Decisión', '<select name="estado"><option value="en_evaluacion">Pasar a evaluación</option><option value="aprobada">Aprobar</option><option value="rechazada">Rechazar</option></select>')}
        ${casillaNoRepudio('solicitud_credito.resolver').replace('required', '')}
        <small class="confirmacion-nota">La casilla es obligatoria para aprobar o rechazar.</small>`, 'Registrar decisión') : '<div class="empty-state">No hay solicitudes pendientes.</div>', { clase: 'form-panel' }) : ''}
      ${puede('solicitud_credito.ver') ? panel('SOLICITUDES', ajeno ? 'Solicitudes de crédito' : 'Mis solicitudes', tabla(['ID', ...(ajeno ? ['Titular'] : []), 'Crédito', 'Monto', 'Estado', 'Fecha'], solicitudes.map((s) => `<tr><td>#${s.id}</td>${ajeno ? `<td>${cuentaNombre(s.usuarioId)}</td>` : ''}<td>#${s.creditoId}</td><td class="amount">${formatCurrency(s.montoSolicitado)}</td><td><span class="badge badge-${s.estado === 'aprobada' ? 'verificada' : s.estado === 'rechazada' ? 'rechazada' : 'en_revision'}">${ESTADO_SOLICITUD[s.estado] ?? s.estado}</span></td><td class="activity-date">${formatDate(s.creadaEn)}</td></tr>`)), { contador: solicitudes.length }) : ''}
    </section>`;
  $('#solicitud-form [name="creditoId"]')?.addEventListener('change', (event) => {
    $('#solicitud-form [name="montoSolicitado"]').value = event.target.selectedOptions[0].dataset.monto;
  });
  $('#solicitud-form [name="creditoId"]')?.dispatchEvent(new Event('change'));
  bindForm('credito-form', async (data) => {
    await postData('/creditos', { monto: Number(data.get('monto')), tasaInteres: Number(data.get('tasaInteres')) });
    await vistaCreditos();
    return 'Crédito creado';
  });
  bindForm('solicitud-form', async (data) => {
    await postData('/solicitudes-credito', {
      creditoId: data.get('creditoId'), montoSolicitado: Number(data.get('montoSolicitado')),
      confirmacionNoRepudio: marcado(data, 'confirmacionNoRepudio')
    });
    await vistaCreditos();
    return 'Solicitud enviada';
  });
  bindForm('resolver-form', async (data) => {
    await patchData(`/solicitudes-credito/${data.get('id')}/estado`, { estado: data.get('estado'), confirmacionNoRepudio: marcado(data, 'confirmacionNoRepudio') });
    await vistaCreditos();
    return 'Decisión registrada';
  });
}

async function vistaRiesgo() {
  const pagina = $('#page-riesgo');
  const [verificaciones, consultas] = await Promise.all([
    puede('kyc.ver') ? getData('/verificaciones-identidad') : Promise.resolve(null),
    puede('info_financiera.ver') ? getData('/consultas-riesgo').catch((error) => ({ error: error.message })) : Promise.resolve(null)
  ]);
  const errorConsultas = consultas?.error;
  const ajeno = !esTitular();
  pagina.innerHTML = `${heading('CUMPLIMIENTO', 'Verificación y riesgo', 'Los tiempos de mora y de deuda se guardan por tramos y el monto exacto de deuda no se almacena (minimización).')}
    <section class="content-grid content-grid-form">
      ${puede('kyc.registrar') ? panel('KYC', 'Registrar verificación', formulario('verificacion-form', `
        ${campo('Titular', selectorTitulares())}
        ${campo('Estado', `<select name="estado">${Object.entries(ESTADO_VERIFICACION).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`)}
        ${campo('Método (opcional)', '<input type="text" name="metodo" placeholder="documento, biometría…">')}
        ${campo('Fecha de expiración (opcional)', '<input type="date" name="fechaExpiracion">')}
        ${campo('Comprobante del verificador (solo se guarda su hash)', '<input type="text" name="comprobante">')}`, 'Registrar verificación'), { clase: 'form-panel' }) : ''}
      ${verificaciones ? panel('KYC', 'Verificaciones de identidad', tabla(['ID', ...(ajeno ? ['Titular'] : []), 'Estado', 'Método', 'Verificada', 'Expira'], verificaciones.map((v) => `<tr><td>#${v.id}</td>${ajeno ? `<td>${cuentaNombre(v.usuarioId)}</td>` : ''}<td><span class="badge badge-${v.estado}">${ESTADO_VERIFICACION[v.estado] ?? v.estado}</span></td><td>${escapeHtml(v.metodo ?? '—')}</td><td>${formatDate(v.fechaVerificacion)}</td><td>${formatDate(v.fechaExpiracion)}</td></tr>`)), { contador: verificaciones.length }) : ''}
    </section>
    <section class="content-grid content-grid-form">
      ${puede('riesgo.registrar') ? panel('BURÓ DE CRÉDITO', 'Registrar consulta de riesgo', formulario('riesgo-form', `
        ${campo('Titular', selectorTitulares())}
        ${campo('Score (opcional)', '<input type="number" name="score" min="0" step="1">')}
        <label class="field checkbox-field"><input type="checkbox" name="morosidad"><span>Presenta morosidad</span></label>
        ${campo('Días de morosidad (se guarda el tramo)', '<input type="number" name="diasMorosidad" min="0" step="1">')}
        ${campo('Días en deuda (se guarda el tramo)', '<input type="number" name="diasEnDeuda" min="0" step="1">')}`, 'Registrar consulta'), { clase: 'form-panel' }) : ''}
      ${errorConsultas ? panel('RIESGO', 'Consultas de riesgo', `<div class="empty-state">${/X-Motivo-Acceso/.test(errorConsultas) ? 'Escribe un motivo de acceso (arriba a la derecha) y presiona Actualizar para ver las consultas de otros titulares.' : escapeHtml(errorConsultas)}</div>`) : ''}
      ${consultas && !errorConsultas ? panel('RIESGO', 'Consultas de riesgo', tabla(['ID', ...(ajeno ? ['Titular'] : []), 'Score', 'Morosidad', 'Tramo de mora', 'Tramo en deuda', 'Fecha'], consultas.map((c) => `<tr><td>#${c.id}</td>${ajeno ? `<td>${cuentaNombre(c.usuarioId)}</td>` : ''}<td>${c.score ?? '—'}</td><td><span class="badge ${c.morosidad ? 'badge-rechazada' : 'badge-verificada'}">${c.morosidad ? 'Sí' : 'No'}</span></td><td>${escapeHtml(c.tiempoDeMorosidadEtiqueta ?? '—')}</td><td>${escapeHtml(c.tiempoEnDeudaEtiqueta ?? '—')}</td><td>${formatDate(c.consultadaEn)}</td></tr>`), ajeno ? 'Sin consultas a las que tengas acceso.' : undefined), { contador: consultas.length }) : ''}
    </section>
    ${puede('info_financiera.ver') && ajeno ? `<section class="content-grid content-grid-form">
      ${panel('FICHA', 'Información financiera de un titular', `${formulario('info-form', campo('Titular', selectorTitulares()), 'Consultar')}<div id="info-resultado"></div>`, { clase: 'form-panel' })}</section>` : ''}`;
  bindForm('verificacion-form', async (data) => {
    const cuerpo = { usuarioId: data.get('usuarioId'), estado: data.get('estado'), fechaVerificacion: new Date().toISOString() };
    if (data.get('metodo')) cuerpo.metodo = data.get('metodo');
    if (data.get('fechaExpiracion')) cuerpo.fechaExpiracion = new Date(data.get('fechaExpiracion')).toISOString();
    if (data.get('comprobante')) cuerpo.comprobante = data.get('comprobante');
    await postData('/verificaciones-identidad', cuerpo);
    await vistaRiesgo();
    return 'Verificación registrada';
  });
  bindForm('riesgo-form', async (data) => {
    await postData('/consultas-riesgo', {
      usuarioId: data.get('usuarioId'), morosidad: marcado(data, 'morosidad'), score: numeroOpcional(data.get('score')),
      diasMorosidad: numeroOpcional(data.get('diasMorosidad')), diasEnDeuda: numeroOpcional(data.get('diasEnDeuda'))
    });
    await vistaRiesgo();
    return 'Consulta registrada';
  });
  bindForm('info-form', async (data) => {
    const info = await getData(`/informacion-financiera?usuarioId=${encodeURIComponent(data.get('usuarioId'))}`);
    $('#info-resultado').innerHTML = tabla(['Dato', 'Valor'], [
      ['Tramo de renta', info.tramoRentaEtiqueta ?? '—'], ['Saldo total', formatCurrency(info.saldoTotal)],
      ['Último score', info.ultimaConsultaRiesgo?.score ?? '—'], ['Créditos vigentes', info.creditosVigentes], ['Solicitudes en curso', info.solicitudesEnCurso]
    ].map(([k, v]) => `<tr><td>${k}</td><td>${escapeHtml(v)}</td></tr>`));
    return 'Acceso registrado en la bitácora';
  }, { reset: false });
}

const badge = (clave, texto) => `<span class="badge badge-${clave}">${escapeHtml(texto ?? clave)}</span>`;

async function vistaPrivacidad() {
  const pagina = $('#page-privacidad');
  const [estado, historial, autorizaciones, beneficiarios] = await Promise.all([
    getData('/consentimientos'), getData('/consentimientos/historial'), getData('/autorizaciones'), getData('/autorizaciones/beneficiarios')
  ]);
  S.consentimiento = estado;
  const nombreBeneficiario = (id) => {
    const b = beneficiarios.find((x) => x.id === String(id));
    return b ? `${escapeHtml(b.nombre)} (${ROLES[b.rol]})` : `#${id}`;
  };
  const vigentes = estado.finalidades.filter((f) => f.vigente);
  pagina.innerHTML = `${heading('CONSENTIMIENTO', 'Privacidad y consentimientos', 'Cada finalidad se otorga y se revoca por separado. Si revocas una, solo podrás usar Mis derechos hasta que la vuelvas a otorgar.')}
    <section class="content-grid">
      ${panel('ESTADO ACTUAL', `Consentimientos (versión ${escapeHtml(estado.versionVigente)})`, tabla(['Finalidad', 'Estado', 'Versión', 'Canal', 'Otorgado', 'Revocado'], estado.finalidades.map((f) => `<tr>
        <td><strong>${FINALIDADES[f.finalidad] ?? escapeHtml(f.finalidad)}</strong><br><small class="confirmacion-nota">${escapeHtml(f.descripcion)}</small></td>
        <td>${badge(f.estado, ESTADO_CONSENTIMIENTO[f.estado])}</td><td>${escapeHtml(f.versionTexto ?? '—')}</td><td>${escapeHtml(f.canal ?? '—')}</td>
        <td class="activity-date">${formatDate(f.otorgadoEl, true)}</td><td class="activity-date">${formatDate(f.revocadoEl, true)}</td></tr>`)), { contador: estado.finalidades.length })}
    </section>
    <section class="content-grid content-grid-form">
      ${panel('REVOCACIÓN', 'Revocar un consentimiento', vigentes.length ? formulario('revocar-form', `
        ${campo('Finalidad', `<select name="finalidad">${vigentes.map((f) => `<option value="${f.finalidad}">${FINALIDADES[f.finalidad] ?? f.finalidad}</option>`).join('')}</select>`)}
        ${casillaNoRepudio('consentimiento.revocar')}`, 'Revocar') : '<div class="empty-state">No tienes consentimientos vigentes.</div>', { clase: 'form-panel' })}
      ${panel('HISTORIAL', 'Cambios de estado de tus consentimientos', tabla(['#', 'Fecha y hora', 'Finalidad', 'Acción', 'Cambio', 'Versión', 'Canal', 'Dispositivo'], historial.map((e) => `<tr>
        <td class="mono">${e.idEvento}</td><td class="activity-date">${formatDate(e.fechaHora, true)}</td><td>${FINALIDADES[e.finalidad] ?? escapeHtml(e.finalidad)}</td>
        <td>${badge(e.accion, ESTADO_CONSENTIMIENTO[e.accion])}</td><td class="mono">${escapeHtml(e.estadoAnterior ?? '∅')} → ${escapeHtml(e.estadoNuevo ?? '∅')}</td>
        <td>${escapeHtml(e.versionTexto)}</td><td>${escapeHtml(e.canal)}</td><td title="${escapeHtml(e.dispositivo)}">${escapeHtml(e.dispositivo.slice(0, 32))}</td></tr>`)), { contador: historial.length })}
    </section>
    <section class="content-grid content-grid-form">
      ${panel('AUTORIZACIÓN EXPRESA', 'Autorizar acceso a mis datos', beneficiarios.length ? formulario('autorizacion-form', `
        ${campo('Persona del equipo', `<select name="beneficiarioId" required>${beneficiarios.map((b) => `<option value="${b.id}">${escapeHtml(b.nombre)} · ${ROLES[b.rol]}</option>`).join('')}</select>`)}
        ${campo('Qué puede ver', `<select name="ambito">${['financiera', 'movimientos', 'deuda'].map((a) => `<option value="${a}">${AMBITOS[a]}</option>`).join('')}</select>`)}
        ${campo('Duración (horas, máximo 72)', '<input type="number" name="horas" min="1" max="72" value="24" required>')}`, 'Otorgar autorización') : '<div class="empty-state">No hay personal que requiera autorización.</div>', { clase: 'form-panel' })}
      ${panel('AUTORIZACIONES', 'Autorizaciones otorgadas', tabla(['ID', 'Beneficiario', 'Ámbito', 'Expira', 'Estado', ''], autorizaciones.map((a) => `<tr><td>#${a.id}</td><td>${nombreBeneficiario(a.beneficiarioId)}</td><td>${AMBITOS[a.ambito] ?? a.ambito}</td><td>${formatDate(a.expiraEn, true)}</td><td>${a.vigente ? '<span class="badge badge-verificada">Vigente</span>' : '<span class="badge badge-rechazada">No vigente</span>'}</td><td>${a.vigente ? `<button class="btn-mini" data-revocar-autorizacion="${a.id}">Revocar</button>` : ''}</td></tr>`)), { contador: autorizaciones.length })}
    </section>`;
  $('#revocar-form button[type="submit"]')?.classList.add('btn-peligro');
  bindForm('revocar-form', async (data) => {
    S.consentimiento = await postData(`/consentimientos/${data.get('finalidad')}/revocar`, { confirmacionNoRepudio: marcado(data, 'confirmacionNoRepudio') });
    construirNavegacion();
    abrirConsentimiento();
    return 'Consentimiento revocado: la fecha y hora quedaron registradas';
  });
  pagina.querySelectorAll('[data-revocar-autorizacion]').forEach((boton) => boton.addEventListener('click', async () => {
    try { await deleteData(`/autorizaciones/${boton.dataset.revocarAutorizacion}`); showToast('Autorización revocada'); await vistaPrivacidad(); } catch (error) { showToast(error.message, 'error'); }
  }));
  bindForm('autorizacion-form', async (data) => {
    await postData('/autorizaciones', { beneficiarioId: data.get('beneficiarioId'), ambito: data.get('ambito'), horas: Number(data.get('horas')) });
    await vistaPrivacidad();
    return 'Autorización otorgada';
  });
}

// ---------------------------------------------------------------- ejercicio de derechos (Actividad 5, parte 2)
const flujoSolicitud = (historial) => `<div class="flujo">${historial.map((h) => `<span class="paso" title="${escapeHtml(h.actor)} · ${escapeHtml(h.canal)}">${ESTADO_DERECHO[h.estadoNuevo] ?? h.estadoNuevo}<small>${formatDate(h.fecha, true).split(', ').pop()}</small></span>`).join('→')}</div>`;
const estadoSolicitud = (s) => s.estado === 'cerrada' && s.resultado ? `${badge('cerrada', 'Cerrada')} ${badge(s.resultado === 'ejecutada' ? 'ejecutada' : s.resultado === 'desistida' ? 'desistida' : 'rechazada', s.resultado)}` : badge(s.estado, ESTADO_DERECHO[s.estado]);

async function vistaDerechos(seleccion) {
  const pagina = $('#page-derechos');
  const solicitudes = await getData('/derechos/solicitudes');
  const porVerificar = solicitudes.filter((s) => s.estado === 'recibida');
  const elegida = porVerificar.find((s) => s.id === seleccion) ?? porVerificar[0];
  const codigo = elegida ? S.codigos[elegida.id] : undefined;
  pagina.innerHTML = `${heading('TUS DERECHOS', 'Mis derechos', 'Acceso y portabilidad, rectificación y supresión de tus datos. Cada solicitud pasa por recepción, verificación de identidad, evaluación, ejecución o respuesta fundamentada y cierre. Respondemos dentro de 30 días corridos.')}
    ${restringido() ? `<div class="alert alert-warning aviso-consentimiento"><span>Te falta otorgar ${S.consentimiento.pendientes.length} consentimiento(s). Mientras tanto solo puedes usar este módulo.</span><button class="btn btn-primary" type="button" id="abrir-consentimiento">Otorgar consentimiento</button></div>` : ''}
    <section class="content-grid content-grid-form">
      ${panel('1 · RECEPCIÓN', 'Nueva solicitud', formulario('derecho-form', `
        ${campo('Derecho', `<select name="tipo">${Object.entries(TIPO_DERECHO).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`)}
        <div class="campos-rectificacion d-none" data-tipo="rectificacion">
          ${campo('Nombre completo (opcional)', '<input type="text" name="nombre" maxlength="200">')}
          ${campo('Celular (opcional)', '<input type="text" name="numeroCelular" maxlength="20" placeholder="+56912345678">')}
          ${campo('Correo (opcional; requiere código)', '<input type="email" name="correo">')}
          ${campo('Renta mensual (opcional; se guarda el tramo)', '<input type="number" name="rentaMensual" min="0" step="1">')}
          <small class="confirmacion-nota">El RUT no se rectifica en línea: es el identificador validado por la verificación de identidad.</small>
        </div>
        <div class="campos-rectificacion d-none" data-tipo="supresion">
          <p class="confirmacion-nota mb-0">Se ejecuta solo si tu saldo es $0 y no tienes deudas, créditos ni solicitudes en curso; si no, recibirás una respuesta fundamentada. Es irreversible.</p>
          ${casillaNoRepudio('cuenta.eliminar').replace(' required', '')}
        </div>
        <small class="confirmacion-nota" data-tipo-nota>Acceso: se pide tu contraseña y un código enviado a tu correo.</small>`, 'Enviar solicitud'), { clase: 'form-panel' })}
      ${panel('2 · VERIFICACIÓN', 'Verificar mi identidad', elegida ? formulario('verificar-form', `
        ${campo('Solicitud', `<select name="id">${porVerificar.map((s) => `<option value="${s.id}" ${s.id === elegida.id ? 'selected' : ''}>#${s.id} · ${TIPO_DERECHO[s.tipo]}</option>`).join('')}</select>`)}
        ${campo('Contraseña', '<input type="password" name="contrasena" required autocomplete="current-password">')}
        ${elegida.nivelVerificacion === 'contrasena_y_codigo' ? campo('Código de 6 dígitos', '<input type="text" name="codigo" inputmode="numeric" maxlength="6" required>') : ''}
        ${codigo ? `<small class="confirmacion-nota">Código enviado a ${escapeHtml(codigo.destino)}${codigo.valor ? ` · entorno de desarrollo (sin servidor de correo): <span class="codigo-desarrollo">${escapeHtml(codigo.valor)}</span>` : ''}</small>` : ''}
        <small class="confirmacion-nota">${elegida.nivelVerificacion === 'contrasena' ? 'Riesgo bajo: basta tu contraseña.' : 'Riesgo alto: contraseña y código de un solo uso (10 minutos, máximo 5 intentos).'} No pedimos documentos ni datos adicionales.</small>`, 'Verificar y procesar') : '<div class="empty-state">No tienes solicitudes esperando verificación.</div>', { clase: 'form-panel' })}
    </section>
    <section class="content-grid">
      ${panel('3 · SEGUIMIENTO', 'Mis solicitudes', tabla(['ID', 'Derecho', 'Estado', 'Recibida', 'Plazo', 'Flujo y respuesta', ''], solicitudes.map((s) => `<tr>
        <td>#${s.id}</td><td>${TIPO_DERECHO[s.tipo]}${s.camposSolicitados ? `<br><small class="confirmacion-nota">${s.camposSolicitados.map((c) => CAMPOS_RECTIFICACION[c] ?? c).join(', ')}</small>` : ''}</td>
        <td>${estadoSolicitud(s)}</td><td class="activity-date">${formatDate(s.recibidaEn, true)}</td><td class="activity-date">${formatDate(s.plazoRespuesta)}</td>
        <td>${flujoSolicitud(s.historial)}${s.respuesta ? `<div class="respuesta-derecho">${escapeHtml(s.respuesta)}</div>` : ''}</td>
        <td><div class="acciones-fila">${s.tipo === 'acceso' && s.estado === 'ejecutada' ? `<button class="btn-mini" data-descargar="${s.id}">Descargar copia</button>` : ''}${['recibida', 'verificada'].includes(s.estado) ? `<button class="btn-mini" data-desistir="${s.id}">Desistir</button>` : ''}</div></td></tr>`), 'Aún no has presentado solicitudes.'), { contador: solicitudes.length })}
    </section>`;
  const tipo = $('#derecho-form [name="tipo"]');
  const notas = { acceso: 'Acceso: se pide tu contraseña y un código enviado a tu correo.', rectificacion: 'Rectificación: basta tu contraseña (si cambias el correo, también un código enviado al correo nuevo).', supresion: 'Supresión: contraseña, código enviado a tu correo y casilla de confirmación.' };
  tipo.addEventListener('change', () => {
    pagina.querySelectorAll('[data-tipo]').forEach((bloque) => bloque.classList.toggle('d-none', bloque.dataset.tipo !== tipo.value));
    $('[data-tipo-nota]', pagina).textContent = notas[tipo.value];
  });
  $('#verificar-form [name="id"]')?.addEventListener('change', (event) => vistaDerechos(event.target.value));
  $('#abrir-consentimiento')?.addEventListener('click', abrirConsentimiento);
  bindForm('derecho-form', async (data) => {
    const cuerpo = { tipo: data.get('tipo') };
    if (cuerpo.tipo === 'rectificacion') {
      cuerpo.cambios = {};
      for (const campoRect of ['nombre', 'numeroCelular', 'correo']) if (data.get(campoRect)) cuerpo.cambios[campoRect] = data.get(campoRect);
      if (data.get('rentaMensual')) cuerpo.cambios.rentaMensual = Number(data.get('rentaMensual'));
    }
    if (cuerpo.tipo === 'supresion') cuerpo.confirmacionNoRepudio = marcado(data, 'confirmacionNoRepudio');
    const r = await postData('/derechos/solicitudes', cuerpo);
    if (r.verificacion.codigoEnviadoA) S.codigos[r.solicitud.id] = { destino: r.verificacion.codigoEnviadoA, valor: r.verificacion.codigoDesarrollo };
    await vistaDerechos(r.solicitud.id);
    return `Solicitud #${r.solicitud.id} recibida. Ahora verifica tu identidad.`;
  });
  bindForm('verificar-form', async (data) => {
    const id = data.get('id');
    const r = await postData(`/derechos/solicitudes/${id}/verificar`, { contrasena: data.get('contrasena'), codigo: data.get('codigo') ?? undefined });
    delete S.codigos[id];
    if (r.sesionCerrada) { cerrarSesion(); return 'Tu cuenta fue eliminada y tus datos anonimizados.'; }
    await vistaDerechos();
    return `Solicitud #${id}: ${r.solicitud.resultado ?? ESTADO_DERECHO[r.solicitud.estado]}`;
  });
  pagina.querySelectorAll('[data-desistir]').forEach((boton) => boton.addEventListener('click', async () => {
    try { await postData(`/derechos/solicitudes/${boton.dataset.desistir}/desistir`); showToast('Desististe de la solicitud'); await vistaDerechos(); } catch (error) { showToast(error.message, 'error'); }
  }));
  pagina.querySelectorAll('[data-descargar]').forEach((boton) => boton.addEventListener('click', async () => {
    try {
      const copia = await getData(`/derechos/solicitudes/${boton.dataset.descargar}/descarga`);
      const enlace = document.createElement('a');
      enlace.href = URL.createObjectURL(new Blob([JSON.stringify(copia, null, 2)], { type: 'application/json' }));
      enlace.download = `monify-mis-datos-${boton.dataset.descargar}.json`;
      enlace.click();
      URL.revokeObjectURL(enlace.href);
      showToast(`Copia descargada (SHA-256 ${copia.integridad.huella.slice(0, 12)}…). La solicitud quedó cerrada.`);
      await vistaDerechos();
    } catch (error) { showToast(error.message, 'error'); }
  }));
}

async function vistaSupervision() {
  const solicitudes = await getData('/derechos/supervision');
  $('#page-supervision').innerHTML = `${heading('CUMPLIMIENTO', 'Solicitudes de derechos', 'Seguimiento de estados y plazos. No se muestran los datos pedidos ni las respuestas: solo el titular los ve.')}
    <section class="content-grid">${panel('SUPERVISIÓN', 'Solicitudes', tabla(['ID', 'Titular', 'Derecho', 'Estado', 'Verificación', 'Canal', 'Recibida', 'Cerrada', 'Plazo'], solicitudes.map((s) => `<tr>
      <td>#${s.id}</td><td>${cuentaNombre(s.usuarioId)}</td><td>${TIPO_DERECHO[s.tipo]}</td><td>${estadoSolicitud(s)}</td><td>${escapeHtml(s.nivelVerificacion)}</td><td>${escapeHtml(s.canal)}</td>
      <td class="activity-date">${formatDate(s.recibidaEn, true)}</td><td class="activity-date">${formatDate(s.cerradaEn, true)}</td>
      <td>${s.fueraDePlazo ? badge('rechazada', 'Fuera de plazo') : formatDate(s.plazoRespuesta)}</td></tr>`)), { contador: solicitudes.length })}</section>`;
}

async function vistaAdministracion() {
  const pagina = $('#page-administracion');
  const [cuentas, matriz] = await Promise.all([getData('/usuarios'), puede('roles.gestionar') ? getData('/rbac/matriz') : Promise.resolve(null)]);
  S.cuentas = cuentas;
  const personal = ['admin', 'administrador_riesgo', 'auditor', 'operador_financiero'];
  const cambiables = ['admin', 'auditor', 'operador_financiero'];
  const filas = cuentas.map((c) => {
    const acciones = c.estadoCuenta === 'activa' ? [
      `<button class="btn-mini" data-bloqueo="${c.id}" data-cuenta="${c.cuenta}" data-valor="${!c.bloqueada}">${c.bloqueada ? 'Desbloquear' : 'Bloquear'}</button>`,
      c.cuenta === 'usuario' && cambiables.includes(c.rol) ? `<select class="btn-mini" data-rol="${c.id}">${cambiables.map((r) => `<option value="${r}" ${r === c.rol ? 'selected' : ''}>${ROLES[r]}</option>`).join('')}</select>` : '',
      c.rol !== 'usuario' ? `<button class="btn-mini" data-contrasena="${c.id}" data-cuenta="${c.cuenta}">Nueva contraseña</button>` : ''
    ].join('') : '';
    return `<tr><td>#${c.id}</td><td>${escapeHtml(c.nombre)}</td><td>${ROLES[c.rol] ?? c.rol}</td><td>${c.estadoCuenta === 'activa' ? (c.bloqueada ? '<span class="badge badge-rechazada">Bloqueada</span>' : '<span class="badge badge-verificada">Activa</span>') : '<span class="badge badge-pendiente">Eliminada (anónima)</span>'}</td><td>${formatDate(c.creadoEn)}</td><td><div class="acciones-fila">${acciones}</div></td></tr>`;
  });
  const roles = matriz?.roles ?? [];
  pagina.innerHTML = `${heading('GESTIÓN', 'Administración', 'Creación de cuentas del personal, roles y bloqueos. Los nombres que ves son seudónimos: el Admin no accede a datos personales ni financieros.')}
    <section class="content-grid content-grid-form">
      ${puede('cuenta.crear') ? panel('NUEVA CUENTA', 'Crear cuenta del personal', formulario('cuenta-form', `
        ${campo('Rol', `<select name="rol">${personal.map((r) => `<option value="${r}">${ROLES[r]}</option>`).join('')}</select>`)}
        ${campo('Nombre completo', '<input type="text" name="nombre" required maxlength="200">')}
        ${campo('Correo', '<input type="email" name="correo" required>')}
        ${campo('RUT', '<input type="text" name="rut" required>')}
        ${campo('Contraseña inicial', '<input type="password" name="contrasena" minlength="8" required autocomplete="new-password">')}
        <small class="confirmacion-nota">La contraseña del administrador de riesgo se conserva solo 24 horas.</small>`, 'Crear cuenta'), { clase: 'form-panel' }) : ''}
      ${panel('CUENTAS', 'Cuentas (seudonimizadas)', tabla(['ID', 'Seudónimo', 'Rol', 'Estado', 'Creada', 'Acciones'], filas), { contador: cuentas.length })}
    </section>
    ${matriz ? `<section class="content-grid">${panel('RBAC', 'Matriz de permisos', tabla(['Acción o recurso', ...roles.map((r) => ROLES[r])], matriz.acciones.map((a) => `<tr><td>${ACCIONES[a] ?? a}</td>${roles.map((r) => `<td>${reglaChip(matriz.matriz[a][r])}</td>`).join('')}</tr>`)))}</section>` : ''}`;
  bindForm('cuenta-form', async (data) => {
    await postData('/admin/cuentas', Object.fromEntries(data));
    await vistaAdministracion();
    return 'Cuenta creada';
  });
  pagina.querySelectorAll('[data-bloqueo]').forEach((boton) => boton.addEventListener('click', async () => {
    try {
      await patchData(`/usuarios/${boton.dataset.bloqueo}/bloqueo`, { bloqueado: boton.dataset.valor === 'true', cuenta: boton.dataset.cuenta });
      showToast('Estado de la cuenta actualizado'); await vistaAdministracion();
    } catch (error) { showToast(error.message, 'error'); }
  }));
  pagina.querySelectorAll('[data-rol]').forEach((select) => select.addEventListener('change', async () => {
    try { await patchData(`/admin/usuarios/${select.dataset.rol}/rol`, { rol: select.value }); showToast('Rol actualizado'); } catch (error) { showToast(error.message, 'error'); }
    await vistaAdministracion();
  }));
  pagina.querySelectorAll('[data-contrasena]').forEach((boton) => boton.addEventListener('click', async () => {
    const contrasena = window.prompt('Nueva contraseña (mínimo 8 caracteres):');
    if (!contrasena) return;
    try { await postData(`/admin/cuentas/${boton.dataset.contrasena}/contrasena`, { cuenta: boton.dataset.cuenta, contrasena }); showToast('Contraseña restablecida'); } catch (error) { showToast(error.message, 'error'); }
  }));
}

async function vistaAuditoria() {
  const pagina = $('#page-auditoria');
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  params.set('limite', params.get('limite') || '100');
  let logs; let evidencias; let error;
  try {
    [logs, evidencias] = await Promise.all([getData(`/auditoria/logs?${params}`), getData('/auditoria/evidencias?limite=50')]);
  } catch (fallo) { error = fallo.message; }
  const esAuditor = S.sesion.rol === 'auditor';
  const [autorizaciones, beneficiarios] = esAuditor ? await Promise.all([getData('/autorizaciones'), getData('/autorizaciones/beneficiarios')]) : [[], []];
  const actor = (l) => l.usuarioId ? `U#${l.usuarioId}` : l.adminRiesgoId ? `AR#${l.adminRiesgoId}` : 'anónimo';
  const resultadoBadge = (r) => `<span class="badge badge-${r === 'exito' ? 'verificada' : r === 'denegado' ? 'pendiente' : 'rechazada'}">${escapeHtml(r)}</span>`;
  pagina.innerHTML = `${heading('SEGURIDAD', 'Auditoría y no repudio', 'Bitácora de solo anexado con hash encadenado: quién, qué acción, cuándo, por qué canal y desde qué dispositivo. Los detalles se guardan cifrados.')}
    ${error ? `<div class="alert alert-warning">${escapeHtml(error)}</div>` : `
    <form class="form-grid filtro-inline" id="filtro-logs">
      ${campo('ID de titular', `<input type="number" name="usuarioId" min="1" value="${escapeHtml(params.get('usuarioId') ?? '')}">`)}
      ${campo('Acción', `<input type="text" name="accion" placeholder="transaccion.crear" value="${escapeHtml(params.get('accion') ?? '')}">`)}
      ${campo('Desde', `<input type="date" name="desde" value="${escapeHtml(params.get('desde') ?? '')}">`)}
      ${campo('Hasta', `<input type="date" name="hasta" value="${escapeHtml(params.get('hasta') ?? '')}">`)}
      <button class="btn btn-primary" type="submit">Filtrar</button>
      <button class="btn btn-refresh" type="button" id="integridad-button">Verificar integridad de la cadena</button>
    </form>
    <div id="integridad-resultado"></div>
    <section class="content-grid">
      ${panel('BITÁCORA', 'Registro de acciones', tabla(['#', 'Fecha', 'Actor', 'Acción', 'Resultado', 'Canal', 'Dispositivo', 'Recurso'], logs.map((l) => `<tr><td class="mono">${l.secuencia}</td><td class="activity-date">${formatDate(l.fechaAccion, true)}</td><td>${actor(l)}</td><td class="mono">${escapeHtml(l.accion)}</td><td>${resultadoBadge(l.resultado)}</td><td>${escapeHtml(l.canal)}</td><td title="${escapeHtml(l.dispositivo)}">${escapeHtml(l.dispositivo.slice(0, 40))}</td><td class="mono">${escapeHtml(l.recurso ?? '—')}</td></tr>`)), { contador: logs.length })}
    </section>
    <section class="content-grid">
      ${panel('NO REPUDIO', 'Evidencias firmadas', tabla(['Fecha', 'Actor', 'Acción', 'Recurso', 'Canal', 'Versión', 'Firma'], evidencias.map((e) => `<tr><td class="activity-date">${formatDate(e.confirmadoEn, true)}</td><td>${e.usuarioId ? `U#${e.usuarioId}` : `AR#${e.adminRiesgoId}`}</td><td class="mono">${escapeHtml(e.accion)}</td><td class="mono">${escapeHtml(e.recurso ?? '—')}</td><td>${escapeHtml(e.canal)}</td><td>${escapeHtml(e.versionTexto)}</td><td>${e.firmaValida ? '<span class="badge badge-verificada">Válida</span>' : '<span class="badge badge-rechazada">Inválida</span>'}</td></tr>`)), { contador: evidencias.length })}
    </section>`}
    ${esAuditor ? `<section class="content-grid content-grid-form">
      ${panel('AUTORIZACIÓN', 'Autorizar a un Admin a revisar logs', beneficiarios.length ? formulario('autorizacion-logs-form', `
        ${campo('Admin', `<select name="beneficiarioId">${beneficiarios.map((b) => `<option value="${b.id}">${escapeHtml(b.nombre)}</option>`).join('')}</select>`)}
        ${campo('Duración (horas, máximo 72)', '<input type="number" name="horas" min="1" max="72" value="8" required>')}`, 'Otorgar') : '<div class="empty-state">No hay administradores.</div>', { clase: 'form-panel' })}
      ${panel('AUTORIZACIONES', 'Autorizaciones de logs', tabla(['ID', 'Admin', 'Expira', 'Estado', ''], autorizaciones.map((a) => `<tr><td>#${a.id}</td><td>#${a.beneficiarioId}</td><td>${formatDate(a.expiraEn, true)}</td><td>${a.vigente ? '<span class="badge badge-verificada">Vigente</span>' : '<span class="badge badge-rechazada">No vigente</span>'}</td><td>${a.vigente ? `<button class="btn-mini" data-revocar-autorizacion="${a.id}">Revocar</button>` : ''}</td></tr>`)), { contador: autorizaciones.length })}
    </section>` : ''}`;
  $('#filtro-logs')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const filtros = new URLSearchParams();
    for (const [k, v] of new FormData(event.currentTarget)) if (v) filtros.set(k, k === 'hasta' ? `${v}T23:59:59` : v);
    location.hash = `#/auditoria?${filtros}`;
  });
  $('#integridad-button')?.addEventListener('click', async () => {
    try {
      const r = await getData('/auditoria/integridad');
      $('#integridad-resultado').innerHTML = r.valida
        ? `<div class="integridad integridad-ok">✓ Cadena íntegra: ${r.registrosVerificados} registros verificados.</div>`
        : `<div class="integridad integridad-error">✗ Cadena alterada en el registro #${escapeHtml(r.primerRegistroInvalido.secuencia)}: ${escapeHtml(r.primerRegistroInvalido.motivo)}</div>`;
    } catch (fallo) { showToast(fallo.message, 'error'); }
  });
  bindForm('autorizacion-logs-form', async (data) => {
    await postData('/autorizaciones', { beneficiarioId: data.get('beneficiarioId'), ambito: 'logs', horas: Number(data.get('horas')) });
    await vistaAuditoria();
    return 'Autorización otorgada';
  });
  pagina.querySelectorAll('[data-revocar-autorizacion]').forEach((boton) => boton.addEventListener('click', async () => {
    try { await deleteData(`/autorizaciones/${boton.dataset.revocarAutorizacion}`); showToast('Autorización revocada'); await vistaAuditoria(); } catch (fallo) { showToast(fallo.message, 'error'); }
  }));
}

async function vistaActividad() {
  const actividad = await getData('/usuarios/me/actividad');
  $('#page-actividad').innerHTML = `${heading('AUDITORÍA', 'Mi actividad', 'Todo lo que se hizo con tu cuenta: acción, fecha, canal y dispositivo.')}
    <section class="content-grid">${panel('BITÁCORA', 'Acciones registradas', tabla(['Fecha', 'Acción', 'Resultado', 'Canal', 'Dispositivo'], actividad.map((l) => `<tr><td class="activity-date">${formatDate(l.fechaAccion, true)}</td><td class="mono">${escapeHtml(l.accion)}</td><td>${escapeHtml(l.resultado)}</td><td>${escapeHtml(l.canal)}</td><td>${escapeHtml(l.dispositivo.slice(0, 60))}</td></tr>`)), { contador: actividad.length })}</section>`;
}

function htmlTerminos() {
  const t = S.terminos;
  if (!t) return '<div class="empty-state">No se pudieron cargar los términos.</div>';
  return `<p>${escapeHtml(t.introduccion)}</p>${t.secciones.map((s) => `<h3>${escapeHtml(s.titulo)}</h3><ul>${s.clausulas.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`).join('')}
    <p class="confirmacion-nota">Versión ${escapeHtml(t.version)}, vigente desde ${escapeHtml(t.vigenteDesde)}.</p>`;
}

async function vistaTerminos() {
  $('#page-terminos').innerHTML = `${heading('LEGAL', S.terminos?.titulo ?? 'Términos y Condiciones', `Versión ${escapeHtml(S.terminos?.version ?? '—')}`)}
    <section class="content-grid">${panel('TOS', 'Términos y Condiciones', `<div class="terminos-contenido">${htmlTerminos()}</div>`)}</section>`;
}

// ---------------------------------------------------------------- navegación según rol
const RUTAS = [
  { id: 'resumen', titulo: 'Resumen', icono: '⌂', vista: vistaResumen, visible: () => true },
  { id: 'billetera', titulo: 'Mi billetera', icono: '◇', vista: vistaBilletera, visible: () => puede('billetera.ver') },
  { id: 'movimientos', titulo: 'Movimientos', icono: '↕', vista: vistaMovimientos, visible: () => puede('historial.ver') || puede('deuda.ver') },
  { id: 'creditos', titulo: 'Créditos', icono: '%', vista: vistaCreditos, visible: () => puede('solicitud_credito.ver') || puede('credito.gestionar') || puede('solicitud_credito.crear') },
  { id: 'riesgo', titulo: 'Verificación y riesgo', icono: '◈', vista: vistaRiesgo, visible: () => puede('kyc.ver') || puede('info_financiera.ver') || puede('riesgo.registrar') },
  { id: 'privacidad', titulo: 'Privacidad y consentimientos', icono: '⚿', vista: vistaPrivacidad, visible: () => puede('consentimiento.gestionar') },
  { id: 'derechos', titulo: 'Mis derechos', icono: '⚖', vista: () => vistaDerechos(), visible: () => puede('derechos.ejercer'), sinConsentimiento: true },
  { id: 'supervision', titulo: 'Solicitudes de derechos', icono: '⚖', vista: vistaSupervision, visible: () => puede('derechos.supervisar') },
  { id: 'administracion', titulo: 'Administración', icono: '⚙', vista: vistaAdministracion, visible: () => puede('cuenta.crear') || puede('roles.gestionar') },
  { id: 'auditoria', titulo: 'Auditoría', icono: '☰', vista: vistaAuditoria, visible: () => puede('logs.revisar') },
  { id: 'actividad', titulo: 'Mi actividad', icono: '◷', vista: vistaActividad, visible: () => true },
  { id: 'terminos', titulo: 'Términos y Condiciones', icono: '§', vista: vistaTerminos, visible: () => true, sinConsentimiento: true }
];
const rutaDisponible = (r) => r.visible() && (!restringido() || r.sinConsentimiento);

function construirNavegacion() {
  $('#nav').innerHTML = RUTAS.filter(rutaDisponible)
    .map((r) => `<a class="nav-link" data-route="${r.id}" href="#/${r.id}"><span class="nav-icon">${r.icono}</span>${r.titulo}</a>`).join('');
  $('#session-role').textContent = ROLES[S.sesion.rol] ?? S.sesion.rol;
  $('#motivo-field').classList.toggle('d-none', !usaMotivo());
}

async function navigate() {
  if (!S.token) return;
  const id = location.hash.replace('#/', '').split('?')[0] || 'resumen';
  const ruta = RUTAS.find((r) => r.id === id && rutaDisponible(r)) ?? RUTAS.find(rutaDisponible);
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === `page-${ruta.id}`));
  document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.route === ruta.id));
  $('#breadcrumb-current').textContent = ruta.titulo;
  const boton = $('#refresh-button');
  boton.disabled = true;
  $('#load-warning').classList.add('d-none');
  try {
    // El personal ve las cuentas solo por seudónimo; se usan para mostrar a qué titular corresponde cada registro.
    if (!esTitular() && puede('usuarios.listar') && ruta.id !== 'administracion') S.cuentas = await getData('/usuarios').catch(() => []);
    await ruta.vista();
  } catch (error) {
    const faltaMotivo = /X-Motivo-Acceso/.test(error.message);
    $('#load-warning').textContent = faltaMotivo
      ? 'Tu rol accede a datos de otros titulares solo por necesidad: escribe un motivo de acceso (arriba a la derecha) y presiona Actualizar. El motivo queda en la bitácora.'
      : error.message;
    $('#load-warning').classList.remove('d-none');
    if (faltaMotivo) $('#motivo-acceso').focus();
  } finally {
    boton.disabled = false;
  }
  verificarServicio();
}

async function verificarServicio() {
  const dot = $('#service-dot');
  try {
    await getData('/salud');
    dot.className = 'status-dot is-online';
    $('#service-status').textContent = 'Servicio conectado';
  } catch {
    dot.className = 'status-dot is-offline';
    $('#service-status').textContent = 'Servicio no disponible';
  }
}

// ---------------------------------------------------------------- sesión
async function cargarTerminos() {
  try {
    S.terminos = await getData('/terminos');
    document.querySelectorAll('.version-terminos').forEach((el) => { el.textContent = S.terminos.version; });
    $('#terminos-contenido').innerHTML = htmlTerminos();
  } catch { /* los términos se reintentan al abrir el modal */ }
}

function abrirTerminos() {
  $('#terminos-contenido').innerHTML = htmlTerminos();
  $('#terminos-modal').classList.remove('d-none');
}

async function actualizarConsentimiento() {
  if (!esTitular()) { S.consentimiento = null; return; }
  const respuesta = await fetch('/consentimientos', { headers: encabezados() });
  S.consentimiento = respuesta.ok ? await respuesta.json() : S.consentimiento;
}

// Ventana posterior al login: una casilla por cada finalidad pendiente (no se puede cerrar sin decidir).
function abrirConsentimiento() {
  if (!restringido()) { $('#consentimiento-modal').classList.add('d-none'); return; }
  $('#consentimiento-finalidades').innerHTML = S.consentimiento.finalidades.filter((f) => !f.vigente).map((f) => `
    <label class="field checkbox-field"><input type="checkbox" name="${f.campo}"><span><strong>${FINALIDADES[f.finalidad] ?? escapeHtml(f.finalidad)}</strong>${f.estado === 'revocado' ? ' (revocado)' : ''}: ${escapeHtml(f.descripcion)}</span></label>`).join('');
  $('#consentimiento-modal').classList.remove('d-none');
}

async function iniciarAplicacion() {
  const { permisos } = await getData('/rbac/mis-permisos');
  S.permisos = permisos;
  await actualizarConsentimiento();
  $('#login-screen').classList.add('d-none');
  $('.app-shell').classList.remove('d-none');
  construirNavegacion();
  try {
    const perfil = await getData('/usuarios/me');
    $('#session-name').textContent = perfil.correo;
  } catch { $('#session-name').textContent = `#${S.sesion.id}`; }
  await navigate();
  abrirConsentimiento();
}

function cerrarSesion() {
  S.token = null; S.sesion = null; S.permisos = {}; S.cuentas = []; S.consentimiento = null; S.codigos = {};
  $('#consentimiento-modal').classList.add('d-none');
  sessionStorage.removeItem('monify.accessToken');
  sessionStorage.removeItem('monify.sesion');
  $('.app-shell').classList.add('d-none');
  $('#login-screen').classList.remove('d-none');
  $('.auth-tabs [data-tab="login"]').click();
}

function guardarSesion(respuesta) {
  S.token = respuesta.accessToken;
  S.sesion = respuesta.usuario;
  sessionStorage.setItem('monify.accessToken', S.token);
  sessionStorage.setItem('monify.sesion', JSON.stringify(S.sesion));
}

async function despuesDeLogin(respuesta) {
  guardarSesion(respuesta);
  if (respuesta.contrasenaExpiraEn) showToast(`Tu contraseña vence el ${formatDate(respuesta.contrasenaExpiraEn, true)} (vigencia de 24 horas).`);
  await iniciarAplicacion();
}

function initAcceso() {
  bindForm('login-form', async (data) => {
    const respuesta = await postData('/auth/login', Object.fromEntries(data));
    await despuesDeLogin(respuesta);
    return 'Sesión iniciada';
  });
  bindForm('registro-form', async (data) => {
    const cuerpo = {
      nombre: data.get('nombre'), correo: data.get('correo'), rut: data.get('rut'), fechaNacimiento: data.get('fechaNacimiento'),
      contrasena: data.get('contrasena'), versionTerminos: S.terminos?.version,
      aceptaTerminos: marcado(data, 'aceptaTerminos'), aceptaTratamientoDatos: marcado(data, 'aceptaTratamientoDatos'),
      aceptaEvaluacionCrediticia: marcado(data, 'aceptaEvaluacionCrediticia')
    };
    if (data.get('rentaMensual')) cuerpo.rentaMensual = Number(data.get('rentaMensual'));
    if (data.get('numeroCelular')) cuerpo.numeroCelular = data.get('numeroCelular');
    await postData('/usuarios', cuerpo);
    const respuesta = await postData('/auth/login', { correo: cuerpo.correo, contrasena: cuerpo.contrasena });
    await despuesDeLogin(respuesta);
    return 'Cuenta creada. Cada consentimiento quedó registrado por separado.';
  });
  bindForm('consentimiento-form', async (data) => {
    const cuerpo = { versionTerminos: S.terminos?.version };
    for (const f of S.consentimiento.finalidades.filter((x) => !x.vigente)) cuerpo[f.campo] = marcado(data, f.campo);
    S.consentimiento = await postData('/consentimientos/otorgar', cuerpo);
    construirNavegacion();
    abrirConsentimiento();
    await navigate();
    return S.consentimiento.completo ? 'Consentimiento otorgado: ya puedes usar Monify' : 'Consentimiento registrado; aún faltan finalidades por aceptar';
  });
  $('#consentimiento-rechazar').addEventListener('click', async () => {
    try { const r = await postData('/consentimientos/rechazar'); cerrarSesion(); showToast(r.mensaje, 'error'); } catch (error) { showToast(error.message, 'error'); }
  });
  $('#consentimiento-derechos').addEventListener('click', () => {
    $('#consentimiento-modal').classList.add('d-none');
    location.hash = '#/derechos';
    navigate();
  });
  document.querySelectorAll('[data-ver-terminos]').forEach((enlace) => enlace.addEventListener('click', (event) => { event.preventDefault(); abrirTerminos(); }));
  $('[data-cerrar-modal]').addEventListener('click', () => $('#terminos-modal').classList.add('d-none'));
  $('.auth-tabs').addEventListener('click', (event) => {
    const boton = event.target.closest('.tab-button');
    if (!boton) return;
    document.querySelectorAll('.auth-tabs .tab-button').forEach((b) => b.classList.toggle('active', b === boton));
    document.querySelectorAll('.auth-wrapper > .tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.tabPanel === boton.dataset.tab));
  });
}

initAcceso();
$('#logout-button').addEventListener('click', cerrarSesion);
$('#refresh-button').addEventListener('click', navigate);
window.addEventListener('hashchange', navigate);
cargarTerminos().then(() => {
  if (S.token && S.sesion) iniciarAplicacion().catch(cerrarSesion);
  else cerrarSesion();
});
