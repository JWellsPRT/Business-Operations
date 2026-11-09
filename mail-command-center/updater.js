// Auto-update. Checks the update feed baked in at build time (resources/app-update.yml,
// written by electron-builder from the MCC_UPDATE_URL repo variable in CI),
// downloads new versions in the background, and asks the UI to offer a restart.
//
// Each release's installer hash (sha512 in latest.yml) is checked before install.

const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000; // 4 hours

function start(send) {
  // Only packaged builds that were built with an update feed can update.
  if (!app.isPackaged) return;
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return;

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // if you ignore the banner, it installs on next quit

  autoUpdater.on('update-downloaded', (info) => {
    console.info(`update ${info.version} downloaded; offering restart`);
    send('update:ready', { version: info.version });
  });
  autoUpdater.on('error', (err) => console.warn('update check failed:', err?.message || err));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10_000); // let the app settle first
  setInterval(check, CHECK_EVERY_MS);

  ipcMain.on('update:install', () => autoUpdater.quitAndInstall(true, true));
}

module.exports = { start };
