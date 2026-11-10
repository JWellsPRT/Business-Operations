// Mail Command Center — UI. Owns the layout; tells the main process where to
// place each live Gmail view.

const COLORS = ['#4f8cff', '#30a46c', '#e5484d', '#f5a524', '#8e4ec6', '#12a594', '#e93d82', '#9ba1a6'];

const $ = (s) => document.querySelector(s);
let state = { accounts: [] };
const live = {}; // id -> { unread, email, error }
let selectedId = null; // the one account shown

// Remember the open account between launches (per-PC convenience only).
const SELECTED_KEY = 'mcc.selected';
try { selectedId = localStorage.getItem(SELECTED_KEY); } catch { /* storage unavailable */ }

// ---------- Layout sync ----------
let rafPending = false;
function syncLayout() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const rects = {};
    document.querySelectorAll('.tile').forEach((tile) => {
      if (tile.offsetParent === null) return; // hidden
      const id = tile.dataset.id;
      if (live[id]?.error) return;
      const r = tile.querySelector('.slot').getBoundingClientRect();
      rects[id] = { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    window.mcc.layout({ rects });
  });
}
new ResizeObserver(syncLayout).observe($('#tiles'));
window.addEventListener('resize', syncLayout);

// ---------- Rendering ----------
function render() {
  const { accounts } = state;
  // Always show one account: keep the current one if it still exists.
  if (!accounts.some((a) => a.id === selectedId)) selectedId = accounts[0]?.id ?? null;
  $('#empty').hidden = accounts.length > 0;

  // Sidebar
  const list = $('#account-list');
  list.innerHTML = '';
  accounts.forEach((a, i) => {
    const info = live[a.id] || {};
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.id = a.id;
    li.innerHTML = `
      <button class="nav-item ${selectedId === a.id ? 'active' : ''}">
        <span class="dot" style="background:${a.color}"></span>
        <span class="meta">
          <div class="name"></div>
          <div class="email"></div>
        </span>
        ${info.unread ? `<span class="badge">${info.unread.toLocaleString()}</span>` : ''}
      </button>`;
    li.querySelector('.name').textContent = a.label;
    const saved = state.creds?.[a.id] || {};
    li.querySelector('.email').textContent = (info.email || saved.email || 'Not signed in yet') + (saved.hasPassword ? '  🔒' : '');
    li.querySelector('.email').title = saved.hasPassword ? 'Password saved (encrypted)' : '';
    li.querySelector('button').onclick = () => select(a.id);
    li.querySelector('button').ondblclick = () => openModal(a);
    wireDrag(li);
    list.appendChild(li);
  });

  // Tiles — reuse existing DOM nodes so layout doesn't flicker
  const tiles = $('#tiles');
  const existing = Object.fromEntries([...tiles.children].map((t) => [t.dataset.id, t]));
  accounts.forEach((a) => {
    let t = existing[a.id];
    if (!t) t = makeTile(a);
    delete existing[a.id];
    updateTile(t, a);
    tiles.appendChild(t); // keeps order in sync
  });
  Object.values(existing).forEach((t) => t.remove());

  const total = Object.values(live).reduce((s, x) => s + (x.unread || 0), 0);
  $('#total-unread').textContent = total ? `${total.toLocaleString()} unread across ${accounts.length}` : `${accounts.length} account${accounts.length === 1 ? '' : 's'} · inbox zero`;

  syncLayout();
}

function makeTile(a) {
  const t = document.createElement('section');
  t.className = 'tile';
  t.dataset.id = a.id;
  t.innerHTML = `
    <header class="tile-head">
      <span class="name"></span>
      <span class="email"></span>
      <span class="badge"></span>
      <span class="actions">
        <button class="icon-btn" data-act="compose" title="Compose">✎</button>
        <button class="icon-btn" data-act="back" title="Back">←</button>
        <button class="icon-btn" data-act="home" title="Inbox">⌂</button>
        <button class="icon-btn" data-act="reload" title="Reload">↻</button>
        <button class="icon-btn" data-act="edit" title="Rename / color / remove">⋯</button>
      </span>
    </header>
    <div class="slot"></div>`;
  t.querySelector('.tile-head').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const id = t.dataset.id;
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'edit') openModal(state.accounts.find((x) => x.id === id));
    else if (act === 'compose') window.mcc.action(id, 'compose');
    else {
      if (act === 'reload' && live[id]) delete live[id].error;
      window.mcc.action(id, act);
      render();
    }
  });
  return t;
}

function updateTile(t, a) {
  const info = live[a.id] || {};
  t.style.setProperty('--tile-color', a.color);
  t.hidden = selectedId !== a.id;
  t.querySelector('.name').textContent = a.label;
  t.querySelector('.email').textContent = info.email || '';
  const b = t.querySelector('.badge');
  b.textContent = info.unread ? info.unread.toLocaleString() : '';
  b.hidden = !info.unread;
  const slot = t.querySelector('.slot');
  slot.innerHTML = info.error ? `<div class="error">Couldn't load: ${escapeHtml(info.error)}<br>Use ↻ to retry.</div>` : '';
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Switch account ----------
function select(id) {
  selectedId = id;
  try { localStorage.setItem(SELECTED_KEY, id); } catch { /* storage unavailable */ }
  render();
  window.mcc.action(id, 'focus');
}

// ---------- Drag to reorder ----------
let dragId = null;
function wireDrag(li) {
  li.addEventListener('dragstart', () => { dragId = li.dataset.id; li.classList.add('dragging'); });
  li.addEventListener('dragend', () => { li.classList.remove('dragging'); document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target')); });
  li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drop-target'); });
  li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
  li.addEventListener('drop', async (e) => {
    e.preventDefault();
    const ids = state.accounts.map((a) => a.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(li.dataset.id), 0, dragId);
    state = await window.mcc.reorder(ids);
    render();
  });
}

// ---------- Modal ----------
let editing = null;
let pickedColor = COLORS[0];
function openModal(account) {
  editing = account || null;
  $('#modal-title').textContent = editing ? 'Edit account' : 'Add account';
  $('#f-save').textContent = editing ? 'Save' : 'Add & sign in';
  $('#f-label').value = editing ? editing.label : '';
  const saved = (editing && state.creds?.[editing.id]) || { email: '', hasPassword: false };
  $('#f-email').value = saved.email;
  $('#f-password').value = '';
  $('#f-password').placeholder = saved.hasPassword ? '•••••••• saved — leave blank to keep' : '';
  $('#f-forget').checked = false;
  $('#f-forget-row').hidden = !saved.hasPassword;
  const note = $('#f-secure-note');
  note.classList.toggle('warn', !state.secureStorage);
  note.textContent = state.secureStorage
    ? 'Your password is encrypted with your Windows login and only typed into accounts.google.com.'
    : 'Secure storage isn\'t available on this computer, so passwords can\'t be saved.';
  $('#f-password').disabled = !state.secureStorage;
  $('#f-delete').hidden = !editing;
  $('#f-delete-confirm').hidden = true;
  pickedColor = editing ? editing.color : COLORS[state.accounts.length % COLORS.length];
  const sw = $('#f-colors');
  sw.innerHTML = '';
  COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (c === pickedColor ? ' sel' : '');
    b.style.background = c;
    b.onclick = () => { pickedColor = c; sw.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('sel', x === b)); };
    sw.appendChild(b);
  });
  window.mcc.modal(true);
  $('#modal-backdrop').hidden = false;
  $('#f-label').focus();
}
function closeModal() {
  $('#f-password').value = '';
  $('#modal-backdrop').hidden = true;
  window.mcc.modal(false);
}
$('#modal').addEventListener('submit', async (e) => {
  e.preventDefault();
  const label = $('#f-label').value.trim();
  const email = $('#f-email').value.trim();
  const password = $('#f-password').value;
  $('#f-password').value = '';
  if (editing) {
    state = await window.mcc.updateAccount({ id: editing.id, label, color: pickedColor, email, password, forgetPassword: $('#f-forget').checked });
    if (state.warning) alert(state.warning);
    closeModal();
    render();
  } else {
    state = await window.mcc.addAccount({ label, color: pickedColor, email, password });
    if (state.warning) alert(state.warning);
    closeModal();
    select(state.accounts[state.accounts.length - 1].id); // go straight to sign-in
  }
});
$('#f-cancel').onclick = closeModal;
$('#f-delete').onclick = () => { $('#f-delete-confirm').hidden = false; };
$('#f-delete-no').onclick = () => { $('#f-delete-confirm').hidden = true; };
$('#f-delete-yes').onclick = async () => {
  const id = editing.id;
  state = await window.mcc.removeAccount(id, $('#f-clear').checked);
  delete live[id];
  closeModal();
  render();
};
$('#modal-backdrop').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal-backdrop').hidden) closeModal(); });

// ---------- Controls ----------
$('#btn-add').onclick = () => openModal();
$('#btn-add-empty').onclick = () => openModal();

// ---------- Events from main ----------
window.mcc.on('account:update', (p) => {
  live[p.id] = { ...live[p.id], ...p };
  if (p.unread !== undefined || p.email) delete live[p.id].error;
  render();
});
window.mcc.on('nav', (n) => {
  if (!$('#modal-backdrop').hidden) return;
  if (n.add) return openModal();
  if (n.reload && selectedId) window.mcc.action(selectedId, 'reload');
});

// ---------- Updates ----------
// Windows: the update is downloaded and installs on restart.
window.mcc.on('update:ready', ({ version }) => {
  $('#update-title').textContent = 'Update ready';
  $('#update-version').textContent = ` · version ${version}`;
  $('#btn-update').textContent = 'Restart to update';
  $('#btn-update').onclick = () => window.mcc.installUpdate();
  $('#update-banner').hidden = false;
});
// macOS: a newer version exists; the button opens the download page.
window.mcc.on('update:available', ({ version }) => {
  $('#update-title').textContent = `Version ${version} available`;
  $('#update-version').textContent = '';
  $('#btn-update').textContent = 'Download';
  $('#btn-update').onclick = () => window.mcc.openUpdatePage();
  $('#update-banner').hidden = false;
});

// ---------- Boot ----------
(async () => {
  state = await window.mcc.getState();
  Object.assign(live, state.live || {});
  render();
})();
