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

1. Commit your change. You don't need to edit the version number: it comes from the tag.
2. Tag and push:

       git tag mcc-v1.2.1
       git push origin mcc-v1.2.1

3. GitHub Actions (`.github/workflows/mail-command-center-release.yml`) builds the installer on Windows, uploads it to Cloudflare R2, and creates a GitHub Release. Installed apps pick it up within 4 hours, or on their next launch.

Tags must look like `mcc-vMAJOR.MINOR.PATCH`, and each release needs a higher version than the last.

### One-time setup

In Cloudflare:

1. **R2 → Create bucket.** Use any name, for example `mail-command-center-updates`.
2. In the bucket's **Settings → Public access**, turn on the **R2.dev subdomain** (or connect a custom domain). Note the public URL, e.g. `https://pub-xxxxxxxx.r2.dev`.
3. **My Profile → API Tokens → Create Token**, with the permission **Account → Workers R2 Storage → Edit**.

In GitHub (this repo → **Settings → Secrets and variables → Actions**):

| Kind | Name | Value |
|------|------|-------|
| Secret | `CLOUDFLARE_API_TOKEN` | the token from step 3 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account ID (shown on the R2 overview page) |
| Variable | `MCC_R2_BUCKET` | the bucket name |
| Variable | `MCC_UPDATE_URL` | the public URL **plus** `/mail-command-center`, e.g. `https://pub-xxxxxxxx.r2.dev/mail-command-center` |

The installers in the bucket can be downloaded by anyone who has the URL. They contain no secrets: passwords and accounts live only on each PC.

## Install

Download `Mail-Command-Center-Setup-<version>.exe` from this repo's **Releases** page and run it. It installs for your Windows user only, so you don't need admin rights.

The app isn't code-signed, so Windows SmartScreen may say "Windows protected your PC" the first time you run the installer. Click **More info**, then **Run anyway**. Auto-updates don't show this warning.

## Development

    cd mail-command-center
    npm install
    npm start          # run from source (no auto-update)
    npm run dist       # local Windows build into dist/ (needs Wine on Linux/macOS)
