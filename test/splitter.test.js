// Splits automáticos de la edición avanzada con el cronómetro propio (lib/timer.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSplitter } = require('../lib/splitter.js');
const { createTimer } = require('../lib/timer.js');
const { buildSave } = require('./build-save.js');

// Un splitter con su carpeta de datos, un guardado propio y un reloj que se mueve a mano (clock.t, en ms).
// writeSave(set) cambia el guardado como lo haría el juego; tick() hace una vuelta del bucle.
async function setup(settings, stored) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-splitter-'));
  const saveFile = path.join(dir, 'rep+persistentgamedata1.dat');
  let version = 0;
  const writeSave = set => {
    fs.writeFileSync(saveFile, buildSave({ set }));
    // La fecha cambia en cada escritura aunque sea en el mismo milisegundo.
    const t = new Date(Date.now() + ++version * 1000);
    fs.utimesSync(saveFile, t, t);
  };
  writeSave({});
  if (stored) fs.writeFileSync(path.join(dir, 'livesplit.json'), JSON.stringify(stored));
  const clock = { t: 1e6 };
  const timer = createTimer({ file: path.join(dir, 'timer.json'), now: () => clock.t });
  const run = { slot: 1, frames: 0, floors: [] };
  const gameData = () => ({ collection: [1], achievements: new Map(), achievementName: id => `#${id}` });
  const splitter = createSplitter({ dataDir: dir, timer, gameData, selectedSave: () => ({ id: '123/1', file: saveFile }), currentRun: () => run });
  const api = async body => JSON.parse((await splitter.respond({ method: 'POST', pathname: '/api/livesplit', readJsonBody: async () => body })).body);
  const get = async p => JSON.parse((await splitter.respond({ method: 'GET', pathname: p })).body);
  await api({ action: 'settings', settings: { enabled: true, ...settings } });
  const done = () => { splitter.stop(); fs.rmSync(dir, { recursive: true, force: true }); };
  // Como en el juego: tras la seed (start) se carga la primera sala (enter). info.loading: aún sin sala.
  const ev = (type, info) => {
    splitter.onLogEvent(type, info);
    if (type === 'start' && !info.loading) splitter.onLogEvent('enter', info);
  };
  const tick = () => splitter.tick();
  // Tiempos de los splits hechos (null = saltado).
  const times = () => timer.splits.map(s => s.time);
  return { timer, splitter, api, get, ev, tick, writeSave, run, dir, clock, times, done };
}

const ROUTE = {
  name: 'Prueba', game: 'Isaac', category: 'DeadGod%',
  segments: [
    { name: '1. Pitch Black', conds: [{ t: 'challenge', id: 1 }], sure: true },
    { name: 'Isaac - Lamb', conds: [{ t: 'mark', row: 0, col: 5, min: 1 }], sure: true },
    { name: 'DEAD GOD', conds: [{ t: 'ach', id: 637 }], sure: true },
  ],
};

test('mi ruta: empieza con la primera partida y hace cada split al conseguirlo', async () => {
  const t = await setup({ mode: 'route' });
  try {
    await t.api({ action: 'route', route: ROUTE });
    t.ev('start', { mode: 'New', slot: 1, seed: 'AAAA BBBB', run: t.run });
    assert.strictEqual(t.timer.phase, 'Running');
    t.clock.t += 60000;
    t.writeSave({ challenges: { 1: 1 } });
    t.tick();
    assert.strictEqual(t.timer.index(), 1);
    t.clock.t += 30000;
    t.writeSave({ challenges: { 1: 1 }, counters: { 97: 1 } });
    t.tick();
    assert.strictEqual(t.timer.index(), 2);
    t.writeSave({ challenges: { 1: 1 }, counters: { 97: 1 }, achievements: { 637: 1 } });
    t.tick();
    assert.strictEqual(t.timer.phase, 'Ended');
    assert.deepStrictEqual(t.times(), [60, 90, 90]);
    const view = await t.get('/api/timer');
    assert.strictEqual(view.pb, 90, 'el primer intento terminado es el PB');
    assert.deepStrictEqual(view.rows.map(r => r.name), ROUTE.segments.map(s => s.name));
  } finally { t.done(); }
});

test('una partida de otra ranura no empieza la run del guardado elegido', async () => {
  const t = await setup({ mode: 'route' });
  try {
    await t.api({ action: 'route', route: ROUTE });
    t.ev('start', { mode: 'New', slot: 2, seed: 'AAAA BBBB', run: { slot: 2 } });
    assert.strictEqual(t.timer.phase, 'NotRunning');
  } finally { t.done(); }
});

test('al retomar otro día: sigue con el tiempo guardado y salta lo ya conseguido', async () => {
  const t = await setup({ mode: 'route' }, { session: { saveId: '123/1', base: 3600, achCount: 0, finished: false } });
  try {
    await t.api({ action: 'route', route: ROUTE });
    t.writeSave({ challenges: { 1: 1 } });
    t.ev('start', { mode: 'Continue', slot: 1, seed: 'AAAA BBBB', run: t.run });
    assert.strictEqual(t.timer.time(), 3600);
    t.tick();
    assert.deepStrictEqual(t.times(), [null], 'lo de sesiones anteriores no se cierra con tiempo');
    // Lo conseguido a partir de ahora sí es un split.
    t.clock.t += 5000;
    t.writeSave({ challenges: { 1: 1 }, counters: { 97: 1 } });
    t.tick();
    assert.deepStrictEqual(t.times(), [null, 3605]);
  } finally { t.done(); }
});

test('un segmento conseguido antes de llegar a él (fuera de orden) se salta sin tiempo', async () => {
  const t = await setup({ mode: 'route' });
  try {
    await t.api({ action: 'route', route: ROUTE });
    t.ev('start', { mode: 'New', slot: 1, seed: 'AAAA BBBB', run: t.run });
    // Primero se consigue el segundo segmento y después el primero.
    t.writeSave({ counters: { 97: 1 } });
    t.tick();
    assert.strictEqual(t.timer.index(), 0);
    t.clock.t += 10000;
    t.writeSave({ challenges: { 1: 1 }, counters: { 97: 1 } });
    t.tick();
    t.tick(); // el segmento ya conseguido se salta en la vuelta siguiente
    assert.deepStrictEqual(t.times(), [10, null]);
  } finally { t.done(); }
});

test('el tiempo de la run de Dead God se guarda para la próxima sesión', async () => {
  const t = await setup({ mode: 'route' });
  try {
    await t.api({ action: 'route', route: ROUTE });
    t.ev('start', { mode: 'New', slot: 1, seed: 'AAAA BBBB', run: t.run });
    t.clock.t += 7384500;
    t.ev('shutdown', {});
    const stored = JSON.parse(fs.readFileSync(path.join(t.dir, 'livesplit.json'), 'utf8'));
    assert.strictEqual(stored.session.base, 7384.5);
  } finally { t.done(); }
});

test('pausa al cerrar el juego y sigue al volver a abrirlo', async () => {
  const t = await setup({ mode: 'route' });
  try {
    await t.api({ action: 'route', route: ROUTE });
    t.ev('start', { mode: 'New', slot: 1, seed: 'AAAA BBBB', run: t.run });
    t.clock.t += 1000;
    t.ev('shutdown', {});
    assert.strictEqual(t.timer.phase, 'Paused');
    t.clock.t += 60000;
    t.ev('boot', {});
    assert.strictEqual(t.timer.phase, 'Paused', 'abrir el juego (menú) no reanuda');
    t.ev('start', { mode: 'Continue', slot: 1, seed: 'AAAA BBBB', run: t.run, loading: true });
    t.clock.t += 5000;
    assert.strictEqual(t.timer.phase, 'Paused', 'mientras carga la partida tampoco');
    t.ev('enter', { mode: 'Continue', slot: 1, seed: 'AAAA BBBB', run: t.run });
    assert.strictEqual(t.timer.phase, 'Running');
    assert.strictEqual(t.timer.time(), 1, 'el tiempo con el juego cerrado, en el menú o cargando no cuenta');
  } finally { t.done(); }
});

test('por partida: split al ganar o al empezar otra tras morir; continuar no cuenta', async () => {
  const t = await setup({ mode: 'runs', runCount: 5 });
  try {
    const run = { slot: 1 };
    t.ev('start', { mode: 'New', slot: 1, seed: 'S1', run });
    t.ev('win', { run, cutscene: 17 });
    assert.strictEqual(t.timer.index(), 1);
    t.ev('start', { mode: 'New', slot: 1, seed: 'S2', run });
    assert.strictEqual(t.timer.index(), 1, 'la anterior ya tuvo su split');
    t.ev('menu', { run });
    t.ev('start', { mode: 'Continue', slot: 1, seed: 'S2', run });
    assert.strictEqual(t.timer.index(), 1, 'continuar la misma partida no la cierra');
    t.ev('start', { mode: 'New', slot: 1, seed: 'S3', run });
    assert.strictEqual(t.timer.index(), 2, 'la partida S2 terminó sin final (muerte)');
  } finally { t.done(); }
});

test('por piso y por capítulo: un split por piso, el último al ganar; otra partida reinicia', async () => {
  const t = await setup({ mode: 'floors' });
  try {
    const run = { slot: 1, floors: [] };
    const floor = stage => { run.floors.push({ stage, type: 0 }); t.ev('floor', { run, floor: run.floors[run.floors.length - 1] }); };
    t.ev('start', { mode: 'New', slot: 3, seed: 'X', run });
    assert.strictEqual(t.timer.phase, 'Running');
    floor(1);
    assert.strictEqual(t.timer.index(), 0, 'el primer piso no es un split');
    floor(2); floor(3);
    assert.strictEqual(t.timer.index(), 2);
    await t.api({ action: 'settings', settings: { mode: 'chapters' } });
    t.ev('start', { mode: 'New', slot: 3, seed: 'Y', run: { slot: 3, floors: [] } });
    const run2 = { slot: 3, floors: [] };
    const floor2 = stage => { run2.floors.push({ stage, type: 0 }); t.ev('floor', { run: run2, floor: run2.floors[run2.floors.length - 1] }); };
    floor2(1); floor2(2);
    assert.strictEqual(t.timer.index(), 0, 'mismo capítulo');
    floor2(3);
    assert.strictEqual(t.timer.index(), 1);
    t.ev('win', { run: run2, cutscene: 17 });
    assert.strictEqual(t.timer.phase, 'Ended');
    // Otra partida: reinicia y vuelve a empezar.
    t.ev('start', { mode: 'New', slot: 3, seed: 'Z', run: { slot: 3, floors: [] } });
    assert.strictEqual(t.timer.phase, 'Running');
    assert.strictEqual(t.timer.index(), 0);
  } finally { t.done(); }
});

test('botones del cronómetro: split, deshacer, pausa y reinicio', async () => {
  const t = await setup({ mode: 'route', enabled: false });
  try {
    await t.api({ action: 'route', route: ROUTE });
    await t.api({ action: 'timer', op: 'start' });
    t.clock.t += 2000;
    await t.api({ action: 'timer', op: 'split' });
    assert.deepStrictEqual(t.times(), [2]);
    await t.api({ action: 'timer', op: 'undo' });
    assert.strictEqual(t.timer.index(), 0);
    await t.api({ action: 'timer', op: 'pause' });
    assert.strictEqual(t.timer.phase, 'Paused');
    await t.api({ action: 'timer', op: 'resume' });
    const s = await t.api({ action: 'timer', op: 'reset' });
    assert.strictEqual(s.timer.phase, 'NotRunning');
  } finally { t.done(); }
});

test('pausa del juego: pausa y sigue con el juego; una pausa del botón no la quita; empezar partida sigue', async () => {
  const t = await setup({ mode: 'route' });
  try {
    await t.api({ action: 'route', route: ROUTE });
    await t.api({ action: 'timer', op: 'start' });
    t.clock.t += 5000;
    t.ev('gamepause', { paused: true });
    assert.strictEqual(t.timer.phase, 'Paused');
    t.clock.t += 60000;
    t.ev('gamepause', { paused: false });
    assert.strictEqual(t.timer.phase, 'Running');
    assert.strictEqual(t.timer.time(), 5);
    await t.api({ action: 'timer', op: 'pause' });
    t.ev('gamepause', { paused: true });
    t.ev('gamepause', { paused: false });
    assert.strictEqual(t.timer.phase, 'Paused', 'la pausa del botón se respeta');
    t.ev('gamepause', { paused: true });
    t.ev('start', { mode: 'Continue', slot: 1, seed: 'X', run: t.run });
    assert.strictEqual(t.timer.phase, 'Running');
    await t.api({ action: 'settings', settings: { pauseWithGame: false } });
    t.ev('gamepause', { paused: true });
    assert.strictEqual(t.timer.phase, 'Running', 'opción apagada');
  } finally { t.done(); }
});

test('volver al menú pausa; continuar o empezar otra sigue; reiniciar con R no pausa', async () => {
  for (const mode of ['route', 'floors']) {
    const t = await setup({ mode, autoReset: false });
    try {
      if (mode === 'route') await t.api({ action: 'route', route: ROUTE });
      t.ev('start', { mode: 'New', slot: 1, seed: 'S1', run: t.run });
      t.clock.t += 1000;
      t.ev('start', { mode: 'New', slot: 1, seed: 'S2', run: t.run });
      assert.strictEqual(t.timer.phase, 'Running', `${mode}: reiniciar con R no pausa`);
      t.clock.t += 1000;
      t.ev('gamepause', { paused: true });
      t.ev('menu', { run: t.run });
      assert.strictEqual(t.timer.phase, 'Paused', `${mode}: en el menú está en pausa`);
      t.clock.t += 60000;
      t.ev('start', { mode: 'Continue', slot: 1, seed: 'S2', run: t.run });
      assert.strictEqual(t.timer.phase, 'Running', `${mode}: continuar sigue`);
      assert.strictEqual(t.timer.time(), 2, `${mode}: el menú no cuenta`);
      t.ev('menu', { run: t.run });
      t.clock.t += 60000;
      t.ev('start', { mode: 'New', slot: 1, seed: 'S3', run: t.run });
      assert.strictEqual(t.timer.phase, 'Running', `${mode}: una partida nueva sigue`);
      assert.strictEqual(t.timer.time(), 2);
    } finally { t.done(); }
  }
});

test('una run terminada con los botones no suma su tiempo al intento siguiente', async () => {
  const t = await setup({ mode: 'route', enabled: false });
  try {
    await t.api({ action: 'route', route: ROUTE });
    await t.api({ action: 'timer', op: 'start' });
    for (let i = 0; i < 3; i++) { t.clock.t += 10000; await t.api({ action: 'timer', op: 'split' }); }
    assert.strictEqual(t.timer.phase, 'Ended');
    await t.api({ action: 'timer', op: 'reset' });
    await t.api({ action: 'timer', op: 'start' });
    assert.strictEqual(t.timer.time(), 0);
  } finally { t.done(); }
});

test('importar un .lss deduce las condiciones, trae los tiempos y pasa al modo de ruta', async () => {
  const t = await setup({ mode: 'blocks' });
  try {
    const { writeLss } = require('../lib/splits.js');
    const text = writeLss({ game: 'G', category: 'C', segments: ['2. High Brow', 'Raro', 'DEAD GOD'], times: [{ pb: 10, gold: 10 }, { pb: 25, gold: 12 }, { pb: 40, gold: 15 }] });
    const s = await t.api({ action: 'importLss', fileName: 'Mi ruta.lss', text });
    assert.strictEqual(s.settings.mode, 'route');
    assert.deepStrictEqual(s.segments.map(x => [x.name, x.sure, x.conds.length]), [['2. High Brow', true, 1], ['Raro', false, 0], ['DEAD GOD', true, 1]]);
    assert.strictEqual(s.route.name, 'Mi ruta');
    const view = await t.get('/api/timer');
    assert.strictEqual(view.pb, 40);
    assert.strictEqual(view.sumOfBest, 37);
    const exported = await t.api({ action: 'exportLss' });
    assert.strictEqual(exported.fileName, 'Mi ruta.lss');
    assert.match(exported.text, /<Name>Raro<\/Name>/);
    assert.match(exported.text, /<RealTime>00:00:40/);
  } finally { t.done(); }
});

// ---------- Migración desde y hacia LiveSplit ----------
const SAMPLE_LSS = fs.readFileSync(path.join(__dirname, 'fixtures', 'livesplit-completo.lss'), 'utf8');

test('importar: primero la vista previa (qué trae y qué reemplaza); sin confirmar no cambia nada', async () => {
  const t = await setup({ mode: 'route' });
  try {
    await t.api({ action: 'route', route: ROUTE });
    const p = await t.api({ action: 'previewLss', fileName: 'Completo.lss', text: SAMPLE_LSS });
    assert.strictEqual(p.method, 'GameTime');
    assert.strictEqual(p.attemptCount, 7);
    assert.strictEqual(p.history, 2);
    assert.strictEqual(p.pb, 10200);
    assert.deepStrictEqual(p.comparisons, ['Mi carrera & amigos']);
    assert.strictEqual(p.icons, 1);
    assert.strictEqual(p.autoSplitter, true);
    assert.strictEqual(p.otherMethod, true);
    assert.strictEqual(p.current.name, 'Prueba');
    // Las subdivisiones de LiveSplit ("-" y "{Grupo}") no impiden entender el nombre.
    assert.deepStrictEqual(p.segments.map(s => s.sure), [true, true]);
    const st = await t.get('/api/livesplit');
    assert.strictEqual(st.route.name, 'Prueba');
    assert.strictEqual(st.canUndoImport, false);
    const bad = await t.api({ action: 'importLss', token: 'otro' });
    assert.strictEqual(bad.error, 'err.preview');
  } finally { t.done(); }
});

test('importar y exportar: intentos, historial, otro método, iconos, comparaciones y ajustes vuelven tal cual', async () => {
  const L = require('../lib/lss.js');
  const t = await setup({ mode: 'route' });
  try {
    const p = await t.api({ action: 'previewLss', fileName: 'Completo.lss', text: SAMPLE_LSS });
    const s = await t.api({ action: 'importLss', token: p.token });
    assert.strictEqual(s.route.name, 'Completo');
    assert.strictEqual(s.canUndoImport, true);
    const view = await t.get('/api/timer');
    assert.strictEqual(view.pb, 10200);
    assert.strictEqual(view.attempts, 7);
    const exported = await t.api({ action: 'exportLss' });
    const back = L.parseLss(exported.text), orig = L.parseLss(SAMPLE_LSS);
    // Todo igual que el original, más el bloque con las condiciones.
    assert.ok(back.block && back.block.segments.length === 2);
    back.block = null;
    assert.deepStrictEqual(back, orig);
  } finally { t.done(); }
});

test('cada intento queda en el historial (con su id) y se exporta; el PB nuevo deja sin PB el otro método', async () => {
  const L = require('../lib/lss.js');
  const t = await setup({ mode: 'route' });
  try {
    const p = await t.api({ action: 'previewLss', fileName: 'Completo.lss', text: SAMPLE_LSS });
    await t.api({ action: 'importLss', token: p.token });
    await t.api({ action: 'timer', op: 'start' });
    assert.strictEqual((await t.get('/api/livesplit')).canUndoImport, false);
    t.clock.t += 3000 * 1000; await t.api({ action: 'timer', op: 'split' });
    t.clock.t += 4000 * 1000; await t.api({ action: 'timer', op: 'split' });
    await t.api({ action: 'timer', op: 'reset' });
    const run = L.parseLss((await t.api({ action: 'exportLss' })).text);
    assert.strictEqual(run.attemptCount, 8);
    const last = run.attempts[run.attempts.length - 1];
    assert.strictEqual(last.id, 3);
    assert.deepStrictEqual([last.r, last.g], [null, 7000]);
    assert.deepStrictEqual(run.segments.map(s => s.history[s.history.length - 1]), [{ id: 3, r: null, g: 3000 }, { id: 3, r: null, g: 4000 }]);
    // PB nuevo en Game Time: el Real Time del PB anterior ya no le corresponde.
    assert.deepStrictEqual(run.segments.map(s => s.pb), [{ r: null, g: 3000 }, { r: null, g: 7000 }]);
    // Los golds de Real Time siguen (son de intentos que pasaron).
    assert.strictEqual(run.segments[0].best.r, 3480);
    assert.strictEqual(run.segments[0].best.g, 3000);
  } finally { t.done(); }
});

test('reimportar un .lss exportado desde aquí recupera las condiciones del bloque', async () => {
  const t = await setup({ mode: 'route' });
  try {
    await t.api({ action: 'route', route: { ...ROUTE, segments: [{ name: 'Raro', conds: [{ t: 'challenge', id: 9 }], sure: true }] } });
    const text = (await t.api({ action: 'exportLss' })).text;
    const p = await t.api({ action: 'previewLss', fileName: 'Prueba.lss', text });
    assert.strictEqual(p.fromBlock, true);
    const s = await t.api({ action: 'importLss', token: p.token });
    assert.deepStrictEqual(s.segments[0].conds, [{ t: 'challenge', id: 9 }]);
  } finally { t.done(); }
});

test('importar hace copia de seguridad y se puede deshacer', async () => {
  const t = await setup({ mode: 'route' });
  try {
    await t.api({ action: 'route', route: ROUTE });
    await t.api({ action: 'timer', op: 'start' });
    t.clock.t += 5000; await t.api({ action: 'timer', op: 'split' });
    await t.api({ action: 'timer', op: 'pause' });
    const p = await t.api({ action: 'previewLss', fileName: 'Completo.lss', text: SAMPLE_LSS });
    assert.strictEqual(p.running, true);
    await t.api({ action: 'importLss', token: p.token });
    assert.strictEqual(fs.readdirSync(path.join(t.dir, 'backups')).length, 1);
    const s = await t.api({ action: 'undoImport' });
    assert.strictEqual(s.route.name, 'Prueba');
    assert.strictEqual(s.canUndoImport, false);
    // El intento en pausa vuelve como estaba.
    assert.strictEqual(t.timer.phase, 'Paused');
    assert.strictEqual(t.timer.splits.length, 1);
    assert.strictEqual((await t.get('/api/timer')).pb, null);
  } finally { t.done(); }
});
