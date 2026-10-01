const formatCurrency = (amount) => new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0
}).format(Number(amount) || 0);

const formatDate = (value) => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sin fecha' : new Intl.DateTimeFormat('es-CL', {
    day: '2-digit', month: 'short', year: 'numeric'
  }).format(date);
};

const initials = (name = '') => String(name || '').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || '?';

const estadoVerificacionLabels = { pendiente: 'Pendiente', en_revision: 'En revisión', verificada: 'Verificada', rechazada: 'Rechazada' };
const estadoSolicitudLabels = { recibida: 'Recibida', en_evaluacion: 'En evaluación', aprobada: 'Aprobada', rechazada: 'Rechazada' };

const state = { users: [], creditos: [] };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function emptyRow(colspan, message = 'Todavía no hay registros.') {
  return `<tr><td colspan="${colspan}" class="empty-state">${message}</td></tr>`;
}

function userName(id) {
  const user = state.users.find((candidate) => String(candidate.id) === String(id));
  return user?.nombre || `Usuario #${id}`;
}

async function getData(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json', ...authHeaders() } });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

async function sendData(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders() },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.mensaje || `${path}: ${response.status}`);
  return payload;
}

function authHeaders() {
  const token = sessionStorage.getItem('monify.accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function mostrarAplicacion() {
  document.querySelector('#login-screen').classList.add('d-none');
  document.querySelector('.app-shell').classList.remove('d-none');
}

function mostrarLogin() {
  document.querySelector('#login-screen').classList.remove('d-none');
  document.querySelector('.app-shell').classList.add('d-none');
}

async function iniciarSesion(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = form.querySelector('.form-error');
  try {
    const response = await fetch('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || payload.mensaje || 'No se pudo iniciar sesión');
    sessionStorage.setItem('monify.accessToken', payload.accessToken);
    error.classList.add('d-none');
    mostrarAplicacion();
    navigate();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.classList.remove('d-none');
  }
}

const postData = (path, body) => sendData('POST', path, body);
const patchData = (path, body) => sendData('PATCH', path, body);

let toastTimer;
function showToast(message, type = 'success') {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.className = `toast toast-${type} visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

async function ensureUsers() {
  state.users = await getData('/usuarios');
  fillUserSelects();
  return state.users;
}

function fillUserSelects() {
  document.querySelectorAll('.user-select').forEach((select) => {
    const previous = select.value;
    select.innerHTML = '<option value="" disabled selected>Selecciona un usuario</option>' +
      state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.nombre)} · ${escapeHtml(user.rut)}</option>`).join('');
    if (previous && state.users.some((user) => String(user.id) === previous)) select.value = previous;
  });
}

function fillCreditoSelects() {
  document.querySelectorAll('.credito-select').forEach((select) => {
    const previous = select.value;
    select.innerHTML = '<option value="" disabled selected>Selecciona un crédito</option>' +
      state.creditos.map((credito) => `<option value="${credito.id}">#${credito.id} · ${formatCurrency(credito.monto)} · ${Number(credito.tasaInteres)}%</option>`).join('');
    if (previous && state.creditos.some((credito) => String(credito.id) === previous)) select.value = previous;
  });
}

function renderUsers(users, wallets) {
  const walletByUser = new Map(wallets.map((wallet) => [String(wallet.usuarioId), wallet]));
  const recentUsers = [...users].slice(-5).reverse();
  document.querySelector('#users-total').textContent = String(users.length);
  document.querySelector('#user-list').innerHTML = recentUsers.length
    ? recentUsers.map((user, index) => {
      const wallet = walletByUser.get(String(user.id));
      const balance = wallet ? formatCurrency(wallet.saldo) : formatCurrency(user.saldo);
      const name = user.nombre || `Usuario #${user.id}`;
      return `<div class="user-row">
        <span class="avatar avatar-${index % 4}">${escapeHtml(initials(name))}</span>
        <div class="user-details"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(user.correo || user.tipoUsuario || 'Usuario')}</span></div>
        <span class="user-balance">${balance}</span>
      </div>`;
    }).join('')
    : '<div class="empty-state">Todavía no hay usuarios registrados.</div>';
}

function renderActivity(transactions, users) {
  const userById = new Map(users.map((user) => [String(user.id), user]));
  const recent = [...transactions].sort((first, second) => new Date(second.creadaEn) - new Date(first.creadaEn)).slice(0, 6);
  document.querySelector('#activity-count').textContent = `${transactions.length} ${transactions.length === 1 ? 'registro' : 'registros'}`;
  document.querySelector('#activity-list').innerHTML = recent.length
    ? recent.map((transaction, index) => {
      const user = userById.get(String(transaction.usuarioId));
      const name = user?.nombre || `Usuario #${transaction.usuarioId}`;
      return `<tr>
        <td><div class="user-cell"><span class="avatar avatar-${index % 4}">${escapeHtml(initials(name))}</span><span class="user-name">${escapeHtml(name)}</span></div></td>
        <td class="activity-date">${formatDate(transaction.creadaEn)}</td>
        <td class="amount">${formatCurrency(transaction.monto)}</td>
      </tr>`;
    }).join('')
    : emptyRow(3, 'Todavía no hay movimientos registrados.');
}

async function loadResumen() {
  const warning = document.querySelector('#load-warning');
  warning.classList.add('d-none');

  const results = await Promise.allSettled([
    getData('/usuarios'), getData('/billeteras'), getData('/transacciones'), getData('/deudas')
  ]);
  const [usersResult, walletsResult, transactionsResult, debtsResult] = results;
  const users = usersResult.status === 'fulfilled' ? usersResult.value : [];
  const wallets = walletsResult.status === 'fulfilled' ? walletsResult.value : [];
  const transactions = transactionsResult.status === 'fulfilled' ? transactionsResult.value : [];
  const debts = debtsResult.status === 'fulfilled' ? debtsResult.value : [];
  const failed = results.filter((result) => result.status === 'rejected').length;

  if (usersResult.status === 'fulfilled') state.users = users;

  document.querySelector('#total-balance').textContent = walletsResult.status === 'fulfilled'
    ? formatCurrency(wallets.reduce((total, wallet) => total + Number(wallet.saldo || 0), 0)) : '—';
  document.querySelector('#user-count').textContent = usersResult.status === 'fulfilled'
    ? new Intl.NumberFormat('es-CL').format(users.length) : '—';
  document.querySelector('#transaction-count').textContent = transactionsResult.status === 'fulfilled'
    ? new Intl.NumberFormat('es-CL').format(transactions.length) : '—';
  document.querySelector('#debt-total').textContent = debtsResult.status === 'fulfilled'
    ? formatCurrency(debts.reduce((total, debt) => total + Number(debt.monto || 0), 0)) : '—';

  if (usersResult.status === 'fulfilled') renderUsers(users, wallets);
  else document.querySelector('#user-list').innerHTML = '<div class="empty-state">No se pudieron cargar los usuarios.</div>';
  if (transactionsResult.status === 'fulfilled' && usersResult.status === 'fulfilled') renderActivity(transactions, users);
  else document.querySelector('#activity-list').innerHTML = emptyRow(3, 'No se pudo cargar la actividad.');

  if (failed) {
    warning.textContent = `${failed} consulta${failed === 1 ? '' : 's'} no disponible${failed === 1 ? '' : 's'}. Revisa la conexión con el servidor o la base de datos.`;
    warning.classList.remove('d-none');
  }
}

async function loadUsuarios() {
  await ensureUsers();
  const users = state.users;
  document.querySelector('#usuarios-count').textContent = `${users.length} ${users.length === 1 ? 'registro' : 'registros'}`;
  document.querySelector('#usuarios-list').innerHTML = users.length
    ? users.map((user, index) => `
      <tr>
        <td><div class="user-cell"><span class="avatar avatar-${index % 4}">${escapeHtml(initials(user.nombre || `Usuario #${user.id}`))}</span><div class="user-details"><strong>${escapeHtml(user.nombre || `Usuario #${user.id}`)}</strong><span>${escapeHtml(user.correo || 'Sin correo')}</span></div></div></td>
        <td>${escapeHtml(user.rut)}</td>
        <td>${escapeHtml(user.tipoUsuario)}</td>
        <td class="activity-date">${formatDate(user.fechaNacimiento)}</td>
        <td class="amount">${user.rentaMensual != null ? formatCurrency(user.rentaMensual) : '—'}</td>
        <td class="amount">${formatCurrency(user.saldo)}</td>
      </tr>`).join('')
    : emptyRow(6);
}

async function loadBilleteras() {
  await ensureUsers();
  const wallets = await getData('/billeteras');
  document.querySelector('#billeteras-count').textContent = `${wallets.length} ${wallets.length === 1 ? 'registro' : 'registros'}`;
  document.querySelector('#billeteras-list').innerHTML = wallets.length
    ? wallets.map((wallet) => `<tr><td>${escapeHtml(userName(wallet.usuarioId))}</td><td class="amount">${formatCurrency(wallet.saldo)}</td></tr>`).join('')
    : emptyRow(2);
}

function renderMovementTable(kind, items) {
  document.querySelector(`#${kind}-count`).textContent = `${items.length} ${items.length === 1 ? 'registro' : 'registros'}`;
  document.querySelector(`#${kind}-list`).innerHTML = items.length
    ? items.map((item) => `<tr><td>${escapeHtml(userName(item.usuarioId))}</td><td class="activity-date">${formatDate(item.creadaEn)}</td><td class="amount">${formatCurrency(item.monto)}</td></tr>`).join('')
    : emptyRow(3);
}

async function loadMovimientos() {
  await ensureUsers();
  const [transactions, debts] = await Promise.all([getData('/transacciones'), getData('/deudas')]);
  renderMovementTable('transacciones', transactions);
  renderMovementTable('deudas', debts);
}

function estadoSelectMarkup(solicitud) {
  const options = Object.entries(estadoSolicitudLabels)
    .map(([value, label]) => `<option value="${value}" ${value === solicitud.estado ? 'selected' : ''}>${label}</option>`)
    .join('');
  return `<select class="estado-select" data-id="${solicitud.id}">${options}</select>`;
}

async function loadCreditos() {
  await ensureUsers();
  const [creditos, solicitudes] = await Promise.all([getData('/creditos'), getData('/solicitudes-credito')]);
  state.creditos = creditos;
  fillCreditoSelects();

  document.querySelector('#creditos-count').textContent = `${creditos.length} ${creditos.length === 1 ? 'registro' : 'registros'}`;
  document.querySelector('#creditos-list').innerHTML = creditos.length
    ? creditos.map((credito) => `<tr><td>#${credito.id}</td><td class="amount">${formatCurrency(credito.monto)}</td><td>${Number(credito.tasaInteres)}%</td></tr>`).join('')
    : emptyRow(3);

  document.querySelector('#solicitudes-count').textContent = `${solicitudes.length} ${solicitudes.length === 1 ? 'registro' : 'registros'}`;
  document.querySelector('#solicitudes-list').innerHTML = solicitudes.length
    ? solicitudes.map((solicitud) => `
      <tr>
        <td>${escapeHtml(userName(solicitud.usuarioId))}</td>
        <td>#${solicitud.creditoId}</td>
        <td class="amount">${formatCurrency(solicitud.montoSolicitado)}</td>
        <td>${estadoSelectMarkup(solicitud)}</td>
        <td class="activity-date">${formatDate(solicitud.creadaEn)}</td>
      </tr>`).join('')
    : emptyRow(5);
}

async function loadRiesgo() {
  await ensureUsers();
  const [verificaciones, consultas] = await Promise.all([getData('/verificaciones-identidad'), getData('/consultas-riesgo')]);

  document.querySelector('#verificaciones-count').textContent = `${verificaciones.length} ${verificaciones.length === 1 ? 'registro' : 'registros'}`;
  document.querySelector('#verificaciones-list').innerHTML = verificaciones.length
    ? verificaciones.map((item) => `
      <tr>
        <td>${escapeHtml(userName(item.usuarioId))}</td>
        <td><span class="badge badge-${item.estado}">${estadoVerificacionLabels[item.estado] || item.estado}</span></td>
        <td>${escapeHtml(item.metodo || '—')}</td>
        <td class="activity-date">${item.fechaVerificacion ? formatDate(item.fechaVerificacion) : '—'}</td>
        <td class="activity-date">${item.fechaExpiracion ? formatDate(item.fechaExpiracion) : '—'}</td>
      </tr>`).join('')
    : emptyRow(5);

  document.querySelector('#consultas-count').textContent = `${consultas.length} ${consultas.length === 1 ? 'registro' : 'registros'}`;
  document.querySelector('#consultas-list').innerHTML = consultas.length
    ? consultas.map((item) => `
      <tr>
        <td>${escapeHtml(userName(item.usuarioId))}</td>
        <td>${item.score != null ? Number(item.score).toFixed(2) : '—'}</td>
        <td><span class="badge ${item.morosidad ? 'badge-rechazada' : 'badge-verificada'}">${item.morosidad ? 'Sí' : 'No'}</span></td>
        <td class="amount">${item.cantidadDeuda != null ? formatCurrency(item.cantidadDeuda) : '—'}</td>
        <td class="activity-date">${formatDate(item.consultadaEn)}</td>
      </tr>`).join('')
    : emptyRow(5);
}

const routes = { resumen: loadResumen, usuarios: loadUsuarios, billeteras: loadBilleteras, movimientos: loadMovimientos, creditos: loadCreditos, riesgo: loadRiesgo };
const routeTitles = { resumen: 'Resumen', usuarios: 'Usuarios', billeteras: 'Billeteras', movimientos: 'Movimientos', creditos: 'Créditos', riesgo: 'Verificación y riesgo' };

async function checkHealth() {
  const dot = document.querySelector('#service-dot');
  const text = document.querySelector('#service-status');
  try {
    await getData('/salud');
    dot.classList.remove('is-offline');
    dot.classList.add('is-online');
    text.textContent = 'Servicio conectado';
  } catch {
    dot.classList.remove('is-online');
    dot.classList.add('is-offline');
    text.textContent = 'Servicio no disponible';
  }
}

async function navigate() {
  const hash = location.hash.replace('#/', '') || 'resumen';
  const route = routes[hash] ? hash : 'resumen';
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === `page-${route}`));
  document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.route === route));
  document.querySelector('#breadcrumb-current').textContent = routeTitles[route];

  const refreshButton = document.querySelector('#refresh-button');
  refreshButton.disabled = true;
  try {
    await Promise.all([routes[route](), checkHealth()]);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    refreshButton.disabled = false;
  }
}

function initTabs() {
  document.querySelectorAll('.tabs').forEach((tabs) => {
    tabs.addEventListener('click', (event) => {
      const button = event.target.closest('.tab-button');
      if (!button) return;
      const page = tabs.closest('.page');
      page.querySelectorAll('.tab-button').forEach((btn) => btn.classList.toggle('active', btn === button));
      page.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.tabPanel === button.dataset.tab));
    });
  });
}

function bindForm(formEl, handler) {
  if (!formEl) return;
  formEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = formEl.querySelector('.form-error');
    const submitButton = formEl.querySelector('button[type="submit"]');
    errorBox?.classList.add('d-none');
    submitButton.disabled = true;
    try {
      await handler(new FormData(formEl));
      formEl.reset();
      showToast('Guardado correctamente', 'success');
    } catch (error) {
      if (errorBox) { errorBox.textContent = error.message; errorBox.classList.remove('d-none'); }
      showToast(error.message, 'error');
    } finally {
      submitButton.disabled = false;
    }
  });
}

function initForms() {
  bindForm(document.querySelector('#usuario-form'), async (data) => {
    const payload = {
      nombre: data.get('nombre'), correo: data.get('correo'), rut: data.get('rut'),
      fechaNacimiento: data.get('fechaNacimiento'), tipoUsuario: data.get('tipoUsuario'),
      contrasena: data.get('contrasena')
    };
    const renta = data.get('rentaMensual');
    if (renta) payload.rentaMensual = Number(renta);
    const celular = data.get('numeroCelular');
    if (celular) payload.numeroCelular = celular;
    await postData('/usuarios', payload);
    await loadUsuarios();
  });

  bindForm(document.querySelector('#billetera-form'), async (data) => {
    await postData('/billeteras', { usuarioId: data.get('usuarioId') });
    await loadBilleteras();
  });

  bindForm(document.querySelector('#transaccion-form'), async (data) => {
    await postData('/transacciones', { usuarioId: data.get('usuarioId'), monto: Number(data.get('monto')) });
    await loadMovimientos();
  });

  bindForm(document.querySelector('#deuda-form'), async (data) => {
    await postData('/deudas', { usuarioId: data.get('usuarioId'), monto: Number(data.get('monto')) });
    await loadMovimientos();
  });

  bindForm(document.querySelector('#credito-form'), async (data) => {
    await postData('/creditos', { monto: Number(data.get('monto')), tasaInteres: Number(data.get('tasaInteres')) });
    await loadCreditos();
  });

  bindForm(document.querySelector('#solicitud-form'), async (data) => {
    await postData('/solicitudes-credito', {
      usuarioId: data.get('usuarioId'), creditoId: data.get('creditoId'), montoSolicitado: Number(data.get('montoSolicitado'))
    });
    await loadCreditos();
  });

  bindForm(document.querySelector('#verificacion-form'), async (data) => {
    const payload = { usuarioId: data.get('usuarioId'), estado: data.get('estado') };
    const metodo = data.get('metodo');
    if (metodo) payload.metodo = metodo;
    const fechaVerificacion = data.get('fechaVerificacion');
    if (fechaVerificacion) payload.fechaVerificacion = new Date(fechaVerificacion).toISOString();
    const fechaExpiracion = data.get('fechaExpiracion');
    if (fechaExpiracion) payload.fechaExpiracion = new Date(fechaExpiracion).toISOString();
    await postData('/verificaciones-identidad', payload);
    await loadRiesgo();
  });

  bindForm(document.querySelector('#riesgo-form'), async (data) => {
    const payload = { usuarioId: data.get('usuarioId'), morosidad: data.get('morosidad') === 'on' };
    const score = data.get('score');
    if (score) payload.score = Number(score);
    const tiempoDeMorosidad = data.get('tiempoDeMorosidad');
    if (tiempoDeMorosidad) payload.tiempoDeMorosidad = tiempoDeMorosidad;
    const cantidadDeuda = data.get('cantidadDeuda');
    if (cantidadDeuda) payload.cantidadDeuda = Number(cantidadDeuda);
    const tiempoEnDeuda = data.get('tiempoEnDeuda');
    if (tiempoEnDeuda) payload.tiempoEnDeuda = tiempoEnDeuda;
    await postData('/consultas-riesgo', payload);
    await loadRiesgo();
  });

  document.querySelector('#solicitudes-list').addEventListener('change', async (event) => {
    const select = event.target.closest('.estado-select');
    if (!select) return;
    const id = select.dataset.id;
    const estado = select.value;
    select.disabled = true;
    try {
      await patchData(`/solicitudes-credito/${id}/estado`, { estado });
      showToast('Estado de la solicitud actualizado', 'success');
      await loadCreditos();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      select.disabled = false;
    }
  });
}

document.querySelector('#today-date').textContent = new Intl.DateTimeFormat('es-CL', {
  weekday: 'long', day: 'numeric', month: 'long'
}).format(new Date());
document.querySelector('#login-form').addEventListener('submit', iniciarSesion);
initTabs();
initForms();
window.addEventListener('hashchange', navigate);
document.querySelector('#refresh-button').addEventListener('click', navigate);
if (sessionStorage.getItem('monify.accessToken')) {
  mostrarAplicacion();
  navigate();
} else {
  mostrarLogin();
}
