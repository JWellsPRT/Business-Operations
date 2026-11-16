// Mail Command Center — UI. Owns the layout; tells the main process where to
// place each live Gmail view.

const COLORS = ['#4f8cff', '#30a46c', '#e5484d', '#f5a524', '#8e4ec6', '#12a594', '#e93d82', '#9ba1a6'];

const $ = (s) => document.querySelector(s);
let state = { accounts: [] };
const live = {}; // id -> { unread, email, error }
let selectedId = null; // the account shown in Mail view
let viewMode = 'mail'; // 'mail': one account's Gmail · 'calendar': the combined agenda
let hiddenCals = new Set(); // calendars switched off in the sidebar (accounts or other calendars)
let calData = { events: [], errors: [], updatedAt: null, loading: false, days: 14 };
const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent);
const ENCRYPTED_WITH = IS_MAC ? "your Mac's Keychain" : 'your Windows login';

// Remember the open account, the Mail/Calendar view and which calendars are
// hidden between launches (per-PC conveniences only).
const SELECTED_KEY = 'mcc.selected';
const VIEW_KEY = 'mcc.view';
const HIDDEN_KEY = 'mcc.calHidden';
try {
  selectedId = localStorage.getItem(SELECTED_KEY);
  if (localStorage.getItem(VIEW_KEY) === 'calendar') viewMode = 'calendar';
  hiddenCals = new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'));
} catch { /* storage unavailable */ }
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

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
  const inCal = viewMode === 'calendar';
  if (!accounts.some((a) => a.id === selectedId)) selectedId = accounts[0]?.id ?? null;
  $('#empty').hidden = inCal || accounts.length > 0;
  document.querySelectorAll('#view-toggle [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === viewMode));
  $('#agenda').hidden = !inCal;
  $('#tiles').hidden = inCal;
  $('#list-label').textContent = inCal ? 'Calendars' : 'Accounts';
  $('#btn-add').textContent = inCal ? '+ Add calendar' : '+ Add account';
  if (inCal) renderAgenda();

  const list = $('#account-list');
  list.innerHTML = '';
  if (inCal) renderCalendarList(list);
  else accounts.forEach((a) => {
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
  $('#total-unread').textContent = inCal ? todayText()
    : total ? `${total.toLocaleString()} unread across ${accounts.length}` : `${accounts.length} account${accounts.length === 1 ? '' : 's'} · inbox zero`;

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

// Mail view: one account's Gmail. Calendar view: the combined agenda.
function setViewMode(mode) {
  viewMode = mode;
  remember(VIEW_KEY, mode);
  render();
  if (mode === 'calendar') refreshIfStale();
  else if (selectedId) window.mcc.action(selectedId, 'focus');
}

// Fetch fresh events if the last refresh is more than 5 minutes old.
function refreshIfStale() {
  if (feedsTotal() && (!calData.updatedAt || Date.now() - new Date(calData.updatedAt) > 5 * 60000)) window.mcc.refreshCalendars();
}

// ---------- Combined calendar ----------
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const timeText = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const feedsTotal = () => Object.values(state.calendarFeeds || {}).reduce((a, b) => a + b, 0);
// Everything that can own events on the Calendar page: accounts and other calendars.
const calendarOwners = () => [
  ...state.accounts.map((a) => ({ ...a, kind: 'account' })),
  ...(state.otherCalendars || []).map((c) => ({ ...c, kind: 'other' })),
];

function agoText(iso) {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

// Place each event on the days it covers within the window. Timed events show
// on their start day (or today, if they started earlier and are still going).
function eventsByDay() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last = new Date(today); last.setDate(last.getDate() + (calData.days || 14));
  const days = new Map();
  const put = (k, e) => { if (!days.has(k)) days.set(k, []); days.get(k).push(e); };
  for (const e of calData.events) {
    if (hiddenCals.has(e.accountId) || !calendarOwners().some((a) => a.id === e.accountId)) continue;
    if (e.allDay) {
      for (let d = fromKey(e.start); d < fromKey(e.end); d.setDate(d.getDate() + 1)) {
        if (d >= today && d <= last) put(dayKey(d), e);
      }
    } else {
      const s = new Date(e.start);
      put(dayKey(s < today ? today : s), e);
    }
  }
  return { today, days };
}

// Calendar view's sidebar: every calendar with a show/hide switch. Accounts
// that aren't connected yet open their settings to paste the address.
function renderCalendarList(list) {
  const counts = {};
  for (const e of calData.events) counts[e.accountId] = (counts[e.accountId] || 0) + 1;
  const row = (c) => {
    const connected = (state.calendarFeeds?.[c.id] || 0) > 0;
    const shown = connected && !hiddenCals.has(c.id);
    const li = document.createElement('li');
    li.innerHTML = `
      <button class="nav-item cal-row ${shown ? 'on' : ''} ${connected ? '' : 'unconnected'}">
        <span class="check"></span>
        <span class="meta"><div class="name"></div><div class="email"></div></span>
        <span class="row-edit" title="Settings">⋯</span>
      </button>`;
    const btn = li.querySelector('button');
    btn.style.setProperty('--c', c.color);
    li.querySelector('.name').textContent = c.label;
    const n = counts[c.id] || 0;
    li.querySelector('.email').textContent = !connected ? 'Not connected · click to set up'
      : hiddenCals.has(c.id) ? 'Hidden' : `${n} event${n === 1 ? '' : 's'} in ${calData.days || 14} days`;
    const edit = () => (c.kind === 'account' ? openModal(state.accounts.find((a) => a.id === c.id)) : openCalModal(c));
    btn.title = !connected ? 'Connect this calendar' : shown ? 'Hide from the calendar' : 'Show on the calendar';
    btn.onclick = (e) => {
      if (e.target.closest('.row-edit') || !connected) return edit();
      if (hiddenCals.has(c.id)) hiddenCals.delete(c.id); else hiddenCals.add(c.id);
      remember(HIDDEN_KEY, JSON.stringify([...hiddenCals]));
      render();
    };
    list.appendChild(li);
  };
  calendarOwners().filter((c) => c.kind === 'account').forEach(row);
  const others = calendarOwners().filter((c) => c.kind === 'other');
  if (others.length) {
    const lbl = document.createElement('li');
    lbl.className = 'list-label';
    lbl.textContent = 'Other calendars';
    list.appendChild(lbl);
    others.forEach(row);
  }
}

function todayText() {
  if (!feedsTotal()) return 'No calendars connected';
  if (!calData.updatedAt) return 'Loading…';
  const { today, days } = eventsByDay();
  const now = new Date();
  const left = (days.get(dayKey(today)) || []).filter((e) => e.allDay || new Date(e.end) > now).length;
  return left ? `${left} more today` : 'Nothing else today';
}

// ---------- Other-calendar dialog ----------
let editingCal = null;
let calColor = COLORS[0];
function openCalModal(c) {
  editingCal = c || null;
  $('#cal-title').textContent = editingCal ? 'Edit calendar' : 'Add a calendar';
  $('#c-save').textContent = editingCal ? 'Save' : 'Add';
  $('#c-label').value = editingCal ? editingCal.label : '';
  $('#c-feed').value = '';
  $('#c-feed').disabled = !state.secureStorage;
  $('#c-feed').placeholder = editingCal ? 'Connected. Paste a new address to replace it.' : 'webcal://p…-caldav.icloud.com/published/2/…';
  $('#c-note').textContent = state.secureStorage
    ? `Stored encrypted with ${ENCRYPTED_WITH} and only sent to the calendar's own server.`
    : "Secure storage isn't available on this computer, so calendar addresses can't be saved.";
  $('#c-note').classList.toggle('warn', !state.secureStorage);
  $('#c-delete').hidden = !editingCal;
  calColor = editingCal ? editingCal.color : COLORS[(state.otherCalendars || []).length % COLORS.length];
  const sw = $('#c-colors');
  sw.innerHTML = '';
  COLORS.forEach((col) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (col === calColor ? ' sel' : '');
    b.style.background = col;
    b.onclick = () => { calColor = col; sw.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('sel', x === b)); };
    sw.appendChild(b);
  });
  window.mcc.modal(true);
  $('#cal-backdrop').hidden = false;
  $('#c-label').focus();
}
function closeCalModal() {
  $('#c-feed').value = '';
  $('#cal-backdrop').hidden = true;
  window.mcc.modal(false);
}
$('#cal-modal').addEventListener('submit', async (e) => {
  e.preventDefault();
  const feed = $('#c-feed').value.trim();
  const next = await window.mcc.saveOtherCalendar({ id: editingCal?.id, label: $('#c-label').value.trim(), color: calColor, feed });
  if (next.warning) { alert(next.warning); return; } // keep the dialog open to fix the address
  state = next;
  closeCalModal();
  render();
});
$('#c-cancel').onclick = closeCalModal;
$('#c-delete').onclick = async () => {
  if (!editingCal || !confirm(`Remove "${editingCal.label}" from the Calendar page?`)) return;
  state = await window.mcc.removeOtherCalendar(editingCal.id);
  closeCalModal();
  render();
};
$('#cal-backdrop').addEventListener('mousedown', (e) => { if (e.target.id === 'cal-backdrop') closeCalModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#cal-backdrop').hidden) closeCalModal(); });

function renderAgenda() {
  const status = $('#agenda-status'), body = $('#agenda-body'), errs = $('#agenda-errors');
  const accountsById = Object.fromEntries(calendarOwners().map((a) => [a.id, a]));
  errs.innerHTML = '';
  if (!feedsTotal()) {
    status.textContent = 'Every account, one agenda';
    body.innerHTML = `<div class="agenda-setup">
      <h2>Connect your calendars</h2>
      <p>Click an account in the sidebar and paste that calendar's <b>Secret address in iCal format</b>
      from Google Calendar's settings. The dialog explains where to find it.</p>
      <p>For other calendars, like your personal iCloud calendar, use <b>+ Add calendar</b> in the sidebar.</p>
      <p class="muted">The addresses are stored encrypted on this computer and only sent to the calendar's own server.</p>
    </div>`;
    return;
  }
  if (calendarOwners().every((c) => !state.calendarFeeds?.[c.id] || hiddenCals.has(c.id))) {
    status.textContent = '';
    body.innerHTML = '<div class="agenda-setup"><h2>All calendars are hidden</h2><p>Click a calendar in the sidebar to show it.</p></div>';
    return;
  }
  status.textContent = calData.loading ? 'Refreshing…'
    : calData.updatedAt ? `Next ${calData.days || 14} days · updated ${agoText(calData.updatedAt)}` : 'Loading…';
  for (const er of calData.errors || []) {
    const a = accountsById[er.accountId];
    if (!a || hiddenCals.has(a.id)) continue;
    const div = document.createElement('div');
    div.className = 'agenda-error';
    div.innerHTML = `<span class="dot"></span><b></b> <span></span>`;
    div.querySelector('.dot').style.background = a.color;
    div.querySelector('b').textContent = `${a.label}${(state.calendarFeeds?.[a.id] || 0) > 1 ? ` (calendar ${er.feed})` : ''}:`;
    div.querySelector('span:last-child').textContent = er.message;
    errs.appendChild(div);
  }

  const { today, days } = eventsByDay();
  const now = new Date();
  body.innerHTML = '';
  const keys = [...days.keys()].sort();
  if (!keys.includes(dayKey(today))) keys.unshift(dayKey(today));
  for (const k of keys) {
    const d = fromKey(k);
    const diff = Math.round((d - today) / 86400000);
    const sec = document.createElement('section');
    sec.className = 'agenda-day' + (diff === 0 ? ' today' : '');
    const h = document.createElement('h3');
    h.textContent = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'long' });
    const small = document.createElement('span');
    small.textContent = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    h.appendChild(small);
    sec.appendChild(h);
    const list = (days.get(k) || []).slice().sort((x, y) => (y.allDay - x.allDay) || (x.start < y.start ? -1 : 1));
    if (!list.length) {
      const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Nothing scheduled';
      sec.appendChild(p);
    }
    for (const e of list) {
      const a = accountsById[e.accountId];
      const row = document.createElement('button');
      row.className = 'agenda-event';
      if (!e.allDay && new Date(e.end) < now) row.classList.add('past');
      row.style.setProperty('--c', a.color);
      row.innerHTML = '<span class="when"></span><span class="bar"></span><span class="what"><span class="title"></span><span class="meta"></span></span>';
      row.querySelector('.when').textContent = e.allDay ? 'All day'
        : `${timeText(new Date(e.start))} – ${timeText(new Date(e.end))}`;
      row.querySelector('.title').textContent = e.title;
      row.querySelector('.meta').textContent = [a.label, e.location].filter(Boolean).join(' · ');
      if (a.kind === 'account') {
        row.title = `Open this day in ${a.label}'s Google Calendar`;
        row.onclick = () => window.mcc.openCalendarDay(a.id, k);
      } else {
        row.classList.add('no-link');
        row.title = `From ${a.label}`;
      }
      sec.appendChild(row);
    }
    body.appendChild(sec);
  }
}


const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Switch account ----------
function select(id) {
  selectedId = id;
  remember(SELECTED_KEY, id);
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
    ? `Your password is encrypted with ${ENCRYPTED_WITH} and only typed into accounts.google.com.`
    : 'Secure storage isn\'t available on this computer, so passwords can\'t be saved.';
  $('#f-password').disabled = !state.secureStorage;
  const feeds = (editing && state.calendarFeeds?.[editing.id]) || 0;
  $('#f-cal').value = '';
  $('#f-cal').disabled = !state.secureStorage;
  $('#f-cal').placeholder = feeds
    ? `${feeds} calendar${feeds === 1 ? '' : 's'} connected. Paste new addresses to replace ${feeds === 1 ? 'it' : 'them'}.`
    : 'Paste the "Secret address in iCal format", one per line';
  $('#f-cal-clear').checked = false;
  $('#f-cal-clear-row').hidden = !feeds;
  $('#f-cal-note').textContent = state.secureStorage
    ? `Stored encrypted with ${ENCRYPTED_WITH}. Anyone with this address can read the calendar, so don't share it.`
    : "Secure storage isn't available on this computer, so calendar addresses can't be saved.";
  $('#f-cal-note').classList.toggle('warn', !state.secureStorage);
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
  $('#f-cal').value = '';
  $('#modal-backdrop').hidden = true;
  window.mcc.modal(false);
}
$('#modal').addEventListener('submit', async (e) => {
  e.preventDefault();
  const label = $('#f-label').value.trim();
  const email = $('#f-email').value.trim();
  const password = $('#f-password').value;
  $('#f-password').value = '';
  // Calendar addresses: undefined keeps what's saved; '' disconnects.
  const calText = $('#f-cal').value.trim();
  const calendarFeeds = $('#f-cal-clear').checked ? '' : calText || undefined;
  $('#f-cal').value = '';
  if (editing) {
    state = await window.mcc.updateAccount({ id: editing.id, label, color: pickedColor, email, password, forgetPassword: $('#f-forget').checked, calendarFeeds });
    if (state.warning) alert(state.warning);
    closeModal();
    render();
  } else {
    state = await window.mcc.addAccount({ label, color: pickedColor, email, password, calendarFeeds });
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
$('#btn-add').onclick = () => (viewMode === 'calendar' ? openCalModal() : openModal());
$('#btn-add-empty').onclick = () => openModal();
document.querySelectorAll('#view-toggle [data-view]').forEach((b) => { b.onclick = () => setViewMode(b.dataset.view); });
$('#btn-cal-refresh').onclick = () => window.mcc.refreshCalendars();
window.mcc.on('calendars:update', (data) => { calData = data; render(); });
setInterval(() => { if (viewMode === 'calendar') render(); }, 60000); // keep "updated … ago" and today's count current

// ---------- Events from main ----------
window.mcc.on('account:update', (p) => {
  live[p.id] = { ...live[p.id], ...p };
  if (p.unread !== undefined || p.email) delete live[p.id].error;
  render();
});
window.mcc.on('nav', (n) => {
  if (!$('#modal-backdrop').hidden) return;
  if (n.add) return openModal();
  if (n.reload && viewMode === 'calendar') return window.mcc.refreshCalendars();
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
  calData = await window.mcc.getCalendars();
  render();
})();
