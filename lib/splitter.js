// Edición avanzada: cronómetro con splits automáticos a partir del guardado (logros, marcas, retos...) y del log
// (partidas, pisos, finales). Se monta en tracker.js como extensión: la edición normal no lo carga.
// El cronómetro es propio (lib/timer.js): se ve como fuente de OBS en overlay.html?part=timer, con el tema del perfil.
//
// Modos de Dead God (varias sesiones): route (la ruta del usuario, importada de su .lss), characters, blocks, types y
// runs. El tiempo se guarda: al volver otro día se retoma donde se dejó. Modos de una partida: floors y chapters
// (como el autosplitter clásico de Isaac).
const fs = require('fs');
const path = require('path');
const { writeFile, readJson } = require('./http.js');
const { parseSave, CHUNK } = require('./save.js');
const { floorLabel } = require('./gamedata.js');
const { createTimer, formatTime } = require('./timer.js');
const S = require('./splits.js');

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
      note('act.start');
      if (data.session.base > 0) note('act.resumeFrom', { time: formatTime(data.session.base) });
      markDoneAtStart(facts);
      persist();
    } else if (timer.start({ time: 0, external: data.settings.gameTime })) note('act.start');
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
    } else if (type === 'enter' && d.mode !== 'Continue') {
      if (timer.phase === 'NotRunning' && st.autoStart) startTimer();
    } else if (type === 'enter' && timer.phase === 'Paused') {
      resume();
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
    if (b.action === 'importLss') {
      let lss;
      try { lss = S.readLss(b.text); } catch { return json(400, { error: 'err.lss' }); }
      const name = cleanName(String(b.fileName || '').replace(/\.lss$/i, ''));
      data.route = cleanRoute({
        name, game: lss.game, category: lss.category,
        segments: lss.segments.map(n => { const g = S.guessConditions(n, findAchievement); return { name: n, conds: g.conds, sure: g.sure }; }),
      });
      data.settings.mode = 'route';
      // El PB y los golds del .lss pasan al cronómetro, para comparar desde el primer intento.
      if (data.route && timer.importRecords(routeKey(), data.route.segments.map(s => s.name), lss.times)) note('act.importTimes');
      persist();
      return status();
    }
    if (b.action === 'route') {
      const route = cleanRoute(b.route);
      if (!route) return json(400, { error: 'err.route' });
      data.route = route;
      persist();
      return status();
    }
    if (b.action === 'exportLss') {
      syncRoute();
      const segs = segments();
      const rec = timer.record(routeKey());
      // En los modos de una partida, los segmentos del PB.
      const names = segs.length ? segs.map(s => s.name) : rec ? rec.pb.map(p => p.name) : [];
      if (!names.length) return json(400, { error: 'err.noSegments' });
      const times = rec ? names.map((_, i) => ({ pb: rec.pb[i] ? rec.pb[i].time : null, gold: rec.golds[i] === undefined ? null : rec.golds[i] })) : null;
      const r = data.settings.mode === 'route' && data.route ? data.route : {};
      return { fileName: (r.name || `MultiTracker ${data.settings.mode}`) + '.lss', text: S.writeLss({ game: r.game, category: r.category, segments: names, times }) };
    }
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
