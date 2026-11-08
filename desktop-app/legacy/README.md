# Retired Electron host

`electron-main.js` preserves the previous host, including the local edits present before the Tauri migration. It is an archival reference, not a supported executable; its original relative imports have not been rewritten.

Electron has been removed from `package.json` and the lockfile. The toolkit services now use `native-host.js` and `service.js`; production starts from the Tauri release executable. The old `main.js` entry point reports that Electron has been retired.

The earlier feature notes are retained in `../legacy-electron-notes.md`.
