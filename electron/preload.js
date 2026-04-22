/**
 * Preload script – runs in the renderer process before any page JavaScript.
 *
 * Exposes a safe, minimal API to the web content via contextBridge.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * Returns true when the app is running inside Electron.
   */
  isElectron: () => true,

  /**
   * Returns the platform string (win32, darwin, linux).
   */
  platform: process.platform,

  /**
   * App version from package.json.
   */
  version: require("./package.json").version,
});
