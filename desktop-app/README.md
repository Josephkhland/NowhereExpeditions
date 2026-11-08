# Nowhere Expeditions desktop app

The toolkit runs in a Tauri 2 window using Windows WebView2. The Terminal, Git, Claude memory and Marketing services run in one Node.js child process, connected to Rust over private standard input/output. Electron is no longer a runtime or build dependency.

This is a Windows, repository-based app. Keep the executable in this checkout and keep Node.js and `node_modules` installed. The current build does not produce a standalone installer or bundle Node.js.

## Setup and build

Requirements: Node.js, stable Rust/Cargo, the MSVC C++ build tools and Windows SDK, and WebView2. The individual toolkit services still require their existing Python environments and credentials.

From `desktop-app`, in a PowerShell or Visual Studio Developer PowerShell with the build tools available:

```powershell
npm install
npm run check
npm run build
```

The release executable is `src-tauri/target/release/nowhere-expeditions.exe`. Build output and generated web assets are ignored by Git; keep `src-tauri/Cargo.lock` and `package-lock.json` in source control.

For development, use `npm start`. To build without launching:

```powershell
npm run build:assets
cargo check --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
```

Cargo's direct commands use the assets already in `dist`; rebuild those after changing a page or preload. `npm start` and `npm run build` rebuild them automatically.

## Launch

From the repository root:

```powershell
& .\tools\start-everything.ps1
```

The launcher prefers the release executable and falls back to the debug executable. Without a built executable it retains the existing separate-server/browser fallback. `-Browser` selects that fallback explicitly.

The app normally starts the content manager, draft-site server, table-insights server and Discord bot. Services already answering on their ports are left alone. Closing the app asks before stopping its owned sessions.

For a preview with automatic service startup disabled:

```powershell
& .\desktop-app\src-tauri\target\debug\nowhere-expeditions.exe --open-only --tab=git
```

Executable flags: `--open-only`, `--no-bot`, `--no-insights`, and `--tab=<id>`. The launcher exposes the first three as `-OpenOnly`, `-NoBot`, and `-NoInsights`. A second launch focuses the existing instance; `--tab` also switches its tab.

| Tab ID | Tool |
| --- | --- |
| `live` | Published site |
| `manager` | Content manager, port 8001 |
| `site` | Draft site, port 8000 |
| `insights` | Table insights, port 8002 |
| `bot` | Private dashboard handed over by the bot |
| `terminal` | Server sessions and Claude Code |
| `git` | Status, diffs, branches, commits and publishing |
| `marketing` | Local promotion plans, content and exports |

The local pages support Ctrl+1 through Ctrl+8 for tab selection. Terminal controls start, resume, stop and restart sessions. Right-clicking a server tab opens its Terminal session. Git and Marketing retain their existing named actions and path checks. Marketing PNG/PDF exports now render in the page and use a native Save dialog; video rendering remains in the page.

The Tauri shell is still being checked for parity with the previous host. Native Electron menus, remote-page keyboard accelerators, its screenshot helpers and detailed tab loading/retry indicators have not been carried over. The debug build, service integration test and basic local-page preview have passed; live server startup, interactive PTYs and exports still need end-to-end verification.

## Isolation and private data

Remote sites run in separate native webviews. They receive no service permissions. Local pages can call only their own Terminal/Memory, Git or Marketing channels; Rust checks the calling webview and its origin, and Node checks the page/channel pairing again.

The bot still writes newline-delimited JSON to `\\.\pipe\nowhere-expeditions-app`. Only dashboard URLs at `http://127.0.0.1:8766` are accepted. The URL stays in backend memory and the dashboard webview; its key is not included in shell events or written to the app's logs.

Application settings live in Tauri's per-user application-data directory. Marketing media access is scoped to `marketing_promotion`, or the folder explicitly selected through `NE_APP_MARKETING_DIR` for testing.

`npm run check` runs the service in `--open-only` mode with temporary settings and a separate test pipe. It checks read-only Git access, page/channel isolation, and accepted/rejected dashboard handoffs; it does not start real services, push commits or publish content.

The desktop and existing taskbar shortcut can be updated with `& .\tools\make-shortcut.ps1` from the repository root. Both then target the Tauri release executable directly, without a PowerShell wrapper. The script updates an existing taskbar pin; it does not create a new pin.

[legacy/electron-main.js](legacy/electron-main.js) and [legacy-electron-notes.md](legacy-electron-notes.md) retain the previous host and local edits for reference. They are not used by Tauri or included in its frontend assets. The old `main.js` entry point now reports that Electron has been retired.
