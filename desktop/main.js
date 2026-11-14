// MultiTracker como aplicación de escritorio: el panel y la vista se abren en ventanas propias.
// No hace falta servidor: las páginas piden los datos por el protocolo multitracker://, que se atiende en este mismo proceso.
// Solo si el usuario lo activa se abre además http://localhost para la fuente de navegador de OBS.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, dialog, protocol, screen, shell } = require('electron');
const { BASE_DIR, APP_ROOT, IS_INSTALLED, IS_ADVANCED, APP_NAME } = require('../lib/runtime.js');
const { readJson, writeFile, cacheControl, send } = require('../lib/http.js');
const { resolvePaths } = require('../paths.js');
const { listen, DEFAULT_PORT } = require('../server.js');
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
// Vista de carrera: cuatro franjas con el alto de la ventana del tracker.
const RACE_SIZE = { width: 900, height: 484 };
const DARK = '#1d1714';

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
// Los datos de Chromium van con los demás ajustes: en el portable, junto al .exe y no en AppData.
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
    else if (url.startsWith(ORIGIN) && new URL(url).pathname === '/race.html') openRace();
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
  panel = createWindow({ ...saved, minWidth: 820, minHeight: 480 }, app.isPackaged ? `${APP_NAME} ${app.getVersion()}` : APP_NAME);
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
  view = createWindow({ ...savedBounds('view', VIEW_SIZE), ...viewSize(), useContentSize: true, minWidth: 200, minHeight: 60 }, `${APP_NAME} · Tracker`);
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
  view.on('closed', () => { view = null; viewProfile = null; clearTimeout(resizing); });
  loadViewProfile();
}

// Vista de carrera: hasta 4 partidas de otras personas en una ventana. Recuerda su sitio y su tamaño.
let race = null;
function openRace() {
  if (race) { if (race.isMinimized()) race.restore(); race.focus(); return; }
  race = createWindow({ ...savedBounds('race', RACE_SIZE), minWidth: 200, minHeight: 120 }, `${APP_NAME} · ${t(language(), 'race.title')}`);
  race.on('close', () => saveBounds('race', race.getBounds()));
  race.on('closed', () => { race = null; });
  race.loadURL(`${ORIGIN}/race.html`);
}

// La ventana del tracker usa el perfil elegido en el panel; si se cambia con la ventana abierta, se recarga con él.
let viewProfile = null;
function loadViewProfile() {
  const profile = tracker.config().windowProfile;
  if (!view || profile === viewProfile) return;
  viewProfile = profile;
  view.loadURL(`${ORIGIN}/overlay.html?profile=${encodeURIComponent(profile)}`);
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

// OBS solo carga la vista: por este puerto no se cambia nada (configuración, fondo, selector de archivos), así que
// ningún otro programa del PC puede tocar los ajustes a través de él. El panel usa su propio protocolo, sin puerto.
function obsHandle(req, res, url, pathname) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Read-only' });
  return tracker.handle(req, res, url, pathname);
}

// Abre o cierra el puerto para OBS según la opción del panel. Si el puerto está ocupado, se reintenta en el siguiente cambio.
function syncObs(config) {
  if (config.obsServer && !obs.server) {
    obs.error = null;
    obs.server = listen(obsHandle, OBS_PORT, e => {
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
    query: url.searchParams,
  });
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.type, 'Cache-Control': cacheControl(r.cache) } });
}

// ---------- Actualizaciones (solo la versión instalada) ----------
// Busca al arrancar y cada UPDATE_CHECK_MS. Nunca descarga sin que el usuario lo pida en el panel; lo descargado
// se instala al reiniciar desde el aviso o, si no, al cerrar MultiTracker. Descarga solo lo que cambia (blockmap).
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
let updater = null;
// state: idle, checking, latest, available, downloading, ready, error. manual: la búsqueda la pidió el usuario.
const update = { state: 'idle', version: null, percent: 0, error: null, manual: false };

function setupUpdater() {
  // La edición avanzada no se publica: no tiene de dónde actualizarse.
  if (!IS_INSTALLED || IS_ADVANCED) return;
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch { return; }
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-available', i => Object.assign(update, { state: 'available', version: i.version, error: null }));
  updater.on('update-not-available', () => Object.assign(update, { state: 'latest', error: null }));
  updater.on('download-progress', p => Object.assign(update, { state: 'downloading', percent: Math.floor(p.percent) }));
  updater.on('update-downloaded', i => Object.assign(update, { state: 'ready', version: i.version, percent: 100 }));
  // Sin conexión, por ejemplo. Una búsqueda automática que falla no molesta: solo se informa si la pidió el usuario
  // o si fallaba una descarga.
  updater.on('error', e => {
    const shown = update.manual || update.state === 'downloading';
    Object.assign(update, { state: shown ? 'error' : 'idle', error: String((e && e.message) || e).split(/\r?\n/)[0] });
  });
  checkUpdates(false);
  setInterval(() => { if (['idle', 'latest', 'error'].includes(update.state)) checkUpdates(false); }, UPDATE_CHECK_MS).unref();
}

function checkUpdates(manual) {
  Object.assign(update, { state: 'checking', manual, error: null });
  updater.checkForUpdates().catch(() => { /* lo informa el evento error */ });
}

// Lo que pide el panel: check, download o install. Devuelve el estado.
function updateAction(action) {
  if (!updater) return updateStatus();
  if (action === 'check' && !['checking', 'downloading', 'ready'].includes(update.state)) checkUpdates(true);
  else if (action === 'download' && update.state === 'available') {
    Object.assign(update, { state: 'downloading', percent: 0 });
    updater.downloadUpdate().catch(() => { /* lo informa el evento error */ });
  } else if (action === 'install' && update.state === 'ready') {
    // En silencio (sin el asistente del instalador) y volviendo a abrir MultiTracker al terminar.
    setImmediate(() => updater.quitAndInstall(true, true));
  }
  return updateStatus();
}
const updateStatus = () => ({ ...update, enabled: !!updater, installed: IS_INSTALLED });

// ---------- Primer arranque de la versión instalada ----------
// Sus ajustes van en %APPDATA%\MultiTracker. Quien venía del portable puede traer los suyos (configuración, perfiles,
// temas, tiempo de juego, imagen de fondo) eligiendo la carpeta del MultiTracker.exe portable.
const PORTABLE_DATA = ['config.json', 'playtime.json', 'windows.json', 'cache', 'background.png', 'background.jpg', 'background.gif', 'background.webp'];
const copyData = from => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const f of PORTABLE_DATA) if (fs.existsSync(path.join(from, f))) fs.cpSync(path.join(from, f), path.join(DATA_DIR, f), { recursive: true });
};
function firstRun() {
  const config = path.join(DATA_DIR, 'config.json');
  if (!IS_INSTALLED || fs.existsSync(config)) return;
  const lang = resolve(app.getLocale());
  // La edición avanzada, instalada junto a la normal, se lleva sus ajustes si se le pide.
  const standard = path.join(app.getPath('appData'), 'MultiTracker', 'userdata');
  if (IS_ADVANCED && fs.existsSync(path.join(standard, 'config.json'))) {
    const { t: at } = require('../app/livesplit-i18n.js');
    const answer = dialog.showMessageBoxSync({
      type: 'question', title: APP_NAME, message: at(lang, 'install.importStandard'),
      buttons: [at(lang, 'install.importYes'), at(lang, 'install.importNo')], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (answer === 0) { copyData(standard); return; }
  }
  const answer = dialog.showMessageBoxSync({
    type: 'question', title: 'MultiTracker', message: t(lang, 'install.importMessage'), detail: t(lang, 'install.importDetail'),
    buttons: [t(lang, 'install.importButton'), t(lang, 'install.freshButton')], defaultId: 0, cancelId: 1, noLink: true,
  });
  while (answer === 0) {
    const picked = dialog.showOpenDialogSync({ title: t(lang, 'install.pickFolder'), properties: ['openDirectory'] });
    if (!picked) break;
    // Vale la carpeta del .exe portable o su carpeta userdata.
    const from = [path.join(picked[0], 'userdata'), picked[0]].find(d => fs.existsSync(path.join(d, 'config.json')));
    if (from) { copyData(from); return; }
    dialog.showMessageBoxSync({ type: 'warning', title: 'MultiTracker', message: t(lang, 'install.notFound'), noLink: true });
  }
  // Sin importar: un archivo vacío (todo por defecto) para no volver a preguntar.
  writeFile(config, '{}');
}

function start() {
  firstRun();
  setupUpdater();
  const paths = resolvePaths(BASE_DIR);
  const { createTracker } = require('../tracker.js');
  tracker = createTracker({ ...paths, dataDir: DATA_DIR }, {
    desktop: true,
    edition: IS_ADVANCED ? 'avanzada' : null,
    extensions: IS_ADVANCED ? [require('../lib/splitter.js').createSplitter] : [],
    // La del .exe (package.json de build/build-exe.js); desde el código no hay versión.
    version: app.isPackaged ? app.getVersion() : null,
    update: { status: updateStatus, action: updateAction },
    pickFile: openFileDialog,
    onConfig: config => { syncObs(config); syncViewSize(); loadViewProfile(); },
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
  app.whenReady().then(start).catch(e => {
    console.error(e);
    dialog.showErrorBox('MultiTracker', String(e.stack || e));
    app.quit();
  });
}
