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
