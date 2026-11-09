# Mail Command Center

One window for all your Gmail accounts. Each account is a live tile. Click a tile to expand it, and click Overview (or the ⤡ button) to return to the grid.

Each account runs in its own isolated, persistent browser session, so every account stays signed in at the same time.

## Features

- **Unread counts** for each account, a total in the sidebar and window title, and a taskbar badge. Counts stay current while you're reading an email.
- **Saved passwords (optional).** They're encrypted with your Windows login (DPAPI) and only ever typed into Google's sign-in page at accounts.google.com. You still click Next yourself.
- **Encrypted cookies.** Sign-in sessions are encrypted on disk, the same way Chrome does it.
- **Hardened build.** The app refuses to run if its files have been modified, and the debugging back doors are off.
- **Auto-update.** The app checks for new versions at startup and every 4 hours, downloads them in the background, and shows "Update ready, restart to update." If you ignore the banner, the update installs the next time you quit.

Accounts and settings are stored in `%APPDATA%\Mail Command Center` and are kept when the app updates.

## Releasing an update

1. Commit your change to `main`. You don't need to edit the version number.
2. On GitHub, open **Actions → Mail Command Center release → Run workflow**, leave the branch on `main`, enter the new version (for example `1.2.1`), and click **Run workflow**.

   Alternatively, push a tag: `git tag mcc-v1.2.1 && git push origin mcc-v1.2.1`.
3. The workflow builds the installer on Windows, creates the `mcc-v1.2.1` tag, and publishes it as this repo's latest GitHub Release. Installed apps pick it up within 4 hours, or on their next launch.

Versions look like `MAJOR.MINOR.PATCH`, and each release needs a higher version than the last.

Notes:
- **This repo must stay public.** Installed apps download updates from its Releases page without a login. The workflow refuses to publish if the repo is private.
- **Only Mail Command Center releases should be marked "Latest".** The app checks the repo's latest release. If you add other tools here later, publish their releases with "Set as the latest release" unticked (`gh release create --latest=false`).
- The installers contain no secrets. Passwords and accounts live only on each PC.

## Install

Download `Mail-Command-Center-Setup-<version>.exe` from this repo's **Releases** page and run it. It installs for your Windows user only, so you don't need admin rights.

The app isn't code-signed, so Windows SmartScreen may say "Windows protected your PC" the first time you run the installer. Click **More info**, then **Run anyway**. Auto-updates don't show this warning.

## Development

    cd mail-command-center
    npm install
    npm start          # run from source (no auto-update)
    npm run dist       # local Windows build into dist/ (needs Wine on Linux/macOS)
