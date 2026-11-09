// Saved Gmail credentials.
//
// Passwords are encrypted with Electron's safeStorage. On Windows that is DPAPI,
// tied to your Windows login (the same protection Chrome uses for saved
// passwords). Only ciphertext is written to disk, and the decrypted password
// never goes to the app's UI. It is typed only into Google's own sign-in
// page (https://accounts.google.com).

const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const SIGNIN_ORIGIN = 'https://accounts.google.com';
const file = () => path.join(app.getPath('userData'), 'secrets.json');

let store = null; // id -> { email, password: base64 ciphertext | null }

function load() {
  if (store) return store;
  try { store = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { store = {}; }
  return store;
}
function persist() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(store, null, 2), { mode: 0o600 });
}

const available = () => safeStorage.isEncryptionAvailable();

// Safe for the UI: never includes the password.
function summary(id) {
  const c = load()[id];
  return c ? { email: c.email || '', hasPassword: !!c.password } : { email: '', hasPassword: false };
}

function set(id, { email, password, forgetPassword }) {
  const s = load();
  const cur = s[id] || { email: '', password: null };
  if (typeof email === 'string') cur.email = email.trim();
  if (forgetPassword) cur.password = null;
  if (password) {
    if (!available()) throw new Error('Secure storage is not available on this computer, so the password was not saved.');
    cur.password = safeStorage.encryptString(password).toString('base64');
  }
  if (!cur.email && !cur.password) delete s[id]; else s[id] = cur;
  persist();
}

function remove(id) {
  const s = load();
  if (s[id]) { delete s[id]; persist(); }
}

function reveal(id) {
  const c = load()[id];
  if (!c) return null;
  let password = null;
  if (c.password && available()) {
    try { password = safeStorage.decryptString(Buffer.from(c.password, 'base64')); } catch { password = null; }
  }
  return { email: c.email, password };
}

// Runs in the sign-in page: focuses the first visible, empty email or password
// field and reports which kind it is. Values are never passed into the page's
// JavaScript; they are typed with insertText, as if from the keyboard.
const PROBE = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
      && el.getAttribute('aria-hidden') !== 'true'; };
  const pick = (sel) => [...document.querySelectorAll(sel)]
    .find((el) => vis(el) && !el.disabled && !el.readOnly && !el.value);
  const pw = pick('input[type=password]:not([name=hiddenPassword])');
  if (pw) { pw.focus(); return 'password'; }
  const em = pick('input[type=email], input#identifierId');
  if (em) { em.focus(); return 'email'; }
  return null;
})()`;

const onSignInPage = (wc) => {
  try { return new URL(wc.getURL()).origin === SIGNIN_ORIGIN; } catch { return false; }
};

// Fill the Google sign-in form for this account. It fills each step once
// (email, then password) and does not press Next, so you stay in control and
// a wrong password can't cause a retry loop.
function attachAutofill(wc, id) {
  let timer = null;
  let busy = false;
  const filled = new Set();

  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  const tick = async () => {
    if (wc.isDestroyed() || !onSignInPage(wc)) return stop();
    if (busy) return;
    busy = true;
    try {
      const cred = reveal(id);
      if (!cred || (!cred.email && !cred.password)) return;
      const kind = await wc.executeJavaScript(PROBE, true).catch(() => null);
      if (!kind) return;
      const step = kind + new URL(wc.getURL()).pathname;
      const value = kind === 'email' ? cred.email : cred.password;
      if (!value || filled.has(step) || !onSignInPage(wc)) return;
      filled.add(step);
      wc.insertText(value);
    } finally {
      busy = false;
    }
  };
  const check = () => {
    if (onSignInPage(wc)) { if (!timer) timer = setInterval(tick, 700); tick(); } else stop();
  };

  wc.on('did-navigate', () => { filled.clear(); check(); });
  wc.on('did-navigate-in-page', check);
  wc.on('did-finish-load', check);
  wc.on('destroyed', stop);
}

module.exports = { available, summary, set, remove, attachAutofill };
