// Edición avanzada: cronómetro con splits automáticos a partir del guardado (logros, marcas, retos...) y del log
// (partidas, pisos, finales). Se monta en tracker.js como extensión: la edición normal no lo carga.
// El cronómetro es propio (lib/timer.js): se ve como fuente de OBS en overlay.html?part=timer, con el tema del perfil.
//
// Modos de Dead God (varias sesiones): route (la ruta del usuario, importada de su .lss), characters, blocks, types y
// runs. El tiempo se guarda: al volver otro día se retoma donde se dejó. Modos de una partida: floors y chapters
// (como el autosplitter clásico de Isaac).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFile, readJson } = require('./http.js');
const { parseSave, CHUNK } = require('./save.js');
const { floorLabel } = require('./gamedata.js');
const { createTimer, formatTime } = require('./timer.js');
const S = require('./splits.js');
const L = require('./lss.js');

const TICK_MS = 500;
const STORE_EVERY_MS = 2000;
const VERSION = 2;
const DEAD_GOD_MODES = ['route', 'characters', 'blocks', 'types', 'runs'];
const RUN_MODES = ['floors', 'chapters'];
const MODES = [...DEAD_GOD_MODES, ...RUN_MODES];
const MAX_SEGMENTS = 400;
const MAX_CONDS = 600;
const NAME_MAX = 80;
const LOG_SIZE = 12;
// Si el guardado pierde de golpe más logros que esto, es otro archivo (una run nueva desde cero).
const FRESH_FILE_DROP = 5;
const TIMER_OPS = ['start', 'split', 'skip', 'undo', 'pause', 'resume', 'reset'];
// Copias de seguridad que se hacen antes de importar un .lss (userdata/backups/): se guardan las últimas.
const KEEP_BACKUPS = 5;

const DEFAULT_SETTINGS = {
  enabled: false, mode: 'route',
  blockSize: 64, runCount: 100,
  // Empezar el tiempo con la primera partida (y retomarlo si ya había uno guardado).
  autoStart: true,
  // Dead God: pausar al cerrar el juego y seguir al volver a abrirlo (las reglas permiten pausar al terminar la sesión).
  pauseOnClose: true,
  // Pausar mientras el juego está en pausa y seguir al quitarla (necesita el mod «MultiTracker Pause»).
  pauseWithGame: true,
  // Modos de una partida: reiniciar al empezar otra y llevar el tiempo de juego (frames del log) en vez del real.
  autoReset: true, gameTime: false,
  // Fuente del cronómetro: segmentos a la vista, si se ven el tiempo del segmento actual, el PB y la suma de golds,
  // y el tamaño (en %) de la letra de la lista y del reloj.
  rows: 10, showSegment: true, showPb: true, showSob: true, textSize: 100, clockSize: 100,
};
const LIMITS = { blockSize: [8, 320], runCount: [5, 500], rows: [3, 30], textSize: [50, 250], clockSize: [50, 250] };
const FLAGS = ['enabled', 'autoStart', 'pauseOnClose', 'pauseWithGame', 'autoReset', 'gameTime', 'showSegment', 'showPb', 'showSob'];

function cleanSettings(b, current) {
  const out = { ...current };
  if (!b || typeof b !== 'object') return out;
  for (const k of FLAGS) if (typeof b[k] === 'boolean') out[k] = b[k];
  for (const [k, [min, max]] of Object.entries(LIMITS)) if (Number.isFinite(b[k])) out[k] = Math.min(max, Math.max(min, Math.round(b[k])));
  if (MODES.includes(b.mode)) out.mode = b.mode;
  return out;
}

const cleanName = s => (typeof s === 'string' ? s.replace(/\p{Cc}/gu, '').trim().slice(0, NAME_MAX) : '');

function cleanRoute(r) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.segments)) return null;
  const segments = r.segments.slice(0, MAX_SEGMENTS).map(s => ({
    name: cleanName(s && s.name) || '?',
    conds: (Array.isArray(s && s.conds) ? s.conds : []).slice(0, MAX_CONDS).map(S.cleanCondition).filter(Boolean),
    sure: !!(s && s.sure),
  }));
  if (!segments.length) return null;
  return { name: cleanName(r.name), game: cleanName(r.game), category: cleanName(r.category), segments };
}

// ctx: { dataDir, gameData(), selectedSave() → { id, file } | null, currentRun() }
function createSplitter(ctx) {
  const FILE = path.join(ctx.dataDir, 'livesplit.json');
  const stored = readJson(FILE, {}) || {};
  const data = {
    version: VERSION,
    settings: cleanSettings(stored.settings, DEFAULT_SETTINGS),
    route: cleanRoute(stored.route),
    // Run de Dead God en curso: guardado al que pertenece, tiempo acumulado (s), logros vistos y si terminó.
    session: { saveId: null, base: 0, achCount: 0, finished: false, ...(stored.session || {}) },
    // Copia hecha al importar el último .lss: se puede deshacer hasta que empiece otro intento.
    lastImport: typeof stored.lastImport === 'string' ? stored.lastImport : null,
  };
  const persist = () => writeFile(FILE, JSON.stringify(data, null, 2));
  const timer = ctx.timer || createTimer({ file: path.join(ctx.dataDir, 'timer.json') });

  // doneAtStart: segmentos ya conseguidos al empezar o retomar; se saltan sin tiempo en vez de cerrarse ahora.
  // snapshot: segmentos conseguidos en la última lectura; reached: el segmento actual y si ya lo estaba al llegar a él.
  const live = { doneAtStart: null, snapshot: new Set(), reached: { index: -1, done: false }, lastStore: 0, error: null, gamePaused: false };
  const saveCache = { file: null, mtime: 0, facts: null, total: 0, challenges: 0, error: null };
  const actions = [];
  const note = (key, vars) => {
    actions.unshift({ at: Date.now(), key, vars });
    actions.length = Math.min(actions.length, LOG_SIZE);
  };
  // Partida actual en el modo por partida: la seed y si ya se hizo su split.
  const runSplit = { seed: null, done: false };

  const deadGodMode = () => DEAD_GOD_MODES.includes(data.settings.mode);

  function readFacts() {
    const s = ctx.selectedSave();
    if (!s) { saveCache.facts = null; saveCache.error = 'err.noSave'; return null; }
    let mtime = 0;
    try { mtime = fs.statSync(s.file).mtimeMs; } catch { saveCache.error = 'err.noSave'; return saveCache.facts; }
    if (saveCache.file !== s.file || saveCache.mtime !== mtime) {
      try {
        const chunks = parseSave(fs.readFileSync(s.file));
        saveCache.facts = S.saveFacts(chunks, ctx.gameData().collection);
        saveCache.total = chunks[CHUNK.achievements].length - 1;
        saveCache.challenges = chunks[CHUNK.challenges].length - 1;
        saveCache.file = s.file; saveCache.mtime = mtime; saveCache.error = null;
      } catch { /* el juego lo está escribiendo: se usa la última lectura buena */ }
    }
    saveCache.id = s.id;
    return saveCache.facts;
  }

  // Segmentos del modo elegido. Los de una partida no tienen lista: se cierran con el log.
  function segments() {
    const st = data.settings;
    if (st.mode === 'route') return data.route ? data.route.segments : [];
    if (st.mode === 'characters') return S.routeByCharacter();
    if (st.mode === 'blocks') return S.routeByBlocks(st.blockSize, saveCache.total || 641);
    if (st.mode === 'types') return S.routeByType(saveCache.challenges || 45);
    if (st.mode === 'runs') return S.routeByRuns(st.runCount);
    return [];
  }

  // Cada ruta tiene sus propios PB y golds en el cronómetro.
  function routeKey() {
    const st = data.settings;
    if (st.mode === 'route') return 'route:' + (data.route ? data.route.name || data.route.category : '');
    if (st.mode === 'blocks') return 'blocks:' + st.blockSize;
    if (st.mode === 'runs') return 'runs:' + st.runCount;
    return st.mode;
  }
  const syncRoute = () => timer.setRoute(routeKey(), deadGodMode() ? segments().map(s => s.name) : null);
  syncRoute();

  // ---------- Órdenes al cronómetro ----------
  const split = (name, final) => {
    if (!timer.split(name, final)) return;
    note('act.split', { name: timer.splits[timer.splits.length - 1].name });
    // El último split cierra la run aunque no se pueda leer la partida: el siguiente intento empieza en 0.
    if (timer.phase === 'Ended' && deadGodMode() && !data.session.finished) { storeTime(true); data.session.finished = true; note('act.finished'); persist(); }
  };
  const skip = name => { if (timer.skip()) note('act.skip', { name }); };

  // Empieza el tiempo. En Dead God, con lo acumulado en sesiones anteriores, y salta lo ya conseguido.
  function startTimer() {
    syncRoute();
    if (deadGodMode()) {
      const facts = readFacts();
      if (data.session.finished || data.session.saveId !== saveCache.id) Object.assign(data.session, { base: 0, finished: false, saveId: saveCache.id });
      if (facts) data.session.achCount = facts.achCount;
      if (!timer.start({ time: data.session.base })) return;
      data.lastImport = null;
      note('act.start');
      if (data.session.base > 0) note('act.resumeFrom', { time: formatTime(data.session.base) });
      markDoneAtStart(facts);
      persist();
    } else if (timer.start({ time: 0, external: data.settings.gameTime })) { data.lastImport = null; note('act.start'); }
  }

  function markDoneAtStart(facts) {
    live.doneAtStart = new Set(facts ? segments().map((s, i) => (S.segmentDone(s, facts) ? i : -1)).filter(i => i >= 0) : []);
    live.snapshot = new Set(live.doneAtStart);
    live.reached = { index: -1, done: false };
  }

  // Guarda el tiempo del cronómetro como tiempo acumulado de la run de Dead God.
  function storeTime(force) {
    if (!deadGodMode() || timer.phase === 'NotRunning') return;
    if (!force && Date.now() - live.lastStore < STORE_EVERY_MS) return;
    live.lastStore = Date.now();
    const t = Math.round(timer.time() * 100) / 100;
    if (t !== data.session.base) { data.session.base = t; persist(); }
  }

  const resume = () => { if (timer.resume()) note('act.resumeOpened'); };

  // ---------- Eventos del log ----------
  // Ranura del guardado elegido: las partidas de otras ranuras no cuentan para la run de Dead God.
  const slotMatches = slot => {
    const s = ctx.selectedSave();
    const m = s && /\/(\d)$/.exec(s.id);
    return !m || +m[1] === slot;
  };

  function onLogEvent(type, d) {
    const st = data.settings;
    if (!st.enabled) return;
    syncRoute();
    // Pausa del juego (todos los modos). Al quitarla solo sigue si la pausa fue suya, no una del botón.
    if (type === 'gamepause') {
      if (!st.pauseWithGame) return;
      if (d.paused && timer.phase === 'Running') {
        storeTime(true);
        if (timer.pause()) { live.gamePaused = true; note('act.pauseGame'); }
      } else if (!d.paused && timer.phase === 'Paused' && live.gamePaused) {
        live.gamePaused = false;
        if (timer.resume()) note('act.resumeGame');
      }
      return;
    }
    if (type === 'start') live.gamePaused = false;
    // Volver al menú pausa en todos los modos; sigue al entrar en otra partida (nueva o continuada). Reiniciar con R
    // no pasa por el menú: el tiempo no se para.
    if (type === 'menu') {
      if (timer.phase === 'Running') {
        storeTime(true);
        if (timer.pause()) note('act.pauseMenu');
      }
      return;
    }
    if (deadGodMode()) {
      if (type === 'shutdown' && st.pauseOnClose && timer.phase === 'Running') {
        storeTime(true);
        if (timer.pause()) note('act.pauseClosed');
      } else if (type === 'enter' && slotMatches(d.slot)) {
        // El tiempo empieza o sigue al entrar en la partida (primera sala cargada), no al abrir el juego ni mientras
        // carga. También lo que quedó en pausa al cerrar el juego o la aplicación.
        if (timer.phase === 'NotRunning' && st.autoStart) startTimer();
        else if (timer.phase === 'Paused') resume();
      } else if (type === 'start' && slotMatches(d.slot)) {
        if (st.mode === 'runs') {
          // Una partida nueva cierra la anterior si terminó sin un final (muerte o abandono). Continuar no cierra nada.
          const continued = d.mode === 'Continue' && d.seed === runSplit.seed;
          if (!continued && runSplit.seed && !runSplit.done) splitRun();
          if (!continued) Object.assign(runSplit, { seed: d.seed, done: false });
        }
      } else if (type === 'win' && st.mode === 'runs' && slotMatches(d.run.slot) && !runSplit.done) {
        splitRun();
      }
      return;
    }
    // Modos de una partida. Cada segmento lleva el código del piso que se termina (B2, C1...).
    if (type === 'start' && d.mode !== 'Continue') {
      if (timer.phase !== 'NotRunning' && st.autoReset) { timer.reset(); note('act.reset'); }
    } else if (type === 'enter') {
      if (timer.phase === 'Paused') resume();
      else if (d.mode !== 'Continue' && timer.phase === 'NotRunning' && st.autoStart) startTimer();
    } else if (type === 'floor' && timer.phase === 'Running' && d.run.floors.length > 1) {
      const floors = d.run.floors, prev = floors[floors.length - 2];
      if (st.mode === 'floors' || S.chapterOf(prev.stage) !== S.chapterOf(d.floor.stage)) split(floorLabel(prev));
    } else if (type === 'win' && timer.phase === 'Running') {
      const floors = (d.run && d.run.floors) || [];
      split(floors.length ? floorLabel(floors[floors.length - 1]) : 'END', true);
    }
  }

  // Split de la partida en el modo por partida, sin pasar del penúltimo segmento: el último es Dead God.
  function splitRun() {
    runSplit.done = true;
    const segs = segments(), i = timer.index();
    if (timer.phase === 'Running' && i >= 0 && i < segs.length - 1) split(segs[i].name);
  }

  // ---------- Bucle ----------
  function tick() {
    try {
      syncRoute();
      if (data.settings.enabled) {
        if (deadGodMode()) deadGodTick();
        else if (data.settings.gameTime && timer.phase === 'Running') {
          const run = ctx.currentRun();
          if (run && run.frames) timer.setTime(run.frames / 30);
        }
      }
      if (timer.phase === 'Running') timer.saveSoon();
      live.error = null;
    } catch (e) { live.error = e.message; }
  }

  function deadGodTick() {
    const facts = readFacts();
    if (!facts) return;
    // Otro archivo (o el mismo vaciado): la run anterior ya no vale.
    if (data.session.saveId === saveCache.id && facts.achCount + FRESH_FILE_DROP < data.session.achCount) {
      Object.assign(data.session, { base: 0, finished: false, achCount: facts.achCount });
      timer.reset();
      note('act.freshFile');
      persist();
    }
    if (timer.phase === 'Ended' && !data.session.finished) { storeTime(true); data.session.finished = true; note('act.finished'); persist(); }
    if (timer.phase !== 'Running') return;
    storeTime(false);
    if (facts.achCount !== data.session.achCount) { data.session.achCount = facts.achCount; persist(); }
    // Un intento retomado tras cerrar la aplicación: lo conseguido mientras tanto no tiene tiempo propio.
    if (!live.doneAtStart) markDoneAtStart(facts);
    const segs = segments();
    const i = timer.index();
    if (i < 0 || i >= segs.length) return;
    const last = segs.length - 1;
    const deadGod = facts.ach(S.ACH.deadGod);
    const done = S.segmentDone(segs[i], facts);
    // Si el segmento ya estaba conseguido en la lectura anterior a llegar a él (se hizo antes, fuera de orden),
    // no es tiempo suyo. Se mira la lectura anterior porque el split y el guardado nuevo pueden llegar juntos.
    const before = live.snapshot;
    live.snapshot = new Set(segs.map((s, k) => (S.segmentDone(s, facts) ? k : -1)).filter(k => k >= 0));
    if (live.reached.index !== i) live.reached = { index: i, done: before.has(i) };
    if (i === last) { if (deadGod || done) split(segs[i].name); return; }
    // Lo conseguido antes de empezar (en sesiones anteriores) o antes de llegar a él se salta sin tiempo.
    if (done && (live.doneAtStart.has(i) || live.reached.done)) skip(segs[i].name);
    else if (done) split(segs[i].name);
    // Dead God antes de tiempo (por ejemplo, menos partidas de las previstas): se salta lo que falte hasta el final.
    else if (deadGod) skip(segs[i].name);
  }

  const loop = setInterval(tick, TICK_MS);
  loop.unref();

  // ---------- Panel ----------
  const json = (status, body) => ({ status, type: 'application/json; charset=utf-8', body: JSON.stringify(body) });

  function status() {
    const facts = readFacts();
    syncRoute();
    const segs = segments();
    return {
      settings: data.settings, modes: MODES, deadGodModes: DEAD_GOD_MODES,
      timer: { phase: timer.phase, index: timer.index(), time: timer.time(), name: timer.currentName(), problem: live.error },
      save: { id: saveCache.id || null, error: saveCache.error, achievements: facts ? facts.achCount : null, total: saveCache.total || null },
      session: data.session,
      route: data.route ? { name: data.route.name, game: data.route.game, category: data.route.category } : null,
      canUndoImport: !!data.lastImport,
      segments: segs.map(s => ({ name: s.name, conds: s.conds, sure: s.sure !== false, done: facts ? S.segmentDone(s, facts) : false })),
      actions,
    };
  }

  // Lo que dibuja la fuente del cronómetro.
  function timerView() {
    syncRoute();
    const st = data.settings, r = data.route;
    const title = st.mode === 'route' && r ? r.category || r.name : '';
    return { ...timer.view(), mode: st.mode, title, visible: st.rows, showSegment: st.showSegment, showPb: st.showPb, showSob: st.showSob, textSize: st.textSize, clockSize: st.clockSize, at: Date.now() };
  }

  // Lo que el editor de rutas necesita para elegir condiciones.
  function catalog(lang) {
    const g = ctx.gameData();
    return {
      achievements: [...g.achievements.keys()].map(id => ({ id, name: g.achievementName(id, lang) })),
      characters: S.MARK_CHARACTERS.flatMap((_, i) => [i]).concat(S.MARK_CHARACTERS.map((_, i) => i + S.TAINTED)).map(row => ({ row, name: S.characterLabel(row) })),
      bosses: S.BOSSES,
      challenges: saveCache.challenges || 45,
      counters: S.COUNTER,
    };
  }

  function findAchievement(text) {
    const g = ctx.gameData(), want = text.trim().toLowerCase();
    for (const [id, a] of g.achievements) {
      const n = a.name.toLowerCase();
      if (n === want || n === 'the ' + want) return id;
    }
    return null;
  }

  // ---------- .lss: importar y exportar ----------
  const BACKUP_DIR = path.join(ctx.dataDir, 'backups');
  // Un .lss leído y a la espera de que se confirme la importación.
  let pending = null;

  // Las subdivisiones de LiveSplit ("-Segmento" y "{Grupo} Segmento") no son parte del nombre que se entiende.
  const plainName = n => n.replace(/^-/, '').replace(/^\{[^}]*\}\s*/, '');

  // Ruta de un .lss: las condiciones del bloque <MultiTracker> si se exportó desde aquí y los segmentos son los mismos;
  // si no, deducidas del nombre.
  function routeFromRun(run, name) {
    const block = run.block && Array.isArray(run.block.segments) ? run.block.segments : null;
    const same = block && block.length === run.segments.length && block.every((b, i) => b && b.name === run.segments[i].name);
    return cleanRoute({
      name, game: run.game, category: run.category,
      segments: run.segments.map((x, i) => {
        if (same) return { name: x.name, conds: block[i].conds, sure: block[i].sure };
        const g = S.guessConditions(plainName(x.name), findAchievement);
        return { name: x.name, conds: g.conds, sure: g.sure };
      }),
    });
  }

  // Lo del .lss que pasa al cronómetro: PB y golds en el método del PB, intentos e historial; lo demás, tal cual.
  function runToTimer(run) {
    const k = L.methodOf(run), o = k === 'g' ? 'r' : 'g';
    const segs = run.segments;
    const pbAt = segs.length ? segs[segs.length - 1].pb[k] : null;
    return {
      times: segs.map(x => ({ pb: x.pb[k], gold: x.best[k] })),
      attempts: run.attemptCount,
      history: {
        method: k, attempts: run.attempts, segments: segs.map(x => x.history),
        extras: {
          version: run.version, offset: run.offset, raw: run.raw, icons: segs.map(x => x.icon), comparisons: run.comparisons,
          splits: segs.map(x => x.splits), other: { pb: segs.map(x => x.pb[o]), golds: segs.map(x => x.best[o]) }, pbAtImport: pbAt,
        },
      },
    };
  }

  // Qué trae el .lss y qué reemplaza, para confirmarlo antes de importar.
  function preview(run, name) {
    const route = routeFromRun(run, name);
    if (!route) return null;
    const k = L.methodOf(run), o = k === 'g' ? 'r' : 'g';
    const last = run.segments[run.segments.length - 1];
    const newKey = 'route:' + (route.name || route.category);
    const old = timer.exportRun(newKey);
    const fromBlock = !!(run.block && route.segments.every((x, i) => run.block.segments && run.block.segments[i] && run.block.segments[i].name === x.name));
    return {
      name: route.name, game: route.game, category: route.category, method: k === 'g' ? 'GameTime' : 'RealTime', fromBlock,
      segments: route.segments.map(x => ({ name: x.name, sure: x.sure, conds: x.conds.length })),
      pb: last.pb[k], golds: run.segments.filter(x => x.best[k] !== null).length,
      attemptCount: run.attemptCount, history: run.attempts.length,
      comparisons: run.comparisons, icons: run.segments.filter(x => x.icon.trim()).length,
      autoSplitter: !!run.raw.autoSplitter.trim(), otherMethod: run.segments.some(x => x.pb[o] !== null || x.best[o] !== null),
      // Lo que hay ahora: la ruta actual (otra o la misma) y los tiempos que ya tenga la ruta con ese nombre.
      current: data.route ? { name: data.route.name, segments: data.route.segments.length, mode: data.settings.mode } : { name: null, segments: 0, mode: data.settings.mode },
      replaces: old.record ? { pb: old.record.pb.length ? old.record.pb[old.record.pb.length - 1].time : null, attempts: old.record.attempts, history: old.history.attempts.length } : null,
      running: timer.phase !== 'NotRunning',
    };
  }

  // Copia de livesplit.json, timer.json y el historial antes de importar. Devuelve el nombre de la copia.
  function makeBackup() {
    timer.save();
    persist();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = 'import-' + stamp;
    const dir = path.join(BACKUP_DIR, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['livesplit.json', 'timer.json']) {
      const from = path.join(ctx.dataDir, f);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, f));
    }
    const hist = path.join(ctx.dataDir, 'history');
    if (fs.existsSync(hist)) fs.cpSync(hist, path.join(dir, 'history'), { recursive: true });
    const old = fs.readdirSync(BACKUP_DIR).filter(n => n.startsWith('import-')).sort();
    for (const n of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.rmSync(path.join(BACKUP_DIR, n), { recursive: true, force: true });
    return name;
  }

  function importRun(run, fileName) {
    const route = routeFromRun(run, cleanName(String(fileName || '').replace(/\.lss$/i, '')));
    if (!route) return json(400, { error: 'err.lss' });
    const backup = makeBackup();
    // El intento en marcha se cierra (queda en la copia y en el historial de su ruta).
    if (timer.phase !== 'NotRunning') timer.reset();
    data.route = route;
    data.settings.mode = 'route';
    data.lastImport = backup;
    syncRoute();
    const t = runToTimer(run);
    timer.importRun(routeKey(), route.segments.map(x => x.name), t);
    note('act.import', { name: route.name || route.category });
    if (t.times.some(x => x.pb !== null || x.gold !== null)) note('act.importTimes');
    live.doneAtStart = null;
    persist();
    return status();
  }

  // Vuelve a como estaba todo antes de la última importación.
  function undoImport() {
    const dir = data.lastImport && path.join(BACKUP_DIR, data.lastImport);
    if (!dir || !fs.existsSync(dir)) { data.lastImport = null; persist(); return json(400, { error: 'err.noBackup' }); }
    if (timer.phase !== 'NotRunning') timer.reset();
    for (const f of ['livesplit.json', 'timer.json']) {
      const from = path.join(dir, f), to = path.join(ctx.dataDir, f);
      if (fs.existsSync(from)) fs.copyFileSync(from, to); else fs.rmSync(to, { force: true });
    }
    const hist = path.join(ctx.dataDir, 'history');
    fs.rmSync(hist, { recursive: true, force: true });
    if (fs.existsSync(path.join(dir, 'history'))) fs.cpSync(path.join(dir, 'history'), hist, { recursive: true });
    const back = readJson(path.join(ctx.dataDir, 'livesplit.json'), {}) || {};
    data.settings = cleanSettings(back.settings, DEFAULT_SETTINGS);
    data.route = cleanRoute(back.route);
    data.session = { saveId: null, base: 0, achCount: 0, finished: false, ...(back.session || {}) };
    data.lastImport = null;
    timer.reload();
    live.doneAtStart = null;
    note('act.undoImport');
    persist();
    syncRoute();
    return status();
  }

  // Un .lss con la ruta, los tiempos, los intentos y el historial; con lo que vino del .lss importado tal cual.
  function exportLss() {
    syncRoute();
    const segs = segments();
    const { record: rec, history: h } = timer.exportRun(routeKey());
    // En los modos de una partida, los segmentos del PB.
    const names = segs.length ? segs.map(x => x.name) : rec ? rec.pb.map(x => x.name) : [];
    if (!names.length) return json(400, { error: 'err.noSegments' });
    const x = h.extras, k = h.method;
    const v = t => (t === undefined ? null : t);
    // Sin método (la ruta no vino de un .lss), el tiempo del tracker va en los dos.
    const pair = (t, other) => (k === 'g' ? { r: v(other), g: v(t) } : k === 'r' ? { r: v(t), g: v(other) } : { r: v(t), g: v(t) });
    const pbTotal = rec && rec.pb.length ? rec.pb[rec.pb.length - 1].time : null;
    // El PB del otro método solo vale si el PB sigue siendo el que se importó.
    const otherPb = !!(x && x.pbAtImport !== null && pbTotal === x.pbAtImport);
    const r = data.settings.mode === 'route' && data.route ? data.route : {};
    const run = {
      version: x ? x.version : '1.7.0', game: r.game || 'The Binding of Isaac: Repentance+', category: r.category || (deadGodMode() ? 'DeadGod%' : data.settings.mode),
      offset: x ? x.offset : '00:00:00', attemptCount: rec ? rec.attempts : 0, attempts: h.attempts,
      comparisons: x ? x.comparisons : [], raw: x ? x.raw : {},
      segments: names.map((name, i) => ({
        name, icon: x ? x.icons[i] || '' : '',
        pb: pair(rec && rec.pb[i] ? rec.pb[i].time : null, otherPb ? x.other.pb[i] : null),
        best: pair(rec ? rec.golds[i] : null, x ? x.other.golds[i] : null),
        splits: x ? x.splits[i] || {} : {},
        history: h.segments[i] || [],
      })),
      block: data.settings.mode === 'route' && data.route ? { segments: data.route.segments.map(s => ({ name: s.name, conds: s.conds, sure: s.sure })) } : null,
    };
    return { fileName: (r.name || `MultiTracker ${data.settings.mode}`) + '.lss', text: L.buildLss(run) };
  }

  // Botones del panel, por si un split automático no salta o salta de más.
  function timerOp(op) {
    syncRoute();
    if (op === 'start') { if (timer.phase === 'NotRunning') startTimer(); }
    else if (op === 'split') {
      const segs = segments(), i = timer.index();
      split(deadGodMode() ? (segs[i] || {}).name : String(i + 1));
    } else if (op === 'skip') skip(timer.currentName());
    else if (op === 'undo') { if (timer.undo()) { note('act.undo'); if (deadGodMode()) data.session.finished = false; } }
    else if (op === 'pause') { if (timer.pause()) note('act.pause'); }
    else if (op === 'resume') resume();
    else if (op === 'reset') { timer.reset(); note('act.resetManual'); }
    storeTime(true);
    persist();
  }

  function action(b, lang) {
    if (b.action === 'settings') {
      const before = data.settings;
      data.settings = cleanSettings(b.settings, before);
      if (data.settings.mode !== before.mode) Object.assign(runSplit, { seed: null, done: false });
      persist();
      return status();
    }
    if (b.action === 'timer' && TIMER_OPS.includes(b.op)) { timerOp(b.op); return status(); }
    // Importar en dos pasos: previewLss lee el archivo y dice qué trae y qué reemplaza; importLss con su token lo aplica.
    if (b.action === 'previewLss') {
      let run;
      try { run = L.parseLss(b.text); } catch { return json(400, { error: 'err.lss' }); }
      const p = preview(run, cleanName(String(b.fileName || '').replace(/\.lss$/i, '')));
      if (!p) return json(400, { error: 'err.lss' });
      pending = { token: crypto.randomBytes(8).toString('hex'), run, fileName: b.fileName };
      return { ...p, token: pending.token };
    }
    if (b.action === 'importLss') {
      if (b.token) {
        if (!pending || pending.token !== b.token) return json(400, { error: 'err.preview' });
        const { run, fileName } = pending;
        pending = null;
        return importRun(run, fileName);
      }
      let run;
      try { run = L.parseLss(b.text); } catch { return json(400, { error: 'err.lss' }); }
      return importRun(run, b.fileName);
    }
    if (b.action === 'cancelImport') { pending = null; return status(); }
    if (b.action === 'undoImport') return undoImport();
    if (b.action === 'route') {
      const route = cleanRoute(b.route);
      if (!route) return json(400, { error: 'err.route' });
      data.route = route;
      persist();
      return status();
    }
    if (b.action === 'exportLss') return exportLss();
    if (b.action === 'newSession') {
      Object.assign(data.session, { base: 0, finished: false, saveId: saveCache.id || null });
      timer.reset();
      live.doneAtStart = null;
      note('act.newSession');
      persist();
      return status();
    }
    if (b.action === 'catalog') return catalog(lang);
    return json(400, { error: 'err.action' });
  }

  async function respond({ method, pathname, readJsonBody, lang }) {
    if (method === 'GET' && pathname === '/api/timer') return json(200, timerView());
    if (method === 'GET' && pathname === '/api/livesplit') return json(200, status());
    if (method === 'POST' && pathname === '/api/livesplit') {
      const body = await readJsonBody();
      const r = action(body && typeof body === 'object' ? body : {}, lang);
      return r && r.status && r.type ? r : json(200, r);
    }
    return null;
  }

  return { respond, onLogEvent, timer, tick, stop: () => { clearInterval(loop); timer.save(); } };
}

module.exports = { createSplitter, DEFAULT_SETTINGS };
