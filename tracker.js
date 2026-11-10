// Tracker unificado: partida actual (log.txt) y progreso hacia Dead God (guardado). Solo lee archivos del juego.
const fs = require('fs');
const path = require('path');
const { safeJoin, MIME, send, readBody, writeFile, readJson } = require('./lib/http.js');
const { readAsset } = require('./lib/runtime.js');
const { pickFile } = require('./lib/filepicker.js');
const { activeSteamAccount } = require('./paths.js');
const { listFonts } = require('./lib/fonts.js');
const { RunLog } = require('./lib/log.js');
const { createAchievementIcons } = require('./lib/steamicons.js');
const { COSTUMES, OWNER_SPRITES } = require('./lib/resources.js');
const { SaveError, parseSave, summarize, listSaves, COUNTER_GOALS, WATCHED_ACHIEVEMENTS } = require('./lib/save.js');
const { loadGameData, floorLabel, TRANSFORMS, TRANSFORM_GOAL } = require('./lib/gamedata.js');
const { LANGUAGES, resolve: resolveLanguage, t } = require('./app/i18n.js');

const LOG_POLL_MS = 1000;
// El contador de frames de la partida avanza 30 veces por segundo.
const GAME_FPS = 30;
const PLAYTIME_VERSION = 1;

const CUSTOM_SAVE = 'custom';
const MAX_SAVE_BYTES = 1024 * 1024;

// Lo que cambian los temas del panel; el resto de opciones no les afecta.
const APPEARANCE = {
  font: 'Upheaval', fontSize: 20, bold: true, textEffect: 'shadow',
  // Resaltado de la línea del personaje (personaje, piso, seed, racha...): contorno o brillo alrededor de cada letra.
  whoOutline: 'outline', whoOutlineColor: '#000000', whoOutlineSize: 2,
  textColor: '#f0e4d8', accentColor: '#f0ad4e', doneColor: '#8fd18f',
  blindColor: '#c77dff',
  iconGap: 2, iconEffect: 'none',
  // Cabeza de quien lleva el objeto (Jacob y Esaú, Tainted Lazarus): sobre un círculo de su color o sola, su tamaño
  // respecto al icono y la esquina donde va (bl, br, tl, tr: abajo/arriba e izquierda/derecha).
  ownerBadgeBg: false, ownerBadgeSize: 'medium', ownerBadgeCorner: 'bl',
  rowGap: 6, padding: 8, radius: 0, align: 'left', itemsPosition: 'below',
  // Ancho de la columna lateral del banner: automático (según su contenido) o fijo.
  sideAuto: true, sideWidth: 180,
  background: 'transparent', color: '#1d1714', backgroundOpacity: 100,
};
const DEFAULTS = {
  // Inglés por defecto; el usuario lo cambia en el panel y queda guardado en config.json.
  language: 'en',
  saveId: null,
  saveFile: '',
  // Solo en la aplicación de escritorio: servir la vista por http://localhost para la fuente de navegador de OBS.
  obsServer: false,
  // Perfil que usa la ventana del tracker y el del enlace para OBS ('main' es la configuración principal).
  windowProfile: 'main', obsProfile: 'main',
  // Temas guardados por el usuario: [{ id, name, options }], comunes a todos los perfiles.
  themes: [],
  show: { character: true, seed: true, floor: true, runTime: false, items: true, description: false, transforms: true, playtime: false, achievements: true, collection: true, winStreak: true, marksHard: false, marksAny: false, challenges: false },
  goals: [],
  watched: [],
  options: {
    ...APPEARANCE, layout: 'banner', iconAuto: true, iconSize: 40, rows: 0, maxItems: 0, removed: 'hide', markItem: 'hover', hoverDesc: true, progressStyle: 'icons', pendingLook: 'color', hideDone: false, floorGroups: true, transformsClose: true, highlight: true, highlightSeconds: 5,
    // Cómo se destaca el objeto recién tomado: pantalla completa, aviso en una esquina, vuelo hasta su hueco, foco sobre
    // él, marquesina o solo un pulso en su icono.
    highlightStyle: 'full',
    // Tamaño del área útil de la ventana del tracker: por defecto, el de la ventana de Rebirth Item Tracker.
    viewWidth: 900, viewHeight: 121,
    // Maldición del ciego: 'floor' solo en el separador del piso, 'items' también en cada objeto, 'none' sin marca.
    blindMark: 'floor',
    // Imagen de fondo propia, aparte de los temas. bgImage: "<extensión>:<marca de tiempo>" o '' sin imagen; solo la cambia /api/background.
    bgImage: '', bgImageOpacity: 100, bgImageFit: 'cover', bgImageScale: 100, bgImageX: 50, bgImageY: 50,
  },
};
const LIMITS = {
  iconSize: [16, 96], rows: [0, 8], maxItems: [0, 200], highlightSeconds: [2, 20], fontSize: [10, 32], iconGap: [0, 16], rowGap: [0, 24], padding: [0, 32], radius: [0, 24], backgroundOpacity: [0, 100],
  viewWidth: [200, 3840], viewHeight: [60, 2160], whoOutlineSize: [1, 4], bgImageOpacity: [0, 100], bgImageScale: [10, 400], bgImageX: [0, 100], bgImageY: [0, 100],
  sideWidth: [120, 400],
};
const CHOICES = {
  layout: ['banner', 'wide'], removed: ['dim', 'hide'], markItem: ['none', 'latest', 'hover'], background: ['transparent', 'solid', 'brick'], textEffect: ['none', 'shadow', 'outline'],
  iconEffect: ['none', 'glow', 'shadow'], progressStyle: ['icons', 'text'], pendingLook: ['color', 'gray'], align: ['left', 'center', 'right'], itemsPosition: ['above', 'below'],
  bgImageFit: ['cover', 'contain', 'stretch', 'tile', 'scale'], blindMark: ['floor', 'items', 'none'],
  whoOutline: ['none', 'outline', 'glow'],
  ownerBadgeSize: ['small', 'medium', 'large'], ownerBadgeCorner: ['bl', 'br', 'tl', 'tr'],
  highlightStyle: ['full', 'toast', 'fly', 'spotlight', 'ticker', 'pulse'],
};
// Imagen de fondo: se reconoce por sus primeros bytes, no por lo que diga quien la envía.
const BG_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const BG_IMAGE_TYPES = {
  png: { mime: 'image/png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  gif: { mime: 'image/gif', test: b => /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1')) },
  webp: { mime: 'image/webp', test: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};
const FLAGS = ['iconAuto', 'hideDone', 'floorGroups', 'transformsClose', 'bold', 'highlight', 'hoverDesc', 'ownerBadgeBg', 'sideAuto'];
const COLORS = ['color', 'textColor', 'accentColor', 'doneColor', 'blindColor', 'whoOutlineColor'];
// El nombre de la fuente acaba en CSS entre comillas dobles: se admiten los caracteres de los nombres de fuentes
// instaladas (letras, números, espacios, guiones, puntos, paréntesis, &, + y apóstrofos), nunca comillas dobles ni barras.
const FONT_NAME = /^[\p{L}\p{N} _\-.&+'()]{1,60}$/u;

// Perfiles: la configuración principal ('main') y otras con sus propios ajustes de lo que se muestra y cómo.
// Cada vista elige el suyo con ?profile= en la dirección (la ventana del tracker, la fuente de OBS, la vista previa).
const MAIN = 'main';
const PROFILE_ID = /^p[0-9a-z]{1,20}$/;
const THEME_ID = /^t[0-9a-z]{1,20}$/;
const MAX_PROFILES = 10;
const MAX_THEMES = 30;
const NAME_MAX = 40;
// Comunes a todos los perfiles: la ventana del tracker es una sola y la imagen de fondo, un solo archivo.
const GLOBAL_OPTIONS = ['viewWidth', 'viewHeight', 'bgImage'];
// Lo que no es de un perfil sino del programa: guardado, idioma, OBS y qué perfil usa cada vista.
const GLOBAL_KEYS = ['language', 'obsServer', 'saveId', 'saveFile', 'windowProfile', 'obsProfile'];
// Nombres escritos por el usuario: sin caracteres de control y con un largo razonable.
const cleanName = s => (typeof s === 'string' ? s.replace(/\p{Cc}/gu, '').trim().slice(0, NAME_MAX) : '');
const newId = prefix => prefix + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);

// Copia en out solo las opciones conocidas con valores válidos. Devuelve out.
function sanitizeOptions(o, out) {
  o = o && typeof o === 'object' ? o : {};
  for (const [k, [min, max]] of Object.entries(LIMITS)) if (Number.isFinite(o[k])) out[k] = Math.min(max, Math.max(min, Math.round(o[k])));
  for (const [k, values] of Object.entries(CHOICES)) if (values.includes(o[k])) out[k] = o[k];
  for (const k of FLAGS) if (typeof o[k] === 'boolean') out[k] = o[k];
  for (const k of COLORS) if (/^#[0-9a-f]{6}$/i.test(o[k] || '')) out[k] = o[k];
  if (FONT_NAME.test(o.font || '')) out.font = o.font.trim();
  return out;
}
// Un tema solo guarda la apariencia (las claves de APPEARANCE), partiendo de la apariencia por defecto.
const themeOptions = o => {
  const all = sanitizeOptions(o, { ...APPEARANCE });
  return Object.fromEntries(Object.keys(APPEARANCE).map(k => [k, all[k]]));
};

// Error causado por lo que eligió el usuario: su mensaje (clave de app/i18n.js) se le muestra traducido en el panel.
class UserError extends Error {
  constructor(key, vars) { super(key); this.key = key; this.vars = vars; }
}

// Las rutas llegan de fuera: así funciona igual por su cuenta, en la aplicación de escritorio o montado en otra aplicación.
// options: { desktop, pickFile(initialDir, text), obsStatus(), onConfig(config) }.
function createTracker({ resDir, gameDir, steamUserdata, dataDir }, options = {}) {
  const CONFIG_FILE = path.join(dataDir, 'config.json');
  const RUNS_FILE = path.join(dataDir, 'cache', 'runs.json');
  // Fuera de cache/: no se puede volver a calcular, así que no debe borrarse al limpiar la caché.
  const PLAYTIME_FILE = path.join(dataDir, 'playtime.json');
  const APP_ASSETS = 'app';
  const choosePath = options.pickFile || pickFile;
  const achievementIcons = createAchievementIcons({ steamUserdata, cacheDir: path.join(dataDir, 'cache', 'achievements') });

  // El archivo tal cual: lo común y la configuración principal arriba, los demás perfiles en profiles y los temas en themes.
  const readStored = () => {
    const c = readJson(CONFIG_FILE, {});
    return c && typeof c === 'object' ? c : {};
  };
  const profilesOf = stored => (stored.profiles && typeof stored.profiles === 'object' ? stored.profiles : {});
  const profileId = (stored, id) => (id && id !== MAIN && Object.hasOwn(profilesOf(stored), id) ? id : MAIN);

  // La configuración que ve una vista: lo común más los ajustes de su perfil (el principal si no existe).
  function loadConfig(profile) {
    const c = readStored(), profiles = profilesOf(c), id = profileId(c, profile);
    const own = id === MAIN ? c : profiles[id];
    const config = {
      ...DEFAULTS, ...c, profile: id,
      show: { ...DEFAULTS.show, ...own.show }, goals: Array.isArray(own.goals) ? own.goals : [], watched: Array.isArray(own.watched) ? own.watched : [],
      options: { ...DEFAULTS.options, ...own.options },
      themes: Array.isArray(c.themes) ? c.themes : [],
      profileList: [{ id: MAIN, name: '' }, ...Object.entries(profiles).map(([pid, p]) => ({ id: pid, name: p.name }))],
    };
    for (const k of GLOBAL_OPTIONS) config.options[k] = { ...DEFAULTS.options, ...c.options }[k];
    for (const k of ['windowProfile', 'obsProfile']) config[k] = profileId(c, config[k]);
    delete config.profiles;
    return config;
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
  // Devuelve la configuración de la vista de ese perfil con los cambios; writeConfig() la reparte en el archivo.
  function sanitizeConfig(b, profile) {
    const out = loadConfig(profile), stored = readStored();
    if (Object.prototype.hasOwnProperty.call(LANGUAGES, b.language)) out.language = b.language;
    if (typeof b.obsServer === 'boolean') out.obsServer = b.obsServer;
    for (const k of ['windowProfile', 'obsProfile']) if (typeof b[k] === 'string' && profileId(stored, b[k]) === b[k]) out[k] = b[k];
    if (b.saveId === null || b.saveId === CUSTOM_SAVE || saves().some(s => s.id === b.saveId)) out.saveId = b.saveId;
    if (typeof b.saveFile === 'string' && b.saveFile !== out.saveFile) {
      readSaveFile(b.saveFile);
      out.saveFile = b.saveFile;
    }
    for (const k of Object.keys(DEFAULTS.show)) if (b.show && typeof b.show[k] === 'boolean') out.show[k] = b.show[k];
    const known = (list, ids) => (Array.isArray(list) ? list.filter(id => ids.includes(id)) : null);
    out.goals = known(b.goals, COUNTER_GOALS.map(g => g.id)) || out.goals;
    out.watched = known(b.watched, WATCHED_ACHIEVEMENTS.map(id => 's' + id)) || out.watched;
    sanitizeOptions(b.options, out.options);
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

  // ---------- Tiempo de juego por archivo ----------
  // El juego no lo guarda: se suma desde el contador de frames del log. Cada partida guarda su máximo, así que
  // releer el mismo log no cuenta dos veces, y continuar una partida suma también lo jugado sin el tracker abierto.
  // Una seed jugada dos veces como partida nueva en el mismo archivo cuenta solo la más larga.
  const saved = readJson(PLAYTIME_FILE, null);
  const times = saved && saved.version === PLAYTIME_VERSION && saved.files && typeof saved.files === 'object' ? saved : { version: PLAYTIME_VERSION, files: {} };
  let timesChanged = false;

  // La ranura viene en el log; la cuenta, de la sesión de Steam abierta o, si no, del guardado de esa ranura modificado más tarde.
  function saveIdForSlot(slot) {
    const candidates = saves().filter(s => s.slot === +slot);
    const active = activeSteamAccount();
    const s = candidates.find(x => x.account === active) || candidates.sort((a, b) => b.mtime - a.mtime)[0];
    return s ? s.id : null;
  }
  function recordFrames(run) {
    if (!run.saveId) run.saveId = saveIdForSlot(run.slot);
    if (!run.saveId) return;
    const file = times.files[run.saveId] || (times.files[run.saveId] = { runs: {} });
    const entry = file.runs[run.seed] || (file.runs[run.seed] = { frames: 0 });
    if (run.frames <= entry.frames) return;
    entry.frames = run.frames;
    if (run.character !== null && run.character !== undefined) entry.character = run.character;
    timesChanged = true;
  }
  const secondsOf = saveId => {
    const file = saveId && times.files[saveId];
    return file ? Math.round(Object.values(file.runs).reduce((n, r) => n + r.frames, 0) / GAME_FPS) : 0;
  };
  // Un archivo elegido a mano cuenta como el guardado de Steam o local que sea, si es uno de ellos.
  const timeIdOf = (id, file) => {
    if (!id || !id.startsWith(CUSTOM_SAVE + ':')) return id;
    const same = saves().find(s => path.resolve(s.file).toLowerCase() === path.resolve(file).toLowerCase());
    return same ? same.id : null;
  };

  const runLog = new RunLog(path.join(gameDir, 'log.txt'), readJson(RUNS_FILE, {}), id => gameData().actives.has(id), id => gameData().quests.has(id), recordFrames);
  // missing: el juego aún no ha creado log.txt (por ejemplo, antes de abrirlo por primera vez). No es un fallo.
  const logStatus = { ok: false, missing: false, error: null };
  function pollLog() {
    try {
      if (runLog.poll()) writeFile(RUNS_FILE, JSON.stringify(runLog.snapshot()));
      if (timesChanged) { writeFile(PLAYTIME_FILE, JSON.stringify(times)); timesChanged = false; }
      logStatus.ok = true; logStatus.missing = false; logStatus.error = null;
    } catch (e) {
      logStatus.ok = false;
      logStatus.missing = e.code === 'ENOENT';
      logStatus.error = logStatus.missing ? null : String(e.message || e);
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
      // Lo de Esau (Alma de Jacob y Esaú) y del Keeper de Strawman cuenta para ellos, no para el personaje.
      if (it && !i.soul && !i.helper) for (const k of Object.keys(TRANSFORMS)) if (it[k]) (seen[k] = seen[k] || new Set()).add(i.id);
    }
    const floor = r.floors[r.floors.length - 1];
    return {
      seed: r.seed, slot: r.slot, seconds: Math.round((r.frames || 0) / GAME_FPS),
      character: characterName(r.character, lang),
      floor: floor ? floorLabel(floor) : '',
      items,
      transforms: Object.keys(seen).map(k => ({ id: k, name: transformName(k, lang), count: seen[k].size, goal: TRANSFORM_GOAL })),
    };
  }

  function state(profile) {
    const config = loadConfig(profile);
    const lang = languageOf(config);
    const save = readProgress(config, lang);
    return {
      lang, desktop: !!options.desktop, obs: options.obsStatus ? options.obsStatus() : null,
      config, run: runView(lang), progress: save.progress,
      // Segundos jugados en el archivo elegido desde que se registra; null si no es un guardado conocido.
      playtime: timeIdOf(save.id, save.file) ? secondsOf(timeIdOf(save.id, save.file)) : null,
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
        return { id: s.id, account: s.account, slot: s.slot, mtime: s.mtime, achievements: p && p.achievements, deadGod: !!(p && p.deadGod), playtime: secondsOf(s.id) };
      }),
      goals: COUNTER_GOALS.map(g => ({ id: g.id, name: t(lang, 'goal.' + g.id), goal: g.goal })),
      watched: WATCHED_ACHIEVEMENTS.map(id => ({ id: 's' + id, name: achievementName(id, lang) })),
      appearance: APPEARANCE,
      // Para el botón «Restablecer» de cada sección del panel.
      defaults: { show: DEFAULTS.show, goals: DEFAULTS.goals, watched: DEFAULTS.watched, options: DEFAULTS.options },
    };
  }

  // Reparte la configuración de una vista en el archivo: lo común arriba y los ajustes en su perfil.
  // Devuelve la configuración de esa vista ya guardada.
  function writeConfig(view) {
    const stored = readStored(), id = profileId(stored, view.profile);
    const full = { ...stored };
    for (const k of GLOBAL_KEYS) full[k] = view[k];
    const own = { show: view.show, goals: view.goals, watched: view.watched, options: { ...view.options } };
    if (id === MAIN) Object.assign(full, own);
    else {
      full.options = { ...DEFAULTS.options, ...stored.options };
      for (const k of GLOBAL_OPTIONS) { full.options[k] = own.options[k]; delete own.options[k]; }
      full.profiles = { ...profilesOf(stored), [id]: { ...profilesOf(stored)[id], ...own } };
    }
    return persist(full, id);
  }

  function persist(full, profile) {
    writeFile(CONFIG_FILE, JSON.stringify(full, null, 2));
    if (options.onConfig) options.onConfig(loadConfig());
    return loadConfig(profile);
  }

  // ---------- Perfiles ----------
  // create: copia los ajustes del perfil from; rename y delete. La configuración principal no se renombra ni se borra.
  function profileAction(b) {
    const stored = readStored(), profiles = { ...profilesOf(stored) };
    const name = cleanName(b.name);
    if (b.action === 'create') {
      if (!name) throw new UserError('err.profileName');
      if (Object.keys(profiles).length >= MAX_PROFILES) throw new UserError('err.tooManyProfiles', { max: MAX_PROFILES });
      const from = loadConfig(b.from), id = newId('p'), opts = { ...from.options };
      for (const k of GLOBAL_OPTIONS) delete opts[k];
      profiles[id] = { name, show: from.show, goals: from.goals, watched: from.watched, options: opts };
      return persist({ ...stored, profiles }, id);
    }
    if (!PROFILE_ID.test(b.id || '') || !Object.hasOwn(profiles, b.id)) throw new UserError('err.profileMissing');
    if (b.action === 'rename') {
      if (!name) throw new UserError('err.profileName');
      profiles[b.id] = { ...profiles[b.id], name };
      return persist({ ...stored, profiles }, b.id);
    }
    if (b.action === 'delete') {
      delete profiles[b.id];
      const full = { ...stored, profiles };
      for (const k of ['windowProfile', 'obsProfile']) if (full[k] === b.id) full[k] = MAIN;
      return persist(full, MAIN);
    }
    throw new UserError('err.badAction');
  }

  // ---------- Temas del usuario ----------
  // save: guarda la apariencia recibida con un nombre; rename y delete. Devuelve la lista de temas.
  function themeAction(b) {
    const stored = readStored(), themes = Array.isArray(stored.themes) ? [...stored.themes] : [];
    const name = cleanName(b.name);
    if (b.action === 'save') {
      if (!name) throw new UserError('err.themeName');
      if (themes.length >= MAX_THEMES) throw new UserError('err.tooManyThemes', { max: MAX_THEMES });
      themes.push({ id: newId('t'), name, options: themeOptions(b.options) });
    } else {
      const i = THEME_ID.test(b.id || '') ? themes.findIndex(x => x.id === b.id) : -1;
      if (i < 0) throw new UserError('err.themeMissing');
      if (b.action === 'rename') {
        if (!name) throw new UserError('err.themeName');
        themes[i] = { ...themes[i], name };
      } else if (b.action === 'delete') themes.splice(i, 1);
      else throw new UserError('err.badAction');
    }
    writeFile(CONFIG_FILE, JSON.stringify({ ...stored, themes }, null, 2));
    return { themes };
  }

  // ---------- Imagen de fondo ----------
  // Se guarda una copia en userdata/ como background.<extensión>: así no depende de dónde estuviera la original.
  const bgFile = ext => path.join(dataDir, 'background.' + ext);
  function setBackground(b, profile) {
    let buf = null, ext = '';
    if (!b.remove) {
      // Se comprueba antes de tocar nada: una imagen que no sirve no borra la que ya había.
      const m = /^data:[\w/+.-]*;base64,([A-Za-z0-9+/=]+)$/.exec(typeof b.data === 'string' ? b.data : '');
      buf = m ? Buffer.from(m[1], 'base64') : null;
      ext = (buf && buf.length <= BG_IMAGE_MAX_BYTES && Object.keys(BG_IMAGE_TYPES).find(k => BG_IMAGE_TYPES[k].test(buf))) || '';
      if (!ext) throw new UserError('err.bgImage');
    }
    for (const other of Object.keys(BG_IMAGE_TYPES)) if (other !== ext) fs.rmSync(bgFile(other), { force: true });
    if (ext) writeFile(bgFile(ext), buf);
    const cfg = loadConfig(profile);
    cfg.options.bgImage = ext ? `${ext}:${Date.now()}` : '';
    return writeConfig(cfg);
  }
  function background() {
    const ext = loadConfig().options.bgImage.split(':')[0];
    if (!BG_IMAGE_TYPES[ext]) return json(404, { error: 'No background' });
    try { return { status: 200, type: BG_IMAGE_TYPES[ext].mime, body: fs.readFileSync(bgFile(ext)) }; } catch { return json(404, { error: 'No background' }); }
  }

  // La ventana del tracker guarda aquí su tamaño cuando el usuario la estira. No avisa a onConfig: ya tiene ese tamaño.
  function setViewSize(width, height) {
    const stored = readStored(), now = { ...DEFAULTS.options, ...stored.options };
    const [w, h] = [[width, LIMITS.viewWidth], [height, LIMITS.viewHeight]].map(([v, [min, max]]) => Math.min(max, Math.max(min, Math.round(v))));
    if (now.viewWidth === w && now.viewHeight === h) return;
    writeFile(CONFIG_FILE, JSON.stringify({ ...stored, options: { ...stored.options, viewWidth: w, viewHeight: h } }, null, 2));
  }

  const json = (status, body) => ({ status, type: MIME['.json'], body: JSON.stringify(body) });
  const file = (buf, rel) => (buf ? { status: 200, type: MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream', body: buf } : json(404, { error: 'Not found' }));

  // cache: la vista puede reutilizar la imagen. Un icono que falta no se marca, por si aparece después.
  function icon(rel) {
    const f = rel && safeJoin(resDir, rel);
    if (!f) return json(404, { error: 'No icon' });
    try { return { ...file(fs.readFileSync(f), f), cache: true }; } catch { return json(404, { error: 'No icon' }); }
  }

  // Responde a una petición sin depender de cómo llega: servidor HTTP, Isaac Suite o la ventana de escritorio.
  // readJsonBody() devuelve el cuerpo ya interpretado. Devuelve { status, type, body }.
  // query: los parámetros de la dirección (URLSearchParams); profile elige el perfil de la vista.
  const POST_ACTIONS = {
    '/api/config': (body, profile) => writeConfig(sanitizeConfig(body, profile)),
    '/api/background': (body, profile) => setBackground(body, profile),
    '/api/profiles': body => profileAction(body),
    '/api/themes': body => themeAction(body),
  };
  async function respond({ method, pathname, contentType, readJsonBody, query = new URLSearchParams() }) {
    const profile = query.get('profile');
    if (method === 'GET' && pathname === '/api/state') return json(200, state(profile));
    if (method === 'GET' && pathname === '/api/choices') return json(200, choices());
    if (method === 'GET' && pathname === '/api/fonts') return json(200, { fonts: await listFonts() });
    // Exigir JSON impide que una página web cualquiera lance estas acciones contra el servidor local.
    if (method === 'POST' && !String(contentType).startsWith('application/json')) return json(415, { error: 'Expected JSON' });
    if (method === 'POST' && Object.hasOwn(POST_ACTIONS, pathname)) {
      try {
        const body = await readJsonBody();
        return json(200, POST_ACTIONS[pathname](body && typeof body === 'object' ? body : {}, profile));
      } catch (e) {
        if (e instanceof UserError) return json(400, { error: T(e.key, e.vars) });
        throw e;
      }
    }
    if (method === 'GET' && pathname === '/background') return background();
    if (method === 'POST' && pathname === '/api/pick-save') {
      return json(200, { path: await choosePath(steamUserdata, { title: T('picker.title'), filter: T('picker.filter'), all: T('picker.all') }) });
    }
    let m;
    if (method === 'GET' && (m = /^\/icon\/item\/(\d+)\.png$/.exec(pathname))) return icon(gameData().icons.get(+m[1]));
    if (method === 'GET' && (m = /^\/icon\/owner\/(\w+)\/(head|hair)\.png$/.exec(pathname)) && Object.hasOwn(OWNER_SPRITES, m[1]) && OWNER_SPRITES[m[1]][m[2]]) {
      return icon(path.join(COSTUMES, OWNER_SPRITES[m[1]][m[2]]));
    }
    if (method === 'GET' && (m = /^\/icon\/achievement\/(\d+)\.jpg$/.exec(pathname))) {
      const img = await achievementIcons.get(+m[1]);
      return img ? { status: 200, type: 'image/jpeg', body: img, cache: true } : json(404, { error: 'No icon' });
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
    const r = await respond({ method: req.method, pathname, contentType: req.headers['content-type'], readJsonBody: () => readBody(req), query: url.searchParams });
    send(res, r.status, r.body, r.type, r.cache);
  }

  return { respond, handle, config: loadConfig, setViewSize, language: () => languageOf(loadConfig()), T };
}

module.exports = { createTracker };
