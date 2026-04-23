/**
 * Stock Data Pipelines – Electron Main Process
 *
 * Responsibilities:
 *   1. Spawn the packaged Python backend (sidecar) on a free port.
 *   2. Wait for the backend to become healthy.
 *   3. Open a BrowserWindow pointing at the backend's URL.
 *   4. Gracefully terminate the sidecar when the app closes.
 */

const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const net = require("net");
const log = require("electron-log");

// ── Logging ─────────────────────────────────────────────────────────────────
log.transports.file.level = "info";
log.transports.console.level = "debug";
log.info("App starting...");

// ── Globals ─────────────────────────────────────────────────────────────────
let mainWindow = null;
let splashWindow = null;
let pythonProcess = null;
let backendPort = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Find a free TCP port on localhost.
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/**
 * Return the path to the Python sidecar executable.
 * In development: run the server.py script directly with the system python.
 * In production: run the PyInstaller-built executable from extraResources.
 */
function getSidecarPath() {
  if (app.isPackaged) {
    const resourcesPath = process.resourcesPath;
    const exeName =
      process.platform === "win32"
        ? "stock_backend.exe"
        : "stock_backend";
    return path.join(resourcesPath, "python_backend", exeName);
  }
  // Dev mode – return null to signal we should use `python` directly
  return null;
}

/**
 * Spawn the Python backend.
 */
async function startPythonBackend() {
  backendPort = await getFreePort();
  log.info(`Starting Python backend on port ${backendPort}`);

  const sidecarPath = getSidecarPath();

  if (sidecarPath) {
    // ── Packaged mode ──
    log.info(`Sidecar executable: ${sidecarPath}`);
    pythonProcess = spawn(sidecarPath, ["--port", String(backendPort)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
  } else {
    // ── Dev mode – run module directly ──
    const projectRoot = path.resolve(__dirname, "..", "..");
    const moduleName = "apps.web_app.server.app";

    // Prefer the project's virtual environment Python if it exists
    const fs = require("fs");
    let pythonExe = "python";
    const venvPython = process.platform === "win32"
      ? path.join(projectRoot, ".venv", "Scripts", "python.exe")
      : path.join(projectRoot, ".venv", "bin", "python");
    if (fs.existsSync(venvPython)) {
      pythonExe = venvPython;
      log.info(`Using venv Python: ${pythonExe}`);
    } else {
      log.info("No .venv found, using system Python.");
    }

    log.info(`Dev mode: running python -m ${moduleName}`);
    pythonProcess = spawn(pythonExe, ["-m", moduleName, "--port", String(backendPort)], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: projectRoot,
      env: { ...process.env },
    });
  }

  pythonProcess.stdout.on("data", (data) => {
    log.info(`[python] ${data.toString().trim()}`);
  });

  pythonProcess.stderr.on("data", (data) => {
    log.warn(`[python:err] ${data.toString().trim()}`);
  });

  pythonProcess.on("error", (err) => {
    log.error("Failed to start Python backend:", err);
    dialog.showErrorBox(
      "Backend Error",
      `Could not start the Python backend.\n\n${err.message}`
    );
    app.quit();
  });

  pythonProcess.on("exit", (code, signal) => {
    log.info(`Python backend exited (code=${code}, signal=${signal})`);
    pythonProcess = null;
    // If the backend exits unexpectedly while the app is still running, warn the user.
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "Backend Stopped",
        "The Python backend has stopped unexpectedly. The application will now close."
      );
      app.quit();
    }
  });
}

/**
 * Poll the backend health endpoint until it responds.
 */
function waitForBackend(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("Backend did not start within 30 seconds."));
      }
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(check, 500);
        }
      });
      req.on("error", () => setTimeout(check, 500));
      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(check, 500);
      });
    };
    check();
  });
}

/**
 * Stop the Python backend gracefully.
 */
function stopPythonBackend() {
  if (!pythonProcess) return;
  log.info("Stopping Python backend...");
  try {
    if (process.platform === "win32") {
      // On Windows, SIGTERM doesn't work reliably – use taskkill
      spawn("taskkill", ["/pid", String(pythonProcess.pid), "/f", "/t"], {
        stdio: "ignore",
      });
    } else {
      pythonProcess.kill("SIGTERM");
    }
  } catch (err) {
    log.warn("Error stopping Python backend:", err);
  }
  pythonProcess = null;
}

// ── Windows ─────────────────────────────────────────────────────────────────

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.center();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "Stock Data Pipelines",
    backgroundColor: "#131722",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  // Load the app from the Python backend
  mainWindow.loadURL(`http://127.0.0.1:${backendPort}/`);

  mainWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Build application menu
  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Developer",
      submenu: [
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "About",
              message: "Stock Data Pipelines",
              detail:
                "Version 1.0.0\n\nTradingView-style stock analysis, screener, and announcement platform.",
            });
          },
        },
      ],
    },
  ];

  // macOS-specific first menu
  if (process.platform === "darwin") {
    template.unshift({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createSplashWindow();

  try {
    await startPythonBackend();
    log.info("Waiting for backend health check...");
    await waitForBackend(backendPort);
    log.info("Backend is healthy. Creating main window.");
    createMainWindow();
  } catch (err) {
    log.error("Failed to start:", err);
    dialog.showErrorBox(
      "Startup Error",
      `Could not start the application.\n\n${err.message}`
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  stopPythonBackend();
  app.quit();
});

app.on("before-quit", () => {
  stopPythonBackend();
});

app.on("activate", () => {
  // macOS: re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0 && backendPort) {
    createMainWindow();
  }
});
