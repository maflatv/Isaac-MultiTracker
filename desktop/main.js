// MultiTracker como aplicación de escritorio: el panel y la vista se abren en ventanas propias.
// No hace falta servidor: las páginas piden los datos por el protocolo multitracker://, que se atiende en este mismo proceso.
// Solo si el usuario lo activa se abre además http://localhost para la fuente de navegador de OBS.
const path = require('path');
const { app, BrowserWindow, Menu, dialog, protocol, screen, shell } = require('electron');
const { BASE_DIR, APP_ROOT } = require('../lib/runtime.js');
const { readJson, writeFile, cacheControl } = require('../lib/http.js');
const { resolvePaths } = require('../paths.js');
const { listen, hasResources, DEFAULT_PORT } = require('../server.js');
const { t, resolve } = require('../app/i18n.js');

const SCHEME = 'multitracker';
const ORIGIN = `${SCHEME}://app`;
const DATA_DIR = path.join(BASE_DIR, 'userdata');
// Tamaño y posición de las ventanas, para abrirlas como se dejaron en la sesión anterior.
const WINDOWS_FILE = path.join(DATA_DIR, 'windows.json');
const ICON = path.join(APP_ROOT, 'build', 'icon.ico');
const OBS_PORT = Number(process.env.PORT) || DEFAULT_PORT;
// Tamaño del área útil de la vista: el mismo banner que la ventana de Rebirth Item Tracker.
const VIEW_SIZE = { width: 900, height: 121 };
const PANEL_SIZE = { width: 1280, height: 860 };
const DARK = '#1d1714';

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
// Portable de verdad: los datos de Chromium también se guardan junto al .exe, no en AppData.
app.setPath('userData', path.join(DATA_DIR, 'chromium'));

let tracker = null;
let panel = null;
let view = null;
const obs = { server: null, running: false, error: null };

const language = () => (tracker ? tracker.language() : resolve(readJson(path.join(DATA_DIR, 'config.json'), {}).language));

// Las páginas no pueden salir del programa: los enlaces externos se abren en el navegador.
function guard(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN) && new URL(url).pathname === '/overlay.html') openView();
    else if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN + '/')) return;
    e.preventDefault();
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
}

function createWindow(options, title) {
  const win = new BrowserWindow({
    title, icon: ICON, backgroundColor: DARK, autoHideMenuBar: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    ...options,
  });
  // Títulos fijos: así se distinguen las dos ventanas al elegirlas en la «Captura de ventana» de OBS.
  win.on('page-title-updated', e => e.preventDefault());
  win.once('ready-to-show', () => win.show());
  guard(win);
  return win;
}

function openPanel() {
  if (panel) { if (panel.isMinimized()) panel.restore(); panel.focus(); return; }
  const saved = savedBounds('panel', PANEL_SIZE);
  panel = createWindow({ ...saved, minWidth: 820, minHeight: 480 }, 'MultiTracker');
  if (saved.maximized) panel.maximize();
  panel.on('close', () => saveBounds('panel', { ...panel.getNormalBounds(), maximized: panel.isMaximized() }));
  panel.on('closed', () => { panel = null; });
  panel.loadURL(ORIGIN + '/');
}

// Se recuerda dónde dejó el usuario cada ventana, siempre que siga dentro de una pantalla.
function savedBounds(id, size) {
  const b = (readJson(WINDOWS_FILE, {}) || {})[id];
  if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return size;
  const visible = screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return b.x < a.x + a.width && b.x + 40 > a.x && b.y < a.y + a.height && b.y + 20 > a.y;
  });
  return visible ? b : { width: b.width, height: b.height, maximized: b.maximized };
}

function saveBounds(id, bounds) {
  writeFile(WINDOWS_FILE, JSON.stringify({ ...readJson(WINDOWS_FILE, {}), [id]: bounds }, null, 2));
}

// El tamaño de la vista es una opción del panel (ancho y alto); windows.json solo guarda dónde estaba la ventana.
const viewSize = () => {
  const o = tracker.config().options;
  return { width: o.viewWidth || VIEW_SIZE.width, height: o.viewHeight || VIEW_SIZE.height };
};

function openView() {
  if (view) { if (view.isMinimized()) view.restore(); view.focus(); return; }
  view = createWindow({ ...savedBounds('view', VIEW_SIZE), ...viewSize(), useContentSize: true, minWidth: 200, minHeight: 60 }, 'MultiTracker · Tracker');
  // Con useContentSize, x e y son la posición de la ventana y el ancho y el alto los del contenido.
  // Guardar la posición del contenido desplazaría la ventana el alto de la barra de título en cada sesión.
  view.on('close', () => {
    const { x, y } = view.getBounds(), { width, height } = view.getContentBounds();
    saveBounds('view', { x, y, width, height });
  });
  // Estirar la ventana cambia el ancho y el alto del panel; se espera a que el usuario suelte el borde.
  let resizing = null;
  view.on('resize', () => {
    clearTimeout(resizing);
    resizing = setTimeout(() => {
      if (!view || view.isMinimized() || view.isMaximized()) return;
      const { width, height } = view.getContentBounds();
      tracker.setViewSize(width, height);
    }, 300);
  });
  view.on('closed', () => { view = null; clearTimeout(resizing); });
  view.loadURL(ORIGIN + '/overlay.html');
}

// Un ancho o un alto escritos en el panel se aplican a la ventana abierta.
function syncViewSize() {
  if (!view || view.isMinimized() || view.isMaximized()) return;
  const want = viewSize(), now = view.getContentBounds();
  if (want.width !== now.width || want.height !== now.height) view.setContentSize(want.width, want.height);
}

function openFileDialog(initialDir, text) {
  return dialog.showOpenDialog(panel || undefined, {
    title: text.title, defaultPath: initialDir, properties: ['openFile'],
    filters: [{ name: text.filter, extensions: ['dat'] }, { name: text.all, extensions: ['*'] }],
  }).then(r => (r.canceled ? null : r.filePaths[0]));
}

// Abre o cierra el puerto para OBS según la opción del panel. Si el puerto está ocupado, se reintenta en el siguiente cambio.
function syncObs(config) {
  if (config.obsServer && !obs.server) {
    obs.error = null;
    obs.server = listen(tracker.handle, OBS_PORT, e => {
      obs.running = !e;
      if (e) { obs.error = e.code || String(e); obs.server = null; }
    });
  } else if (!config.obsServer && obs.server) {
    obs.server.close();
    obs.server = null;
    obs.running = false;
    obs.error = null;
  }
}

async function serve(request) {
  const url = new URL(request.url);
  if (url.host !== 'app') return new Response('Not found', { status: 404 });
  const r = await tracker.respond({
    method: request.method,
    pathname: decodeURIComponent(url.pathname),
    contentType: request.headers.get('content-type'),
    readJsonBody: async () => JSON.parse(await request.text()),
  });
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.type, 'Cache-Control': cacheControl(r.cache) } });
}

function start() {
  const paths = resolvePaths(BASE_DIR);
  if (!hasResources(paths)) {
    const lang = language();
    dialog.showMessageBoxSync({ type: 'error', title: 'MultiTracker', message: t(lang, 'start.noResources'), detail: t(lang, 'start.noResourcesSteps') });
    app.quit();
    return;
  }
  const { createTracker } = require('../tracker.js');
  tracker = createTracker({ ...paths, dataDir: DATA_DIR }, {
    desktop: true,
    pickFile: openFileDialog,
    onConfig: config => { syncObs(config); syncViewSize(); },
    obsStatus: () => ({ running: obs.running, error: obs.error, port: OBS_PORT, url: `http://localhost:${OBS_PORT}/overlay.html` }),
  });
  protocol.handle(SCHEME, request => serve(request).catch(e => {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }));
  syncObs(tracker.config());
  Menu.setApplicationMenu(null);
  openPanel();
}

// Una sola copia del programa: abrirlo otra vez lleva al panel que ya está abierto.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (tracker) openPanel(); });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start);
}
