/**
 * main.js — Electron main process for AiVoiceChanger
 *
 * Architecture:
 *   Electron window ──IPC──► preload.js ──WS/HTTP──► Python FastAPI (child process)
 *
 * Startup sequence:
 *   1. Find a free port
 *   2. Spawn Python backend with --port <port>
 *   3. Wait for "READY:{port}" on stdout
 *   4. Create BrowserWindow loading localhost:{port}
 *   5. Set up system tray
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
} = require('electron');

const path    = require('path');
const net     = require('net');
const { spawn } = require('child_process');
const fs      = require('fs');

// ── Constants ─────────────────────────────────────────────────────────────────
const APP_ROOT    = path.join(__dirname, '..');
const ASSETS_DIR  = path.join(APP_ROOT, 'assets');
const ICON_PATH   = path.join(ASSETS_DIR, 'icon.png');

// Try to load electron-store for persistent window bounds
let Store;
try { Store = require('electron-store'); } catch (_) { Store = null; }
const store = Store ? new Store() : null;

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow   = null;
let tray         = null;
let pythonProc   = null;
let backendPort  = null;
let isQuitting   = false;
let restartCount = 0;
const MAX_RESTARTS = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function findPython() {
  // Check for venv first
  const venvPython = path.join(APP_ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) return venvPython;

  // Try system pythons
  const candidates = ['python3', 'python'];
  for (const p of candidates) {
    try {
      const { execFileSync } = require('child_process');
      execFileSync(p, ['--version'], { stdio: 'ignore' });
      return p;
    } catch (_) { /* continue */ }
  }
  return 'python3';
}

// ── Python backend ────────────────────────────────────────────────────────────
async function startPythonBackend() {
  const port   = await getFreePort();
  backendPort  = port;
  const python = findPython();
  const script = path.join(APP_ROOT, 'main.py');

  console.log(`[electron] Spawning Python: ${python} ${script} --port ${port}`);

  const proc = spawn(python, [script, '--port', String(port)], {
    cwd:   APP_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env:   {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      // ── OpenMP conflict fix ──────────────────────────────────────────────
      // faiss-cpu, PyTorch, and scikit-learn each bundle their own libomp.dylib.
      // On macOS ARM64 having multiple OpenMP runtimes loaded simultaneously
      // causes __kmp_suspend_initialize_thread to dereference a NULL kmp_info*
      // (SIGSEGV at 0x580) the moment FAISS spawns a parallel index search.
      //
      // KMP_DUPLICATE_LIB_OK=TRUE tells the Intel OMP runtime to tolerate the
      // duplicate instead of aborting.  OMP_NUM_THREADS=1 ensures FAISS never
      // enters a multi-threaded barrier at all — the safest mitigation and has
      // negligible throughput impact at real-time RVC chunk sizes.
      KMP_DUPLICATE_LIB_OK: 'TRUE',
      OMP_NUM_THREADS:       '1',
      MKL_NUM_THREADS:       '1',   // keep MKL single-threaded as well
    },
  });

  pythonProc = proc;

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) reject(new Error('Python backend timed out (120s)'));
    }, 120000);

    proc.stdout.on('data', (data) => {
      const text = data.toString().trim();
      console.log(`[python] ${text}`);

      // Look for READY signal
      const match = text.match(/READY:(\d+)/);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) console.error(`[python-err] ${text}`);
    });

    proc.on('exit', (code, signal) => {
      console.warn(`[electron] Python exited (code=${code}, signal=${signal})`);
      pythonProc = null;
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error(`Python exited with code ${code}`));
      }
      // Auto-restart unless we are quitting
      if (!isQuitting && restartCount < MAX_RESTARTS) {
        restartCount++;
        const delay = Math.min(restartCount * 2000, 10000);
        console.log(`[electron] Restarting Python in ${delay}ms (attempt ${restartCount})`);
        setTimeout(() => {
          startPythonBackend()
            .then((p) => {
              backendPort = p;
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.loadURL(`http://127.0.0.1:${p}`);
                mainWindow.webContents.send('backend:ready', p);
              }
            })
            .catch(console.error);
        }, delay);
      }
    });
  });
}

function stopPythonBackend() {
  if (pythonProc) {
    try { pythonProc.kill('SIGTERM'); } catch (_) {}
    pythonProc = null;
  }
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow(port) {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  const bounds = store ? store.get('windowBounds', { width: 1280, height: 800 }) : { width: 1280, height: 800 };

  mainWindow = new BrowserWindow({
    width:           Math.max(bounds.width,  900),
    height:          Math.max(bounds.height, 640),
    minWidth:        900,
    minHeight:       640,
    frame:           false,        // Custom titlebar
    transparent:     false,
    backgroundColor: '#0a0a0f',
    titleBarStyle:   process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy:        null,
    show:            false,
    icon:            fs.existsSync(ICON_PATH) ? nativeImage.createFromPath(ICON_PATH) : undefined,
    webPreferences: {
      preload:              path.join(__dirname, 'preload.js'),
      contextIsolation:     true,
      nodeIntegration:      false,
      webSecurity:          true,
      allowRunningInsecureContent: false,
    },
  });

  // Load the Python backend
  const backendURL = `http://127.0.0.1:${port}`;
  let loadRetries = 0;
  const MAX_LOAD_RETRIES = 10;

  function tryLoadURL() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(backendURL);
    }
  }

  // Small delay before first load — the READY signal means the health check
  // passed, but Chromium can still race with the server's accept queue.
  setTimeout(tryLoadURL, 300);

  // ── Renderer error logging ────────────────────────────────────────────────
  mainWindow.webContents.on('did-fail-load', (event, code, desc, url) => {
    console.error(`[renderer] did-fail-load  code=${code}  desc=${desc}  url=${url}`);

    // Retry on connection-refused / connection-reset (backend still starting)
    if ((code === -102 || code === -101 || code === -6) && loadRetries < MAX_LOAD_RETRIES) {
      loadRetries++;
      const delay = Math.min(500 * loadRetries, 3000);
      console.log(`[electron] Retrying page load in ${delay}ms (attempt ${loadRetries}/${MAX_LOAD_RETRIES})`);
      setTimeout(tryLoadURL, delay);
    }
  });
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[renderer] render-process-gone:', JSON.stringify(details));
  });
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) { // 2=warning 3=error
      console.error(`[renderer-console] ${message}  (${sourceId}:${line})`);
    }
  });

  // ── Open DevTools in development ─────────────────────────────────────────
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--devtools')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // ── Show window reliably ─────────────────────────────────────────────────
  // ready-to-show fires on first-paint opportunity.  If React throws during
  // hydration the DOM stays empty and first-paint never happens — the window
  // stays hidden permanently (black screen).
  // Fallback: force-show after 12 s so the user always sees something.
  let windowShown = false;
  const showFallback = setTimeout(() => {
    if (!windowShown && mainWindow && !mainWindow.isDestroyed()) {
      console.warn('[electron] ready-to-show never fired — forcing window visible');
      mainWindow.show();
      windowShown = true;
    }
  }, 12000);

  mainWindow.once('ready-to-show', () => {
    clearTimeout(showFallback);
    if (!windowShown) {
      mainWindow.show();
      windowShown = true;
    }
    restartCount = 0;
  });

  // Save window bounds
  mainWindow.on('resize', () => {
    if (store && mainWindow && !mainWindow.isDestroyed()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  });

  // Minimize to tray instead of close (like Voicemod)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (tray) {
        tray.displayBalloon?.({
          title:   'RVC Voicechanger',
          content: 'Still running in the background',
        });
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Send backend port to renderer once it connects
  mainWindow.webContents.on('did-finish-load', () => {
    loadRetries = 0;  // Reset retry counter on successful load
    mainWindow.webContents.send('backend:ready', port);
  });

  return mainWindow;
}

// ── System Tray ───────────────────────────────────────────────────────────────
function createTray() {
  // Use a simple template image or the app icon
  const iconPath = fs.existsSync(ICON_PATH) ? ICON_PATH : undefined;
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('RVC Voicechanger');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        stopPythonBackend();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) { mainWindow.focus(); }
      else { mainWindow.show(); }
    }
  });
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────
function registerIPC() {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.handle('window:close', () => {
    if (!isQuitting) { mainWindow?.hide(); }
    else { mainWindow?.close(); }
  });
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

  ipcMain.handle('dialog:openFile', async (_event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'RVC Model Files', extensions: ['pth', 'index'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      ...options,
    });
    return result;
  });

  ipcMain.handle('app:getBackendPort', () => backendPort);
  ipcMain.handle('app:hideToTray', () => mainWindow?.hide());
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // macOS: don't quit when all windows closed
  app.on('activate', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    else if (backendPort) { createWindow(backendPort); }
  });

  registerIPC();

  if (process.platform === 'darwin' && fs.existsSync(ICON_PATH)) {
    try {
      app.dock.setIcon(nativeImage.createFromPath(ICON_PATH));
    } catch (err) {
      console.error('Failed to set dock icon:', err);
    }
  }

  try {
    const port = await startPythonBackend();
    console.log(`[electron] Python backend ready on port ${port}`);
    backendPort = port;
    createWindow(port);
    createTray();
  } catch (err) {
    console.error('[electron] Failed to start backend:', err);
    // Show error dialog
    await dialog.showErrorBox(
      'RVC Voicechanger — Startup Error',
      `Could not start the audio backend:\n\n${err.message}\n\nMake sure Python and all dependencies are installed.\nRun: pip install -r requirements.txt`
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // On macOS, keep the app running (Voicemod-style)
  if (process.platform !== 'darwin') {
    isQuitting = true;
    stopPythonBackend();
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopPythonBackend();
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
