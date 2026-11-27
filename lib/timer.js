// Edición avanzada: cronómetro propio con splits, en lugar de LiveSplit.
// Lleva el intento en curso y, por cada ruta, el mejor tiempo (PB), el mejor tiempo de cada segmento (golds) y los
// intentos. Lo guarda todo en timer.json: si se cierra la aplicación, al volver el intento sigue en pausa donde estaba.
//
// Tiempos en segundos, acumulados desde el principio del intento (como las «split times» de LiveSplit).
// Una ruta tiene una lista fija de segmentos (Dead God) o es abierta (una partida: cada split añade el suyo).
const path = require('path');
const crypto = require('crypto');
const { writeFile, readJson } = require('./http.js');

const PHASES = ['NotRunning', 'Running', 'Paused', 'Ended'];
const MAX_SEGMENTS = 400;
const NAME_MAX = 80;
const SAVE_EVERY_MS = 2000;
// Historial de intentos (como el de LiveSplit): aparte, en history/<ruta>.json, porque timer.json se escribe cada
// pocos segundos mientras corre y el historial puede tener miles de intentos.
const MAX_HISTORY = 20000;

const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const cleanName = s => (typeof s === 'string' ? s.replace(/\p{Cc}/gu, '').trim().slice(0, NAME_MAX) : '');

// "01:02:03.9024458" o "1.02:03:04.5" (con días, como los .lss) → segundos. "-" o vacío → null.
function parseTime(text) {
  const m = /^(?:(\d+)\.)?(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(text || '').trim());
  return m ? (+(m[1] || 0)) * 86400 + +m[2] * 3600 + +m[3] * 60 + +m[4] : null;
}

// Segundos → "H:MM:SS.ss" (para los textos del panel).
function formatTime(seconds) {
  const s = Math.max(0, seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), rest = s - h * 3600 - m * 60;
  return `${h}:${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

function cleanRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const pb = (Array.isArray(r.pb) ? r.pb : []).slice(0, MAX_SEGMENTS).map(s => ({ name: cleanName(s && s.name), time: num(s && s.time) }));
  const golds = (Array.isArray(r.golds) ? r.golds : []).slice(0, MAX_SEGMENTS).map(num);
  return { pb, golds, attempts: Number.isInteger(r.attempts) && r.attempts >= 0 ? r.attempts : 0 };
}

const t2 = v => ({ r: num(v && v.r), g: num(v && v.g) });
const str = (v, max = 40) => (typeof v === 'string' ? v.slice(0, max) : null);
const int = v => (Number.isInteger(v) ? v : null);

// Fecha de LiveSplit (UTC, "MM/dd/yyyy HH:mm:ss").
function lssDate(ms) {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// Lo que vino de un .lss y el tracker no usa, para devolverlo al exportar (ver lib/lss.js).
function cleanExtras(x) {
  if (!x || typeof x !== 'object') return null;
  const rawStr = v => (typeof v === 'string' ? v : '');
  const list = v => (Array.isArray(v) ? v.slice(0, MAX_SEGMENTS) : []);
  const comparisons = list(x.comparisons).filter(n => typeof n === 'string' && n).map(n => n.slice(0, NAME_MAX));
  return {
    version: str(x.version, 20) || '1.7.0', offset: str(x.offset) || '00:00:00',
    raw: {
      gameIcon: rawStr(x.raw && x.raw.gameIcon), layoutPath: rawStr(x.raw && x.raw.layoutPath),
      metadata: x.raw && typeof x.raw.metadata === 'string' ? x.raw.metadata : null, autoSplitter: rawStr(x.raw && x.raw.autoSplitter),
    },
    icons: list(x.icons).map(rawStr),
    comparisons,
    // Tiempos de cada comparación propia, por segmento.
    splits: list(x.splits).map(s => Object.fromEntries(comparisons.map(n => [n, t2(s && s[n])]))),
    // El otro método de tiempo (el que el tracker no lleva): PB y golds, y el PB total con que se importó.
    other: { pb: list(x.other && x.other.pb).map(num), golds: list(x.other && x.other.golds).map(num) },
    pbAtImport: num(x.pbAtImport),
  };
}

function cleanHistory(h) {
  const out = { method: null, attempts: [], segments: [], extras: null };
  if (!h || typeof h !== 'object') return out;
  out.method = h.method === 'r' || h.method === 'g' ? h.method : null;
  out.attempts = (Array.isArray(h.attempts) ? h.attempts : []).slice(-MAX_HISTORY).filter(a => a && int(a.id) !== null).map(a => ({
    id: a.id, started: str(a.started), startedSynced: !!a.startedSynced, ended: str(a.ended), endedSynced: !!a.endedSynced,
    ...t2(a), pause: num(a.pause),
  }));
  out.segments = (Array.isArray(h.segments) ? h.segments : []).slice(0, MAX_SEGMENTS).map(seg =>
    (Array.isArray(seg) ? seg : []).slice(-MAX_HISTORY).filter(e => e && int(e.id) !== null).map(e => ({ id: e.id, ...t2(e) })));
  out.extras = cleanExtras(h.extras);
  return out;
}

function cleanAttempt(a) {
  if (!a || typeof a !== 'object' || !PHASES.includes(a.phase)) return null;
  return {
    key: typeof a.key === 'string' ? a.key : null,
    phase: a.phase,
    splits: (Array.isArray(a.splits) ? a.splits : []).slice(0, MAX_SEGMENTS).map(s => ({ name: cleanName(s && s.name), time: num(s && s.time), gold: !!(s && s.gold), wrote: !!(s && s.wrote), oldGold: num(s && s.oldGold) })),
    time: num(a.time) || 0,
    external: !!a.external,
    started: num(a.started),
  };
}

// file: dónde se guarda; now: reloj (las pruebas lo cambian).
function createTimer({ file, historyDir = file ? path.join(path.dirname(file), 'history') : null, now = () => Date.now() }) {
  let stored = (file && readJson(file, {})) || {};
  const records = {};
  const loadRecords = () => {
    for (const k of Object.keys(records)) delete records[k];
    for (const [k, r] of Object.entries(stored.records || {})) { const c = cleanRecord(r); if (c) records[k] = c; }
  };
  loadRecords();

  // Historial de cada ruta, leído al pedirlo. El nombre del archivo sale de la clave (que puede llevar cualquier texto).
  const histories = new Map();
  const historyFile = key => historyDir && path.join(historyDir, crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 16) + '.json');
  function history(key) {
    if (!histories.has(key)) histories.set(key, cleanHistory(historyFile(key) && readJson(historyFile(key), null)));
    return histories.get(key);
  }
  function saveHistory(key) {
    const f = historyFile(key);
    if (f) writeFile(f, JSON.stringify({ version: 1, key, ...history(key) }));
  }

  // names: segmentos de la ruta (null en las abiertas). offset: tiempo hasta since; since: cuándo empezó a correr.
  // external: el tiempo lo pone quien lo usa (el tiempo de juego del log) en vez de correr solo.
  const a = { key: null, names: null, phase: 'NotRunning', splits: [], offset: 0, since: null, external: false, started: null };
  const restored = cleanAttempt(stored.attempt);
  if (restored) {
    // Lo que corría al cerrar la aplicación vuelve en pausa: el tiempo con la aplicación cerrada no cuenta.
    Object.assign(a, { key: restored.key, phase: restored.phase === 'Running' ? 'Paused' : restored.phase, splits: restored.splits, offset: restored.time, external: restored.external, started: restored.started });
  }

  let lastSave = 0;
  const time = () => a.offset + (a.phase === 'Running' && !a.external && a.since !== null ? (now() - a.since) / 1000 : 0);
  const record = (key = a.key) => (records[key] = records[key] || { pb: [], golds: [], attempts: 0 });

  function save() {
    lastSave = now();
    if (!file) return;
    const attempt = { key: a.key, phase: a.phase, splits: a.splits, time: time(), external: a.external, started: a.started };
    writeFile(file, JSON.stringify({ version: 1, attempt, records }, null, 2));
  }
  // Mientras corre, cada SAVE_EVERY_MS como mucho.
  const saveSoon = () => { if (now() - lastSave >= SAVE_EVERY_MS) save(); };

  const count = () => (a.names ? a.names.length : Infinity);
  const index = () => (a.phase === 'NotRunning' ? -1 : a.splits.length);
  const currentName = () => (a.names && a.phase !== 'NotRunning' ? a.names[a.splits.length] || null : null);

  // Ruta que se cronometra. Si cambia la ruta con un intento en marcha, ese intento ya no sirve.
  function setRoute(key, names) {
    const list = names ? names.slice(0, MAX_SEGMENTS).map(cleanName) : null;
    if (key !== a.key && a.phase !== 'NotRunning') reset();
    const changed = key !== a.key || JSON.stringify(list) !== JSON.stringify(a.names);
    a.key = key;
    a.names = list;
    if (changed) save();
  }

  function start({ time: from = 0, external = false } = {}) {
    if (a.phase !== 'NotRunning') return false;
    Object.assign(a, { phase: 'Running', splits: [], offset: Math.max(0, from), since: now(), external, started: now() });
    record().attempts++;
    save();
    return true;
  }

  function pause() {
    if (a.phase !== 'Running') return false;
    a.offset = time();
    a.since = null;
    a.phase = 'Paused';
    save();
    return true;
  }

  function resume() {
    if (a.phase !== 'Paused') return false;
    a.since = now();
    a.phase = 'Running';
    save();
    return true;
  }

  function setTime(seconds) {
    if (!Number.isFinite(seconds)) return;
    a.offset = Math.max(0, seconds);
    if (a.phase === 'Running') a.since = now();
  }

  // Cierra el segmento actual. En las rutas abiertas, name es el del segmento y final, si es el último.
  function split(name, final) {
    if (a.phase !== 'Running') return false;
    const i = a.splits.length;
    if (i >= count()) return false;
    const t = time();
    const r = record();
    // Gold: solo si se sabe cuánto duró el segmento (el anterior no se saltó).
    const prev = i === 0 ? 0 : a.splits[i - 1].time;
    // wrote y oldGold: para deshacer el split sin quedarse con un gold que ya no es.
    let gold = false, wrote = false;
    const oldGold = r.golds[i] === undefined ? null : r.golds[i];
    if (prev !== null && (oldGold === null || t - prev < oldGold)) { r.golds[i] = t - prev; wrote = true; gold = oldGold !== null; }
    a.splits.push({ name: a.names ? a.names[i] : cleanName(name) || String(i + 1), time: t, gold, wrote, oldGold });
    if (a.splits.length >= count() || (!a.names && final)) end();
    else save();
    return true;
  }

  // Salta el segmento actual sin tiempo (el último no se puede saltar).
  function skip() {
    if (a.phase !== 'Running' || !a.names || a.splits.length >= count() - 1) return false;
    a.splits.push({ name: a.names[a.splits.length], time: null, gold: false });
    save();
    return true;
  }

  // Deshace el último split o salto. Si terminó el intento, vuelve a correr.
  function undo() {
    if ((a.phase !== 'Running' && a.phase !== 'Paused' && a.phase !== 'Ended') || !a.splits.length) return false;
    const s = a.splits.pop();
    const r = record();
    if (s.wrote) r.golds[a.splits.length] = s.oldGold;
    if (a.phase === 'Ended') {
      if (a.pbFrom) { r.pb = a.pbFrom; delete a.pbFrom; }
      a.phase = 'Running';
      a.since = now();
    }
    save();
    return true;
  }

  function end() {
    a.offset = time();
    a.since = null;
    a.phase = 'Ended';
    const r = record();
    const total = a.splits[a.splits.length - 1].time;
    const pbTotal = r.pb.length ? r.pb[r.pb.length - 1].time : null;
    // Un PB de una ruta fija tiene todos sus segmentos; en una abierta vale cualquiera terminada.
    if (total !== null && (pbTotal === null || total < pbTotal || (a.names && r.pb.length !== a.names.length))) {
      a.pbFrom = r.pb;
      r.pb = a.splits.map(s => ({ name: s.name, time: s.time }));
    }
    save();
  }

  // Apunta el intento que se cierra en el historial de su ruta: el intento (con su tiempo final, si terminó) y la
  // duración de cada segmento al que llegó. Como LiveSplit: un segmento saltado queda sin tiempo y el siguiente lleva
  // el tiempo desde el último split con tiempo.
  function logAttempt() {
    if (a.phase === 'NotRunning' || a.key === null) return;
    const h = history(a.key);
    let id = 0;
    for (const x of h.attempts) id = Math.max(id, x.id);
    for (const seg of h.segments) for (const x of seg) id = Math.max(id, x.id);
    id++;
    // Tiempo del cronómetro en el método de la ruta; sin método (no vino de un .lss), en los dos.
    const val = t => (t === null ? { r: null, g: null } : h.method === 'g' ? { r: null, g: t } : h.method === 'r' ? { r: t, g: null } : { r: t, g: t });
    const last = a.splits[a.splits.length - 1];
    const ended = now();
    h.attempts.push({
      id, started: lssDate(a.started || ended), startedSynced: false, ended: lssDate(ended), endedSynced: false,
      ...val(a.phase === 'Ended' && last ? last.time : null), pause: null,
    });
    let prev = 0;
    a.splits.forEach((s, i) => {
      h.segments[i] = h.segments[i] || [];
      if (s.time === null) h.segments[i].push({ id, r: null, g: null });
      else { h.segments[i].push({ id, ...val(s.time - prev) }); prev = s.time; }
    });
    if (h.attempts.length > MAX_HISTORY) h.attempts.splice(0, h.attempts.length - MAX_HISTORY);
    saveHistory(a.key);
  }

  function reset() {
    logAttempt();
    Object.assign(a, { phase: 'NotRunning', splits: [], offset: 0, since: null, external: false, started: null });
    delete a.pbFrom;
    save();
  }

  // Tiempos de un .lss importado: PB acumulado y gold de cada segmento.
  function importRecords(key, names, times) {
    if (!times || !times.some(t => t.pb !== null || t.gold !== null)) return false;
    const r = record(key);
    // Un PB sin el tiempo final no es un PB completo: solo quedan los golds.
    r.pb = times[times.length - 1].pb !== null ? names.map((name, i) => ({ name, time: times[i].pb })) : [];
    r.golds = times.map(t => t.gold);
    save();
    return true;
  }

  // Una ruta entera de un .lss: PB, golds, intentos e historial (lo que tuviera esa ruta se reemplaza).
  // run: { times: [{ pb, gold }], attempts, history: { method, attempts, segments, extras } }
  function importRun(key, names, run) {
    if (!importRecords(key, names, run.times)) Object.assign(record(key), { pb: [], golds: [] });
    record(key).attempts = Number.isInteger(run.attempts) && run.attempts >= 0 ? run.attempts : 0;
    histories.set(key, cleanHistory(run.history));
    save();
    saveHistory(key);
  }

  // Lo que hace falta para exportar una ruta.
  const exportRun = key => ({ record: records[key] || null, history: history(key) });

  // Vuelve a leer timer.json y los historiales (después de restaurar una copia). Solo con el tiempo parado.
  function reload() {
    stored = (file && readJson(file, {})) || {};
    loadRecords();
    histories.clear();
    const back = cleanAttempt(stored.attempt);
    Object.assign(a, { phase: 'NotRunning', splits: [], offset: 0, since: null, external: false, started: null });
    delete a.pbFrom;
    if (back) Object.assign(a, { key: back.key, phase: back.phase === 'Running' ? 'Paused' : back.phase, splits: back.splits, offset: back.time, external: back.external, started: back.started });
  }

  // Lo que necesita la vista del cronómetro (la fuente de OBS). La vista lo hace correr por su cuenta entre lecturas.
  function view() {
    const r = records[a.key] || { pb: [], golds: [], attempts: 0 };
    const n = a.names ? a.names.length : Math.max(a.splits.length + (a.phase === 'Running' || a.phase === 'Paused' ? 1 : 0), r.pb.length);
    // Al terminar con un PB nuevo, las filas se siguen comparando con el anterior hasta reiniciar (se ve lo ganado).
    const cmp = a.phase === 'Ended' && a.pbFrom ? a.pbFrom : r.pb;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const s = a.splits[i], p = cmp[i];
      const name = a.names ? a.names[i] : (s && s.name) || (p && p.name) || '';
      const pb = p && p.time !== undefined ? p.time : null;
      const t = s ? s.time : null;
      // Duración del segmento, si se conoce, para comparar con su gold.
      const prev = i === 0 ? 0 : a.splits[i - 1] ? a.splits[i - 1].time : null;
      rows.push({ name, time: t, pb, delta: t !== null && pb !== null ? t - pb : null, gold: !!(s && s.gold), skipped: !!s && t === null, segment: s && t !== null && prev !== null ? t - prev : null });
    }
    const golds = r.golds.slice(0, n);
    const pbTotal = r.pb.length ? r.pb[r.pb.length - 1].time : null;
    // Con segmentos saltados, el PB puede bajar de la suma de golds sueltos: la mejor run posible nunca es peor que el PB.
    let sumOfBest = golds.length === n && n > 0 && golds.every(g => g !== null) ? golds.reduce((x, y) => x + y, 0) : null;
    if (sumOfBest !== null && pbTotal !== null && pbTotal < sumOfBest) sumOfBest = pbTotal;
    return {
      key: a.key, phase: a.phase, index: index(), time: time(), running: a.phase === 'Running' && !a.external,
      rows, pb: pbTotal, sumOfBest, attempts: r.attempts, fixed: !!a.names,
    };
  }

  return {
    get phase() { return a.phase; }, get key() { return a.key; }, get splits() { return a.splits; },
    index, time, currentName, setRoute, start, pause, resume, setTime, split, skip, undo, reset,
    importRecords, importRun, exportRun, reload, record: key => records[key] || null, view, save, saveSoon,
  };
}

module.exports = { createTimer, parseTime, formatTime, lssDate };
