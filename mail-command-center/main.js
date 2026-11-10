// Mail Command Center — main process
// Each account is a WebContentsView with its own persistent session partition,
// so every Gmail account stays signed in independently.

const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const creds = require('./credentials');
const updater = require('./updater');

const GMAIL_URL = 'https://mail.google.com/mail/u/0/#inbox';

// Google refuses sign-in from browsers that announce themselves as Electron.
// Present a plain Chrome user agent instead.
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/\S+/, '')
  .replace(/\s?gmail-command-center\/\S+/, '')
  .replace(/\s?Mail Command Center\/\S+/, '');

const storePath = () => path.join(app.getPath('userData'), 'accounts.json');

let state = { accounts: [] };
let win = null;
const views = new Map(); // id -> { view, visible }
let modalOpen = false;
let lastLayout = { rects: {} };

function load() {
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(storePath(), 'utf8')) };
  } catch { /* first run */ }
}
function save() {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(state, null, 2));
}

// Reads the unread number next to "Inbox" in Gmail's left menu. Returns a
// number, or null when it can't tell (the caller then keeps the last count).
//
// Several links on the page point at #inbox (the Gmail logo, for one), so only
// the link whose label starts with "Inbox" counts. Its label is
// "Inbox 339 unread", or exactly "Inbox" when there are none. If the label
// has no number, fall back to the count Gmail shows beside it in the row.
const INBOX_COUNT_PROBE = `(() => {
  const toInt = (s) => parseInt(s.replace(/[,.\\s]/g, ''), 10);
  const label = (a) => (a.getAttribute('aria-label') || '').trim();
  const row = [...document.querySelectorAll('a[href$="#inbox"]')]
    .find((a) => /^inbox\\b/i.test(label(a) || a.textContent.trim()));
  if (!row) return null;
  const m = label(row).match(/^inbox\\D*?(\\d[\\d,.\\s]*)/i);
  if (m) return toInt(m[1]);
  const box = row.closest('[role="listitem"], [data-tooltip]') || row.parentElement;
  const t = (box ? box.textContent : row.textContent).replace(/\\s+/g, ' ').trim();
  const n = t.match(/^inbox\\s*(\\d[\\d,.]*)/i);
  if (n) return toInt(n[1]);
  return /^inbox$/i.test(label(row)) || /^inbox$/i.test(t) ? 0 : null;
})()`;

const partitionFor = (id) => `persist:acct-${id}`;
const isGoogleHost = (u) => {
  try { return /(^|\.)google\.com$/.test(new URL(u).hostname); } catch { return false; }
};

// ---------- Links ----------
// Gmail wraps links in emails as https://www.google.com/url?q=<real link>.
// Unwrap them so the browser goes straight to the real page.
function unwrapGoogleRedirect(u) {
  try {
    const x = new URL(u);
    if (isGoogleHost(u) && x.pathname === '/url') {
      const real = x.searchParams.get('q') || x.searchParams.get('url');
      if (real && /^https?:\/\//i.test(real)) return real;
    }
  } catch { /* not a URL */ }
  return u;
}

// Gmail's own pop-outs (compose, print, a message in its own window) and Google
// sign-in need this account's session, so they always open inside the app.
function staysInApp(u) {
  if (u === '' || u === 'about:blank') return true;
  try {
    const h = new URL(u).hostname;
    return h === 'mail.google.com' || h === 'accounts.google.com';
  } catch { return false; }
}

// Only ordinary web and email links are handed to the system.
const canOpenExternally = (u) => {
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(u).protocol); } catch { return false; }
};

const linksGoToBrowser = () => state.openLinksInBrowser !== false; // on unless turned off

// Decide where a link opened from an account goes. Applied to the account's
// view and to every window opened from it.
function handleLinks(wc, account) {
  wc.setWindowOpenHandler(({ url }) => {
    const target = unwrapGoogleRedirect(url);
    if (staysInApp(target) || (!linksGoToBrowser() && /^https?:/i.test(target))) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1000, height: 800, autoHideMenuBar: true,
          webPreferences: { partition: partitionFor(account.id) },
        },
      };
    }
    if (canOpenExternally(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => handleLinks(child.webContents, account));
}

const liveInfo = {}; // id -> latest { unread, email, error }, replayed to the UI on load

function send(channel, payload) {
  if (channel === 'account:update') liveInfo[payload.id] = { ...liveInfo[payload.id], ...payload };
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createView(account) {
  const view = new WebContentsView({
    webPreferences: {
      partition: partitionFor(account.id),
      contextIsolation: true,
      sandbox: true,
    },
  });
  view.setBackgroundColor('#ffffff');
  const wc = view.webContents;

  handleLinks(wc, account);

  const setUnread = (unread) => {
    if (unread === liveInfo[account.id]?.unread) return;
    send('account:update', { id: account.id, unread });
    updateBadge(account.id, unread);
  };

  // Gmail titles look like "Inbox (339) - you@x.com - Gmail" in the inbox, but
  // "<subject> - you@x.com - Gmail" in an open email, or "Receipts (8) - …" in a
  // label. Only the Inbox title carries the inbox count. Anything else keeps
  // the last known count.
  wc.on('page-title-updated', (_e, title) => {
    const em = title.match(/([^\s]+@[^\s]+)/);
    if (em) send('account:update', { id: account.id, email: em[1] });
    if (/^Inbox\b/.test(title)) {
      const m = title.match(/^Inbox \((\d[\d,]*)\)/);
      setUnread(m ? parseInt(m[1].replace(/,/g, ''), 10) : 0);
    }
  });

  // Gmail's left menu always shows the inbox count, whatever page is open, so
  // poll it to keep the badge live while you're reading an email.
  const pollUnread = async () => {
    if (wc.isDestroyed()) return clearInterval(unreadTimer);
    let host = '';
    try { host = new URL(wc.getURL()).hostname; } catch { return; }
    if (host !== 'mail.google.com') return;
    const n = await wc.executeJavaScript(INBOX_COUNT_PROBE, true).catch(() => null);
    if (typeof n === 'number') setUnread(n);
  };
  const unreadTimer = setInterval(pollUnread, 5000);
  wc.on('destroyed', () => clearInterval(unreadTimer));
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain && code !== -3) send('account:update', { id: account.id, error: desc });
  });

  creds.attachAutofill(wc, account.id);
  wc.loadURL(GMAIL_URL);
  view.setVisible(false);
  win.contentView.addChildView(view);
  views.set(account.id, { view });
  return view;
}

const unreadById = new Map();
function updateBadge(id, n) {
  unreadById.set(id, n);
  const total = [...unreadById.values()].reduce((a, b) => a + b, 0);
  try { app.setBadgeCount(total); } catch { /* unsupported platform */ }
  if (win) win.setTitle(total ? `Mail Command Center (${total})` : 'Mail Command Center');
}

function applyLayout() {
  const { rects } = lastLayout;
  for (const [id, { view }] of views) {
    const r = rects[id];
    if (!r || modalOpen || r.width < 2 || r.height < 2) {
      view.setVisible(false);
      continue;
    }
    view.setBounds({
      x: Math.round(r.x), y: Math.round(r.y),
      width: Math.round(r.width), height: Math.round(r.height),
    });
    view.setVisible(true);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 800,
    minHeight: 500,
    title: 'Mail Command Center',
    backgroundColor: '#0f1115',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('page-title-updated', (e) => e.preventDefault()); // keep the unread total in the title
  win.on('closed', () => { win = null; views.clear(); });
  for (const a of state.accounts) createView(a);
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'Add account…', accelerator: 'CmdOrCtrl+Shift+N', click: () => send('nav', { add: true }) },
      { type: 'separator' },
      process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Reload account', accelerator: 'CmdOrCtrl+R', click: () => send('nav', { reload: true }) },
      {
        label: 'Open Links in Default Browser',
        type: 'checkbox',
        checked: linksGoToBrowser(),
        click: (item) => { state.openLinksInBrowser = item.checked; save(); },
      },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { role: 'toggleDevTools' },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
// What the UI gets: settings plus, per account, the saved email and whether a
// password is stored. Passwords themselves never leave the main process.
function uiState() {
  const saved = Object.fromEntries(state.accounts.map((a) => [a.id, creds.summary(a.id)]));
  return { ...state, live: liveInfo, creds: saved, secureStorage: creds.available() };
}

ipcMain.handle('state:get', () => uiState());

ipcMain.handle('accounts:add', (_e, { label, color, email, password }) => {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const account = { id, label: label || `Account ${state.accounts.length + 1}`, color: color || '#4f8cff' };
  let warning = null;
  try { creds.set(id, { email, password }); } catch (err) { warning = err.message; }
  state.accounts.push(account);
  save();
  createView(account);
  return { ...uiState(), warning };
});

ipcMain.handle('accounts:update', (_e, { id, label, color, email, password, forgetPassword }) => {
  const a = state.accounts.find((x) => x.id === id);
  let warning = null;
  if (a) {
    if (label) a.label = label;
    if (color) a.color = color;
    save();
    try { creds.set(id, { email, password, forgetPassword }); } catch (err) { warning = err.message; }
  }
  return { ...uiState(), warning };
});

ipcMain.handle('accounts:remove', async (_e, { id, clearData }) => {
  state.accounts = state.accounts.filter((x) => x.id !== id);
  save();
  const entry = views.get(id);
  if (entry) {
    win.contentView.removeChildView(entry.view);
    entry.view.webContents.close();
    views.delete(id);
  }
  updateBadge(id, 0);
  unreadById.delete(id);
  delete liveInfo[id];
  creds.remove(id);
  if (clearData) await session.fromPartition(partitionFor(id)).clearStorageData();
  return uiState();
});

ipcMain.handle('accounts:reorder', (_e, ids) => {
  const byId = Object.fromEntries(state.accounts.map((a) => [a.id, a]));
  state.accounts = ids.map((id) => byId[id]).filter(Boolean);
  save();
  return uiState();
});

ipcMain.on('layout', (_e, layout) => { lastLayout = layout; applyLayout(); });
ipcMain.on('modal', (_e, open) => { modalOpen = open; applyLayout(); });

ipcMain.on('view:action', (_e, { id, action }) => {
  const entry = views.get(id);
  if (!entry) return;
  const wc = entry.view.webContents;
  if (action === 'reload') wc.reload();
  if (action === 'home') wc.loadURL(GMAIL_URL);
  if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  if (action === 'focus') wc.focus();
  if (action === 'compose') wc.loadURL('https://mail.google.com/mail/u/0/#inbox?compose=new');
});

if (process.platform === 'win32') app.setAppUserModelId('com.mailcommandcenter.app');

app.whenReady().then(() => {
  load();
  buildMenu();
  createWindow();
  updater.start(send);
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
