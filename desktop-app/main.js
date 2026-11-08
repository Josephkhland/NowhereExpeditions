"use strict";

// Keep a clear failure for old commands which explicitly launch main.js.
// The previous implementation is preserved in legacy/electron-main.js.
throw new Error(
  "The Electron app has been retired. Launch " +
  "src-tauri/target/release/nowhere-expeditions.exe, " +
  "use tools/start-everything.ps1, or run npm start for Tauri development."
);
