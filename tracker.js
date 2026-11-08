// Tracker unificado: partida actual (log.txt) y progreso hacia Dead God (guardado). Solo lee archivos del juego.
const fs = require('fs');
const path = require('path');
const { safeJoin, MIME, send, readBody, writeFile, readJson } = require('./lib/http.js');
const { readAsset } = require('./lib/runtime.js');
const { pickFile } = require('./lib/filepicker.js');
const { RunLog } = require('./lib/log.js');
const { createAchievementIcons } = require('./lib/steamicons.js');
const { SaveError, parseSave, summarize, listSaves, COUNTER_GOALS, WATCHED_ACHIEVEMENTS } = require('./lib/save.js');
const { loadGameData, floorLabel, TRANSFORMS, TRANSFORM_GOAL } = require('./lib/gamedata.js');
const { LANGUAGES, resolve: resolveLanguage, t } = require('./app/i18n.js');

const LOG_POLL_MS = 1000;

const CUSTOM_SAVE = 'custom';
const MAX_SAVE_BYTES = 1024 * 1024;

// Lo que cambian los temas del panel; el resto de opciones no les afecta.
const APPEARANCE = {
  font: 'Upheaval', fontSize: 20, bold: true, textEffect: 'shadow',
  textColor: '#f0e4d8', accentColor: '#f0ad4e', doneColor: '#8fd18f',
  blindColor: '#c77dff',
  iconGap: 2, iconEffect: 'none',
  rowGap: 6, padding: 8, radius: 0, align: 'left', itemsPosition: 'below',
  background: 'transparent', color: '#1d1714', backgroundOpacity: 100,
};
const DEFAULTS = {
  // Inglés por defecto; el usuario lo cambia en el panel y queda guardado en config.json.
  language: 'en',
  saveId: null,
  saveFile: '',
  // Solo en la aplicación de escritorio: servir la vista por http://localhost para la fuente de navegador de OBS.
  obsServer: false,
  show: { character: true, seed: true, floor: true, items: true, description: false, transforms: true, achievements: true, collection: true, winStreak: true, marksHard: false, marksAny: false, challenges: false },
  goals: [],
  watched: [],
  options: { ...APPEARANCE, layout: 'banner', iconAuto: true, iconSize: 40, rows: 0, maxItems: 0, removed: 'hide', progressStyle: 'icons', pendingLook: 'color', hideDone: false, floorGroups: true, transformsClose: true, highlight: true, highlightSeconds: 5 },
};
const LIMITS = { iconSize: [16, 96], rows: [0, 8], maxItems: [0, 200], highlightSeconds: [2, 20], fontSize: [10, 32], iconGap: [0, 16], rowGap: [0, 24], padding: [0, 32], radius: [0, 24], backgroundOpacity: [0, 100] };
const CHOICES = {
  layout: ['banner', 'wide'], removed: ['dim', 'hide'], background: ['transparent', 'solid', 'brick'], textEffect: ['none', 'shadow', 'outline'],
  iconEffect: ['none', 'glow', 'shadow'], progressStyle: ['icons', 'text'], pendingLook: ['color', 'gray'], align: ['left', 'center', 'right'], itemsPosition: ['above', 'below'],
};
const FLAGS = ['iconAuto', 'hideDone', 'floorGroups', 'transformsClose', 'bold', 'highlight'];
const COLORS = ['color', 'textColor', 'accentColor', 'doneColor', 'blindColor'];
// El nombre de la fuente acaba en CSS: solo letras, números, espacios y guiones.
const FONT_NAME = /^[\p{L}\p{N} _-]{1,40}$/u;

// Error causado por lo que eligió el usuario: su mensaje (clave de app/i18n.js) se le muestra traducido en el panel.
class UserError extends Error {
  constructor(key, vars) { super(key); this.key = key; this.vars = vars; }
}

// Las rutas llegan de fuera: así funciona igual por su cuenta, en la aplicación de escritorio o montado en otra aplicación.
// options: { desktop, pickFile(initialDir, text), obsStatus(), onConfig(config) }.
function createTracker({ resDir, gameDir, steamUserdata, dataDir }, options = {}) {
  const CONFIG_FILE = path.join(dataDir, 'config.json');
  const RUNS_FILE = path.join(dataDir, 'cache', 'runs.json');
  const APP_ASSETS = 'app';
  const choosePath = options.pickFile || pickFile;
  const achievementIcons = createAchievementIcons({ steamUserdata, cacheDir: path.join(dataDir, 'cache', 'achievements') });

  function loadConfig() {
    const c = readJson(CONFIG_FILE, {});
    return { ...DEFAULTS, ...c, show: { ...DEFAULTS.show, ...c.show }, options: { ...DEFAULTS.options, ...c.options } };
  }
  const languageOf = config => resolveLanguage(config.language);
  const T = (key, vars) => t(languageOf(loadConfig()), key, vars);
  // Mensaje de un error en el idioma actual: los propios llevan una clave; los del sistema se muestran tal cual.
  const describeError = (e, lang) => {
    if (e instanceof UserError) return t(lang, e.key, e.vars);
    if (e instanceof SaveError) return t(lang, e.message);
    return String((e && e.message) || e);
  };

  // Solo se aceptan claves y valores conocidos: el archivo se usa después sin más comprobaciones.
  function sanitizeConfig(b) {
    const out = loadConfig();
    if (Object.prototype.hasOwnProperty.call(LANGUAGES, b.language)) out.language = b.language;
    if (typeof b.obsServer === 'boolean') out.obsServer = b.obsServer;
    if (b.saveId === null || b.saveId === CUSTOM_SAVE || saves().some(s => s.id === b.saveId)) out.saveId = b.saveId;
    if (typeof b.saveFile === 'string' && b.saveFile !== out.saveFile) {
      readSaveFile(b.saveFile);
      out.saveFile = b.saveFile;
    }
    for (const k of Object.keys(DEFAULTS.show)) if (b.show && typeof b.show[k] === 'boolean') out.show[k] = b.show[k];
    const known = (list, ids) => (Array.isArray(list) ? list.filter(id => ids.includes(id)) : null);
    out.goals = known(b.goals, COUNTER_GOALS.map(g => g.id)) || out.goals;
    out.watched = known(b.watched, WATCHED_ACHIEVEMENTS.map(id => 's' + id)) || out.watched;
    const o = b.options || {};
    for (const [k, [min, max]] of Object.entries(LIMITS)) if (Number.isFinite(o[k])) out.options[k] = Math.min(max, Math.max(min, Math.round(o[k])));
    for (const [k, values] of Object.entries(CHOICES)) if (values.includes(o[k])) out.options[k] = o[k];
    for (const k of FLAGS) if (typeof o[k] === 'boolean') out.options[k] = o[k];
    for (const k of COLORS) if (/^#[0-9a-f]{6}$/i.test(o[k] || '')) out.options[k] = o[k];
    if (FONT_NAME.test(o.font || '')) out.options.font = o.font.trim();
    return out;
  }

  // Lee y comprueba un archivo elegido a mano. Lanza un error con el motivo si no sirve.
  function readSaveFile(file) {
    if (!path.isAbsolute(file)) throw new UserError('err.fullPath');
    let stat;
    try { stat = fs.statSync(file); } catch { throw new UserError('err.fileNotFound', { file }); }
    if (!stat.isFile()) throw new UserError('err.notAFile', { file });
    if (stat.size > MAX_SAVE_BYTES) throw new UserError('err.tooBig');
    try {
      return summarize(parseSave(fs.readFileSync(file)), gameData().collection);
    } catch (e) { throw new UserError('err.invalidSave', { name: path.basename(file), reason: describeError(e, languageOf(loadConfig())) }); }
  }

  // ---------- Fuentes ----------
  let data = null;
  const gameData = () => (data = data || loadGameData(resDir));
  const saves = () => listSaves(steamUserdata, gameDir);

  const runLog = new RunLog(path.join(gameDir, 'log.txt'), readJson(RUNS_FILE, {}), id => gameData().actives.has(id), id => gameData().quests.has(id));
  const logStatus = { ok: false, error: null };
  function pollLog() {
    try {
      if (runLog.poll()) writeFile(RUNS_FILE, JSON.stringify(runLog.snapshot()));
      logStatus.ok = true; logStatus.error = null;
    } catch (e) {
      logStatus.ok = false; logStatus.error = String(e.message || e);
    }
  }
  // Se sigue el log aunque no haya ninguna vista abierta, para detectar cuándo el juego lo reinicia.
  setInterval(pollLog, LOG_POLL_MS).unref();
  pollLog();

  // Se conserva la última lectura válida: el juego puede estar escribiendo el archivo justo en ese momento.
  const saveCache = { id: null, mtime: 0, progress: null, error: null };
  // Nunca se cambia de archivo por iniciativa propia: otro guardado mostraría un progreso que no es el elegido.
  function selectedSave({ saveId, saveFile }) {
    if (!saveId) throw new UserError('err.chooseSave');
    if (saveId !== CUSTOM_SAVE) {
      const s = saves().find(x => x.id === saveId);
      if (!s) throw new UserError('err.saveNotFound', { id: saveId });
      return s;
    }
    if (!saveFile) throw new UserError('err.chooseFile');
    try { return { id: `${CUSTOM_SAVE}:${saveFile}`, file: saveFile, mtime: fs.statSync(saveFile).mtimeMs }; } catch {
      throw new UserError('err.fileNotFound', { file: saveFile });
    }
  }

  function readProgress(config, lang) {
    let s;
    try { s = selectedSave(config); } catch (e) {
      if (!(e instanceof UserError)) throw e;
      return { id: null, file: null, progress: null, error: describeError(e, lang) };
    }
    if (saveCache.id !== s.id || saveCache.mtime !== s.mtime) {
      if (saveCache.id !== s.id) saveCache.progress = null;
      saveCache.id = s.id; saveCache.mtime = s.mtime;
      try {
        saveCache.progress = summarize(parseSave(fs.readFileSync(s.file)), gameData().collection);
        saveCache.error = null;
      } catch (e) { saveCache.error = e; }
    }
    return { id: s.id, file: s.file, mtime: s.mtime, progress: saveCache.progress, error: saveCache.error && describeError(saveCache.error, lang) };
  }

  function runView(lang) {
    const r = runLog.run;
    if (!r) return null;
    const { info, itemName, characterName, transformName, describe } = gameData();
    const items = r.items.filter(i => !(info[i.id] && info[i.id].shown === false)).map(i => {
      const f = r.floors[i.floor];
      return { id: i.id, name: itemName(i.id, lang, i.name), blind: i.blind, removed: i.removed, floor: i.floor, floorLabel: f ? floorLabel(f) : '', desc: describe(i.id, lang), owner: i.owner, soul: !!i.soul, granted: !!i.granted };
    });
    const seen = {};
    for (const i of r.items) {
      const it = info[i.id];
      if (it && !i.soul) for (const k of Object.keys(TRANSFORMS)) if (it[k]) (seen[k] = seen[k] || new Set()).add(i.id);
    }
    const floor = r.floors[r.floors.length - 1];
    return {
      seed: r.seed, slot: r.slot,
      character: characterName(r.character, lang),
      floor: floor ? floorLabel(floor) : '',
      items,
      transforms: Object.keys(seen).map(k => ({ id: k, name: transformName(k, lang), count: seen[k].size, goal: TRANSFORM_GOAL })),
    };
  }

  function state() {
    const config = loadConfig();
    const lang = languageOf(config);
    const save = readProgress(config, lang);
    return {
      lang, desktop: !!options.desktop, obs: options.obsStatus ? options.obsStatus() : null,
      config, run: runView(lang), progress: save.progress,
      sources: { log: logStatus, save: { id: save.id, file: save.file, mtime: save.mtime, error: save.error } },
    };
  }

  function choices() {
    const lang = languageOf(loadConfig());
    const { collection, achievementName } = gameData();
    return {
      languages: LANGUAGES,
      saves: saves().map(s => {
        let p = null;
        try { p = summarize(parseSave(fs.readFileSync(s.file)), collection); } catch { /* se muestra sin datos */ }
        return { id: s.id, account: s.account, slot: s.slot, mtime: s.mtime, achievements: p && p.achievements, deadGod: !!(p && p.deadGod) };
      }),
      goals: COUNTER_GOALS.map(g => ({ id: g.id, name: t(lang, 'goal.' + g.id), goal: g.goal })),
      watched: WATCHED_ACHIEVEMENTS.map(id => ({ id: 's' + id, name: achievementName(id, lang) })),
      appearance: APPEARANCE,
    };
  }

  const json = (status, body) => ({ status, type: MIME['.json'], body: JSON.stringify(body) });
  const file = (buf, rel) => (buf ? { status: 200, type: MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream', body: buf } : json(404, { error: 'Not found' }));

  function icon(rel) {
    const f = rel && safeJoin(resDir, rel);
    if (!f) return json(404, { error: 'No icon' });
    try { return file(fs.readFileSync(f), f); } catch { return json(404, { error: 'No icon' }); }
  }

  // Responde a una petición sin depender de cómo llega: servidor HTTP, Isaac Suite o la ventana de escritorio.
  // readJsonBody() devuelve el cuerpo ya interpretado. Devuelve { status, type, body }.
  async function respond({ method, pathname, contentType, readJsonBody }) {
    if (method === 'GET' && pathname === '/api/state') return json(200, state());
    if (method === 'GET' && pathname === '/api/choices') return json(200, choices());
    // Exigir JSON impide que una página web cualquiera lance estas acciones contra el servidor local.
    if (method === 'POST' && !String(contentType).startsWith('application/json')) return json(415, { error: 'Expected JSON' });
    if (method === 'POST' && pathname === '/api/config') {
      try {
        const cfg = sanitizeConfig(await readJsonBody());
        writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
        if (options.onConfig) options.onConfig(cfg);
        return json(200, cfg);
      } catch (e) {
        if (e instanceof UserError) return json(400, { error: T(e.key, e.vars) });
        throw e;
      }
    }
    if (method === 'POST' && pathname === '/api/pick-save') {
      return json(200, { path: await choosePath(steamUserdata, { title: T('picker.title'), filter: T('picker.filter'), all: T('picker.all') }) });
    }
    let m;
    if (method === 'GET' && (m = /^\/icon\/item\/(\d+)\.png$/.exec(pathname))) return icon(gameData().icons.get(+m[1]));
    if (method === 'GET' && (m = /^\/icon\/achievement\/(\d+)\.jpg$/.exec(pathname))) {
      const img = await achievementIcons.get(+m[1]);
      return img ? { status: 200, type: 'image/jpeg', body: img } : json(404, { error: 'No icon' });
    }
    if (method === 'GET') {
      const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (!safeJoin(path.resolve('/', APP_ASSETS), rel)) return json(400, { error: 'Invalid path' });
      return file(readAsset(path.posix.join(APP_ASSETS, rel)), rel);
    }
    return json(405, { error: 'Method not allowed' });
  }

  // Adaptador para un servidor http de Node (server.js e Isaac Suite).
  async function handle(req, res, url, pathname) {
    const r = await respond({ method: req.method, pathname, contentType: req.headers['content-type'], readJsonBody: () => readBody(req) });
    send(res, r.status, r.body, r.type);
  }

  return { respond, handle, config: loadConfig, language: () => languageOf(loadConfig()), T };
}

module.exports = { createTracker };
