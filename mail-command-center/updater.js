// Updates.
//
// Windows: full auto-update. Checks the GitHub Releases feed baked in at build
// time (resources/app-update.yml), downloads new versions in the background,
// checks the installer's sha512 from latest.yml, and asks the UI to offer a
// restart.
//
// macOS: the Mac build isn't signed with an Apple certificate, and macOS only
// lets signed apps replace themselves. So it only checks for a newer release
// and asks the UI to offer a download link to the release page.

const { app, ipcMain, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000; // 4 hours
const FIRST_CHECK_MS = 10_000; // let the app settle first

function feedConfig() {
  // Only packaged builds that were built with an update feed can update.
  if (!app.isPackaged) return null;
  const file = path.join(process.resourcesPath, 'app-update.yml');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const get = (k) => (text.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.trim();
  return { owner: get('owner'), repo: get('repo') };
}

function start(send) {
  const feed = feedConfig();
  if (!feed) return;
  if (process.platform === 'darwin') return startMacNotice(send, feed);

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // if you ignore the banner, it installs on next quit

  autoUpdater.on('update-downloaded', (info) => {
    console.info(`update ${info.version} downloaded; offering restart`);
    send('update:ready', { version: info.version });
  });
  autoUpdater.on('error', (err) => console.warn('update check failed:', err?.message || err));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, CHECK_EVERY_MS);

  ipcMain.on('update:install', () => autoUpdater.quitAndInstall(true, true));
}

// "1.10.0" > "1.9.3"
function isNewer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function startMacNotice(send, { owner, repo }) {
  if (!owner || !repo) return;
  let pageUrl = null;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  const check = async () => {
    try {
      const res = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Mail-Command-Center' },
      });
      if (!res.ok) return;
      const rel = await res.json();
      const version = String(rel.tag_name || '').replace(/^mcc-v/, '');
      if (!/^\d+\.\d+\.\d+$/.test(version) || !isNewer(version, app.getVersion())) return;
      // Only offer releases that include a build for this Mac.
      if (!(rel.assets || []).some((a) => a.name.endsWith(`-mac-${arch}.dmg`))) return;
      if (!String(rel.html_url).startsWith(`https://github.com/${owner}/${repo}/releases/`)) return;
      pageUrl = rel.html_url;
      console.info(`version ${version} is available: ${pageUrl}`);
      send('update:available', { version });
    } catch (err) {
      console.warn('update check failed:', err?.message || err);
    }
  };
  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, CHECK_EVERY_MS);

  ipcMain.on('update:open', () => { if (pageUrl) shell.openExternal(pageUrl); });
}

module.exports = { start };
