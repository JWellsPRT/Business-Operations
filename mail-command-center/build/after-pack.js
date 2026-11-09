// electron-builder afterPack hook:
//  1. sets the .exe icon and version info with resedit (pure JS, no Wine needed)
//  2. flips Electron's security fuses (cookie encryption on, debugging back doors off)
const fs = require('fs');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('path');
const ResEdit = require('resedit');

exports.default = async (ctx) => {
  if (ctx.electronPlatformName !== 'win32') return;
  const name = ctx.packager.appInfo.productFilename;
  const version = ctx.packager.appInfo.version;
  const exePath = path.join(ctx.appOutDir, `${name}.exe`);

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);

  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, groupId, lang, ico.icons.map((i) => i.data));

  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    const [maj, min, pat] = version.split('.').map(Number);
    vi.setFileVersion(maj, min, pat, 0, 1033);
    vi.setProductVersion(maj, min, pat, 0, 1033);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      FileDescription: name, ProductName: name, InternalName: name,
      OriginalFilename: `${name}.exe`, CompanyName: name, LegalCopyright: '',
    });
    vi.outputToResourceEntries(res.entries);
  }
  // electron-builder 25 records the asar path as "resources/app.asar", but
  // Electron on Windows looks it up as "resources\\app.asar". Without this fix
  // asar integrity validation can't find its entry and the app won't start.
  for (const e of res.entries) {
    if (e.type !== 'INTEGRITY') continue;
    const list = JSON.parse(Buffer.from(e.bin).toString());
    for (const item of list) item.file = item.file.replace(/\//g, '\\');
    e.bin = new Uint8Array(Buffer.from(JSON.stringify(list))).buffer;
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • set icon + version info on ${path.basename(exePath)}`);
  await flip(ctx);
};

async function flip(ctx) {
  const exePath = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  await flipFuses(exePath, {
    version: FuseVersion.V1,
    [FuseV1Options.EnableCookieEncryption]: true,              // encrypt cookies with DPAPI, like Chrome
    [FuseV1Options.RunAsNode]: false,                          // block ELECTRON_RUN_AS_NODE abuse
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,      // no --inspect debugger attach
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true, // refuse a tampered app.asar
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
  console.log('  • flipped security fuses (cookie encryption on)');
}
