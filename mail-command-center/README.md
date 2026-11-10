# Mail Command Center

One window for all your Gmail accounts. Pick an account in the sidebar to open it; the app remembers which one you had open.

Each account runs in its own isolated, persistent browser session, so every account stays signed in at the same time.

## Features

- **Unread counts** for each account, a total in the sidebar and window title, and a taskbar badge. Counts stay current while you're reading an email.
- **Links open in your default browser**, as a new tab in your open browser window if it's running. Gmail's redirect wrapper is removed, so the browser goes straight to the real page. Turn this off under **View → Open Links in Default Browser** to open links in a Mail Command Center window instead. Compose and message pop-outs and Google sign-in always stay in the app.
- **Saved passwords (optional).** They're encrypted with your Windows login (DPAPI) and only ever typed into Google's sign-in page at accounts.google.com. You still click Next yourself.
- **Encrypted cookies.** Sign-in sessions are encrypted on disk, the same way Chrome does it.
- **Hardened build.** The app refuses to run if its files have been modified, and the debugging back doors are off.
- **Updates.** The app checks for new versions at startup and every 4 hours.
  - **Windows:** updates download in the background and the app shows "Update ready, restart to update." If you ignore the banner, the update installs the next time you quit.
  - **macOS:** the app shows "Version X available" with a **Download** button that opens the release page. Install the new version the same way as the first one. (The Mac build isn't signed with an Apple certificate, and macOS only lets signed apps update themselves.)

Accounts and settings are stored in `%APPDATA%\Mail Command Center` on Windows and `~/Library/Application Support/Mail Command Center` on macOS, and are kept when the app updates.

## Releasing an update

1. Commit your change to `main`. You don't need to edit the version number.
2. On GitHub, open **Actions → Mail Command Center release → Run workflow**, leave the branch on `main`, enter the new version (for example `1.2.1`), and click **Run workflow**.

   Alternatively, push a tag: `git tag mcc-v1.2.1 && git push origin mcc-v1.2.1`.
   To test a build without releasing it, tick **Dry run**. The installers are then attached to the workflow run under **Artifacts**.
3. The workflow builds the Windows installer and the two Mac disk images in parallel, creates the `mcc-v1.2.1` tag, and publishes them together as this repo's latest GitHub Release. If either platform fails to build, nothing is published. Installed apps pick it up within 4 hours, or on their next launch.

Versions look like `MAJOR.MINOR.PATCH`, and each release needs a higher version than the last.

Notes:
- **This repo must stay public.** Installed apps download updates from its Releases page without a login. The workflow refuses to publish if the repo is private.
- **Only Mail Command Center releases should be marked "Latest".** The app checks the repo's latest release. If you add other tools here later, publish their releases with "Set as the latest release" unticked (`gh release create --latest=false`).
- The installers contain no secrets. Passwords and accounts live only on each PC.

## Install

Latest release: **https://github.com/JWellsPRT/Business-Operations/releases/latest** (look under **Assets**).

### Windows 10/11

Download `Mail-Command-Center-Setup-<version>.exe` and run it. It installs for your Windows user only, so you don't need admin rights.

The app isn't code-signed, so Windows SmartScreen may say "Windows protected your PC" the first time. Click **More info**, then **Run anyway**. Auto-updates don't show this warning.

### macOS 11 or later

1. Download the disk image for your Mac:
   - **Apple Silicon** (M1, M2, M3, M4…): `Mail-Command-Center-<version>-mac-arm64.dmg`
   - **Intel**: `Mail-Command-Center-<version>-mac-x64.dmg`

   Not sure? Apple menu → **About This Mac**: "Chip: Apple M…" means Apple Silicon; "Processor: Intel" means Intel.
2. Open the disk image and drag **Mail Command Center** into **Applications**.
3. Open it from Applications. macOS will block it the first time ("Apple could not verify…"), because the app isn't signed with an Apple certificate. Click **Done**, then go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to Mail Command Center. Confirm with your password. You only need to do this once per version.
4. The first time it saves sign-ins, macOS may ask to let Mail Command Center use its "Safe Storage" key in your Keychain. Click **Always Allow**. You may be asked again after installing a new version.

If macOS ever says the app "is damaged and can't be opened", run this once in Terminal, then open it again:

    xattr -cr "/Applications/Mail Command Center.app"

## Development

    cd mail-command-center
    npm install
    npm start          # run from source (no auto-update)
    npm run dist       # local Windows build into dist/ (needs Wine on Linux/macOS)
