// Edición avanzada: splits automáticos en LiveSplit a partir del guardado (logros, marcas, retos...) y del log (partidas,
// pisos, finales). Se monta en tracker.js como extensión: la edición normal no lo carga.
//
// Modos de Dead God (varias sesiones): route (la ruta del usuario, importada de su .lss), characters, blocks, types y
// runs. El tiempo de LiveSplit se guarda como Game Time: al volver otro día se retoma donde se dejó, aunque LiveSplit
// se haya cerrado. Modos de una partida: floors y chapters (como el autosplitter clásico de Isaac).
const fs = require('fs');
const path = require('path');
const { writeFile, readJson } = require('./http.js');
const { parseSave, CHUNK } = require('./save.js');
const { LiveSplit, parseTime, formatTime } = require('./livesplit.js');
const S = require('./splits.js');

const TICK_MS = 500;
const STORE_EVERY_MS = 2000;
const VERSION = 1;
const DEAD_GOD_MODES = ['route', 'characters', 'blocks', 'types', 'runs'];
const RUN_MODES = ['floors', 'chapters'];
const MODES = [...DEAD_GOD_MODES, ...RUN_MODES];
const MAX_SEGMENTS = 400;
const MAX_CONDS = 600;
const NAME_MAX = 80;
const LOG_SIZE = 12;
// Si el guardado pierde de golpe más logros que esto, es otro archivo (una run nueva desde cero).
const FRESH_FILE_DROP = 5;

const DEFAULT_SETTINGS = {
  enabled: false, host: '127.0.0.1', port: 16834, mode: 'route',
  blockSize: 64, runCount: 100,
  // Empezar el tiempo con la primera partida (y retomarlo si ya había uno guardado).
  autoStart: true,
  // Dead God: pausar al cerrar el juego y seguir al volver a abrirlo (las reglas permiten pausar al terminar la sesión).
  pauseOnClose: true,
  // Comprobar que el split actual de LiveSplit se llama como el segmento de la ruta: si no, no se toca nada.
  checkNames: true,
  // Modos de una partida: reiniciar al empezar otra y llevar el tiempo de juego (frames del log) como Game Time.
  autoReset: true, gameTime: false,
};
const LIMITS = { port: [1, 65535], blockSize: [8, 320], runCount: [5, 500] };
const FLAGS = ['enabled', 'autoStart', 'pauseOnClose', 'checkNames', 'autoReset', 'gameTime'];

function cleanSettings(b, current) {
  const out = { ...current };
  if (!b || typeof b !== 'object') return out;
  for (const k of FLAGS) if (typeof b[k] === 'boolean') out[k] = b[k];
  for (const [k, [min, max]] of Object.entries(LIMITS)) if (Number.isFinite(b[k])) out[k] = Math.min(max, Math.max(min, Math.round(b[k])));
  if (MODES.includes(b.mode)) out.mode = b.mode;
  // Solo este PC: el servidor de LiveSplit no tiene contraseña.
  if (['127.0.0.1', 'localhost'].includes(b.host)) out.host = b.host;
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

  const ls = new LiveSplit({ host: data.settings.host, port: data.settings.port });
  if (data.settings.enabled) ls.start();

  // Lo último que se sabe de LiveSplit y del guardado.
  // doneAtStart: segmentos ya conseguidos al empezar o retomar; se saltan sin tiempo en vez de cerrarse ahora.
  const live = { phase: null, index: -1, name: null, mismatch: false, doneAtStart: new Set(), lastStore: 0, error: null };
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

  // ---------- Órdenes a LiveSplit ----------
  function command(cmd, key, vars) {
    if (!ls.send(cmd)) return false;
    if (key) note(key, vars);
    return true;
  }
  const split = name => { if (command('split', 'act.split', { name })) live.index++; };
  const skip = name => { if (command('skipsplit', 'act.skip', { name })) live.index++; };

  // Empieza el tiempo. En Dead God, con lo acumulado en sesiones anteriores, y salta lo ya conseguido.
  function startTimer() {
    command('starttimer', 'act.start');
    live.phase = 'Running';
    live.index = 0;
    if (deadGodMode()) {
      const facts = readFacts();
      if (data.session.finished || data.session.saveId !== saveCache.id) Object.assign(data.session, { base: 0, finished: false, saveId: saveCache.id });
      if (facts) data.session.achCount = facts.achCount;
      command('initgametime');
      command('setgametime ' + formatTime(data.session.base));
      command('switchto gametime');
      if (data.session.base > 0) note('act.resumeFrom', { time: formatTime(data.session.base) });
      live.doneAtStart = new Set(facts ? segments().map((s, i) => (S.segmentDone(s, facts) ? i : -1)).filter(i => i >= 0) : []);
      persist();
    } else if (data.settings.gameTime) {
      command('initgametime');
      command('pausegametime');
      command('setgametime 0:00:00.00');
      command('switchto gametime');
    }
  }

  // Guarda el Game Time de LiveSplit como tiempo acumulado de la run de Dead God.
  async function storeTime(force) {
    if (!deadGodMode() || !['Running', 'Paused', 'Ended'].includes(live.phase)) return;
    if (!force && Date.now() - live.lastStore < STORE_EVERY_MS) return;
    live.lastStore = Date.now();
    const t = parseTime(await ls.query('getcurrentgametime'));
    if (t !== null && t !== data.session.base) { data.session.base = t; persist(); }
  }

  // ---------- Eventos del log ----------
  // Ranura del guardado elegido: las partidas de otras ranuras no cuentan para la run de Dead God.
  const slotMatches = slot => {
    const s = ctx.selectedSave();
    const m = s && /\/(\d)$/.exec(s.id);
    return !m || +m[1] === slot;
  };

  function onLogEvent(type, d) {
    const st = data.settings;
    if (!st.enabled || !ls.connected) return;
    if (deadGodMode()) {
      if (type === 'shutdown' && st.pauseOnClose && live.phase === 'Running') {
        storeTime(true).catch(() => {});
        command('pause', 'act.pauseClosed');
        live.phase = 'Paused';
      } else if (type === 'boot' && st.pauseOnClose && live.phase === 'Paused') {
        command('resume', 'act.resumeOpened');
        live.phase = 'Running';
      } else if (type === 'start' && slotMatches(d.slot)) {
        if (live.phase === 'NotRunning' && st.autoStart) startTimer();
        else if (live.phase === 'Paused' && st.pauseOnClose) { command('resume', 'act.resumeOpened'); live.phase = 'Running'; }
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
    // Modos de una partida.
    if (type === 'start' && d.mode !== 'Continue') {
      if (['Running', 'Paused', 'Ended'].includes(live.phase) && st.autoReset) { command('reset', 'act.reset'); live.phase = 'NotRunning'; }
      if (live.phase === 'NotRunning' && st.autoStart) startTimer();
    } else if (type === 'floor' && live.phase === 'Running' && d.run.floors.length > 1) {
      const floors = d.run.floors, prev = floors[floors.length - 2];
      if (st.mode === 'floors' || S.chapterOf(prev.stage) !== S.chapterOf(d.floor.stage)) split(String(d.floor.stage));
    } else if (type === 'win' && live.phase === 'Running') {
      split('win');
    }
  }

  // Split de la partida en el modo por partida, sin pasar del penúltimo segmento: el último es Dead God.
  function splitRun() {
    runSplit.done = true;
    const segs = segments();
    if (live.phase === 'Running' && live.index >= 0 && live.index < segs.length - 1) split(segs[live.index].name);
  }

  // ---------- Bucle ----------
  let busy = false;
  async function tick() {
    if (busy || !data.settings.enabled || !ls.connected) return;
    busy = true;
    try {
      live.phase = await ls.query('getcurrenttimerphase');
      live.index = parseInt(await ls.query('getsplitindex'), 10);
      if (deadGodMode()) await deadGodTick();
      else if (data.settings.gameTime && live.phase === 'Running') {
        const run = ctx.currentRun();
        if (run && run.frames) ls.send('setgametime ' + formatTime(run.frames / 30));
      }
      live.error = null;
    } catch (e) { live.error = e.message; } finally { busy = false; }
  }

  async function deadGodTick() {
    const facts = readFacts();
    if (!facts) return;
    // Otro archivo (o el mismo vaciado): la run anterior ya no vale.
    if (data.session.saveId === saveCache.id && facts.achCount + FRESH_FILE_DROP < data.session.achCount) {
      Object.assign(data.session, { base: 0, finished: false, achCount: facts.achCount });
      note('act.freshFile');
      persist();
    }
    if (live.phase === 'Ended' && !data.session.finished) { await storeTime(true); data.session.finished = true; note('act.finished'); persist(); }
    if (live.phase !== 'Running') { live.mismatch = false; live.name = null; return; }
    await storeTime(false);
    if (facts.achCount !== data.session.achCount) { data.session.achCount = facts.achCount; persist(); }
    const segs = segments();
    const i = live.index;
    if (i < 0 || i >= segs.length) return;
    // Lo abierto en LiveSplit tiene que ser esta ruta: con otros splits no se hace nada.
    live.name = await ls.query('getcurrentsplitname');
    const same = (live.name || '').trim().toLowerCase() === segs[i].name.trim().toLowerCase();
    live.mismatch = data.settings.checkNames && !!live.name && live.name !== '-' && !same;
    if (live.mismatch) return;
    const last = segs.length - 1;
    const deadGod = facts.ach(S.ACH.deadGod);
    const done = S.segmentDone(segs[i], facts);
    if (i === last) { if (deadGod || done) split(segs[i].name); return; }
    // Lo conseguido antes de empezar (en sesiones anteriores) se salta sin tiempo.
    if (done && live.doneAtStart.has(i)) skip(segs[i].name);
    else if (done) split(segs[i].name);
    // Dead God antes de tiempo (por ejemplo, menos partidas de las previstas): se salta lo que falte hasta el final.
    else if (deadGod) skip(segs[i].name);
  }

  const timer = setInterval(() => { tick(); }, TICK_MS);
  timer.unref();

  // ---------- Panel ----------
  const json = (status, body) => ({ status, type: 'application/json; charset=utf-8', body: JSON.stringify(body) });

  function status() {
    const facts = readFacts();
    const segs = segments();
    return {
      settings: data.settings, modes: MODES, deadGodModes: DEAD_GOD_MODES,
      connection: { connected: ls.connected, error: ls.connected ? null : ls.error, phase: live.phase, index: live.index, name: live.name, mismatch: live.mismatch, problem: live.error },
      save: { id: saveCache.id || null, error: saveCache.error, achievements: facts ? facts.achCount : null, total: saveCache.total || null },
      session: data.session,
      route: data.route ? { name: data.route.name, game: data.route.game, category: data.route.category } : null,
      segments: segs.map(s => ({ name: s.name, conds: s.conds, sure: s.sure !== false, done: facts ? S.segmentDone(s, facts) : false })),
      actions,
    };
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

  function action(b, lang) {
    if (b.action === 'settings') {
      const before = data.settings;
      data.settings = cleanSettings(b.settings, before);
      if (data.settings.mode !== before.mode) Object.assign(runSplit, { seed: null, done: false });
      ls.configure({ host: data.settings.host, port: data.settings.port });
      if (data.settings.enabled && !before.enabled) ls.start();
      if (!data.settings.enabled && before.enabled) ls.stop();
      persist();
      return status();
    }
    if (b.action === 'importLss') {
      let lss;
      try { lss = S.readLss(b.text); } catch { return json(400, { error: 'err.lss' }); }
      const name = cleanName(String(b.fileName || '').replace(/\.lss$/i, ''));
      data.route = cleanRoute({
        name, game: lss.game, category: lss.category,
        segments: lss.segments.map(n => { const g = S.guessConditions(n, findAchievement); return { name: n, conds: g.conds, sure: g.sure }; }),
      });
      data.settings.mode = 'route';
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
      const segs = segments();
      if (!segs.length) return json(400, { error: 'err.noSegments' });
      const r = data.settings.mode === 'route' && data.route ? data.route : {};
      return { fileName: (r.name || `MultiTracker ${data.settings.mode}`) + '.lss', text: S.writeLss({ game: r.game, category: r.category, segments: segs.map(s => s.name) }) };
    }
    if (b.action === 'newSession') {
      Object.assign(data.session, { base: 0, finished: false, saveId: saveCache.id || null });
      note('act.newSession');
      persist();
      return status();
    }
    if (b.action === 'catalog') return catalog(lang);
    return json(400, { error: 'err.action' });
  }

  async function respond({ method, pathname, readJsonBody, lang }) {
    if (method === 'GET' && pathname === '/api/livesplit') return json(200, status());
    if (method === 'POST' && pathname === '/api/livesplit') {
      const body = await readJsonBody();
      const r = action(body && typeof body === 'object' ? body : {}, lang);
      return r && r.status && r.type ? r : json(200, r);
    }
    return null;
  }

  return { respond, onLogEvent, stop: () => { clearInterval(timer); ls.stop(); } };
}

module.exports = { createSplitter, DEFAULT_SETTINGS };
