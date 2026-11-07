// Tracker unificado: partida actual (log.txt) y progreso hacia Dead God (guardado). Solo lee archivos del juego.
const fs = require('fs');
const path = require('path');
const { safeJoin, send, serveFile, readBody, writeFile, readJson } = require('./lib/http.js');
const { pickFile } = require('./lib/filepicker.js');
const { RunLog } = require('./lib/log.js');
const { parseSave, summarize, listSaves, COUNTER_GOALS, WATCHED_ACHIEVEMENTS } = require('./lib/save.js');
const { loadGameData, floorLabel, CHARACTERS, TRANSFORMS, TRANSFORM_GOAL } = require('./lib/gamedata.js');

const APP_DIR = path.join(__dirname, 'app');
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
  saveId: null,
  saveFile: '',
  show: { character: true, seed: true, floor: true, items: true, description: false, transforms: true, achievements: true, collection: true, winStreak: true, marksHard: false, marksAny: false, challenges: false },
  goals: [],
  watched: [],
  options: { ...APPEARANCE, layout: 'banner', iconAuto: true, iconSize: 40, rows: 0, maxItems: 0, removed: 'hide', hideDone: false, floorGroups: true, transformsClose: true, highlight: true, highlightSeconds: 5 },
};
const LIMITS = { iconSize: [16, 96], rows: [0, 8], maxItems: [0, 200], highlightSeconds: [2, 20], fontSize: [10, 32], iconGap: [0, 16], rowGap: [0, 24], padding: [0, 32], radius: [0, 24], backgroundOpacity: [0, 100] };
const CHOICES = {
  layout: ['banner', 'wide'], removed: ['dim', 'hide'], background: ['transparent', 'solid', 'brick'], textEffect: ['none', 'shadow', 'outline'],
  iconEffect: ['none', 'glow', 'shadow'], align: ['left', 'center', 'right'], itemsPosition: ['above', 'below'],
};
const FLAGS = ['iconAuto', 'hideDone', 'floorGroups', 'transformsClose', 'bold', 'highlight'];
const COLORS = ['color', 'textColor', 'accentColor', 'doneColor', 'blindColor'];
// El nombre de la fuente acaba en CSS: solo letras, números, espacios y guiones.
const FONT_NAME = /^[\p{L}\p{N} _-]{1,40}$/u;

// Error causado por lo que eligió el usuario: su mensaje se le muestra tal cual en el panel.
class UserError extends Error {}

// Las rutas llegan de fuera: así funciona igual por su cuenta (server.js) o montado en otra aplicación.
function createTracker({ resDir, gameDir, steamUserdata, dataDir }) {
  const CONFIG_FILE = path.join(dataDir, 'config.json');
  const RUNS_FILE = path.join(dataDir, 'cache', 'runs.json');

  function loadConfig() {
    const c = readJson(CONFIG_FILE, {});
    return { ...DEFAULTS, ...c, show: { ...DEFAULTS.show, ...c.show }, options: { ...DEFAULTS.options, ...c.options } };
  }

  // Solo se aceptan claves y valores conocidos: el archivo se usa después sin más comprobaciones.
  function sanitizeConfig(b) {
    const out = loadConfig();
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
    if (!path.isAbsolute(file)) throw new UserError('Indica la ruta completa del archivo');
    let stat;
    try { stat = fs.statSync(file); } catch { throw new UserError('No existe el archivo: ' + file); }
    if (!stat.isFile()) throw new UserError('No es un archivo: ' + file);
    if (stat.size > MAX_SAVE_BYTES) throw new UserError('El archivo es demasiado grande para ser un guardado');
    try {
      return summarize(parseSave(fs.readFileSync(file)), gameData().collection);
    } catch (e) { throw new UserError(`${path.basename(file)} no es un guardado válido: ${e.message}`); }
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
    if (!saveId) throw new UserError('Elige un guardado');
    if (saveId !== CUSTOM_SAVE) {
      const s = saves().find(x => x.id === saveId);
      if (!s) throw new UserError('No se encuentra el guardado elegido: ' + saveId);
      return s;
    }
    if (!saveFile) throw new UserError('Elige un archivo de guardado');
    try { return { id: `${CUSTOM_SAVE}:${saveFile}`, file: saveFile, mtime: fs.statSync(saveFile).mtimeMs }; } catch {
      throw new UserError('No se encuentra el archivo: ' + saveFile);
    }
  }

  function readProgress(config) {
    let s;
    try { s = selectedSave(config); } catch (e) {
      if (!(e instanceof UserError)) throw e;
      return { id: null, file: null, progress: null, error: e.message };
    }
    if (saveCache.id !== s.id || saveCache.mtime !== s.mtime) {
      if (saveCache.id !== s.id) saveCache.progress = null;
      saveCache.id = s.id; saveCache.mtime = s.mtime;
      try {
        saveCache.progress = summarize(parseSave(fs.readFileSync(s.file)), gameData().collection);
        saveCache.error = null;
      } catch (e) { saveCache.error = String(e.message || e); }
    }
    return { id: s.id, file: s.file, mtime: s.mtime, progress: saveCache.progress, error: saveCache.error };
  }

  function runView() {
    const r = runLog.run;
    if (!r) return null;
    const { info, describe } = gameData();
    const items = r.items.filter(i => !(info[i.id] && info[i.id].shown === false)).map(i => {
      const it = info[i.id];
      const f = r.floors[i.floor];
      return { id: i.id, name: (it && it.name) || i.name, blind: i.blind, removed: i.removed, floor: i.floor, floorLabel: f ? floorLabel(f) : '', desc: describe(i.id), owner: i.owner, soul: !!i.soul, granted: !!i.granted };
    });
    const seen = {};
    for (const i of r.items) {
      const it = info[i.id];
      if (it && !i.soul) for (const k of Object.keys(TRANSFORMS)) if (it[k]) (seen[k] = seen[k] || new Set()).add(i.id);
    }
    const floor = r.floors[r.floors.length - 1];
    return {
      seed: r.seed, slot: r.slot,
      character: CHARACTERS[r.character] || '',
      floor: floor ? floorLabel(floor) : '',
      items,
      transforms: Object.keys(seen).map(k => ({ id: k, name: TRANSFORMS[k], count: seen[k].size, goal: TRANSFORM_GOAL })),
    };
  }

  function state() {
    const config = loadConfig();
    const save = readProgress(config);
    return { config, run: runView(), progress: save.progress, sources: { log: logStatus, save: { id: save.id, file: save.file, mtime: save.mtime, error: save.error } } };
  }

  function choices() {
    const { collection, achievements } = gameData();
    const achName = id => (achievements.get(id) || {}).name || `#${id}`;
    return {
      saves: saves().map(s => {
        let p = null;
        try { p = summarize(parseSave(fs.readFileSync(s.file)), collection); } catch { /* se muestra sin datos */ }
        return { id: s.id, account: s.account, slot: s.slot, mtime: s.mtime, achievements: p && p.achievements, deadGod: !!(p && p.deadGod) };
      }),
      goals: COUNTER_GOALS.map(g => ({ id: g.id, name: g.name, goal: g.goal })),
      watched: WATCHED_ACHIEVEMENTS.map(id => ({ id: 's' + id, name: achName(id) })),
      appearance: APPEARANCE,
    };
  }

  function serveIcon(res, rel) {
    const f = rel && safeJoin(resDir, rel);
    return f ? serveFile(res, f) : send(res, 404, { error: 'Sin icono' });
  }

  async function handle(req, res, url, pathname) {
    if (req.method === 'GET' && pathname === '/api/state') return send(res, 200, state());
    if (req.method === 'GET' && pathname === '/api/choices') return send(res, 200, choices());
    // Exigir JSON impide que una página web cualquiera lance estas acciones contra el servidor local.
    if (req.method === 'POST' && !String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'Se esperaba JSON' });
    if (req.method === 'POST' && pathname === '/api/config') {
      try {
        const cfg = sanitizeConfig(await readBody(req));
        writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
        return send(res, 200, cfg);
      } catch (e) {
        if (e instanceof UserError) return send(res, 400, { error: e.message });
        throw e;
      }
    }
    if (req.method === 'POST' && pathname === '/api/pick-save') return send(res, 200, { path: await pickFile(steamUserdata) });
    let m;
    if (req.method === 'GET' && (m = /^\/icon\/item\/(\d+)\.png$/.exec(pathname))) return serveIcon(res, gameData().icons.get(+m[1]));
    if (req.method === 'GET') {
      const f = safeJoin(APP_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
      return f ? serveFile(res, f) : send(res, 400, { error: 'Ruta inválida' });
    }
    send(res, 405, { error: 'Método no permitido' });
  }

  return { handle };
}

module.exports = { createTracker };
