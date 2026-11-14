// Pruebas de los splits automáticos (edición avanzada) contra un LiveSplit falso que habla su protocolo TCP.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { createSplitter } = require('../lib/splitter.js');
const { buildSave } = require('./build-save.js');

// LiveSplit de mentira: fases, índice de split, nombres y Game Time, como el servidor TCP real (1.8.37).
function fakeLiveSplit(names) {
  const ls = { phase: 'NotRunning', index: -1, names, gameTime: '00:00:00', log: [] };
  const server = net.createServer(socket => {
    let buf = '';
    socket.setEncoding('utf8');
    socket.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        const reply = run(line);
        if (reply !== undefined) socket.write(reply + '\n');
      }
    });
    socket.on('error', () => {});
  });
  function run(line) {
    const [cmd, ...rest] = line.split(' ');
    const arg = rest.join(' ');
    if (!cmd.startsWith('get') && cmd !== 'ping') ls.log.push(line);
    switch (cmd) {
      case 'getcurrenttimerphase': return ls.phase;
      case 'getsplitindex': return String(ls.index);
      case 'getcurrentsplitname': return ls.index >= 0 && ls.index < ls.names.length ? ls.names[ls.index] : '-';
      case 'getcurrentgametime': return ls.gameTime;
      case 'ping': return 'pong';
      case 'starttimer': if (ls.phase === 'NotRunning') Object.assign(ls, { phase: 'Running', index: 0 }); return undefined;
      case 'split': if (ls.phase === 'Running') { ls.index++; if (ls.index >= ls.names.length) ls.phase = 'Ended'; } return undefined;
      case 'skipsplit': if (ls.phase === 'Running' && ls.index < ls.names.length - 1) ls.index++; return undefined;
      case 'pause': if (ls.phase === 'Running') ls.phase = 'Paused'; return undefined;
      case 'resume': if (ls.phase === 'Paused') ls.phase = 'Running'; return undefined;
      case 'reset': Object.assign(ls, { phase: 'NotRunning', index: -1 }); return undefined;
      case 'setgametime': ls.gameTime = arg; return undefined;
      default: return undefined;
    }
  }
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ ls, port: server.address().port, close: () => server.close() })));
}

// Las órdenes viajan por TCP: se da un momento a que lleguen antes de mirar el LiveSplit falso.
const settle = () => new Promise(r => setTimeout(r, 150));
const waitFor = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.fail('no llegó a cumplirse: ' + check.toString());
};

// Un splitter con su carpeta de datos y un guardado propios. writeSave(set) cambia el guardado como lo haría el juego.
async function setup(names, settings, stored) {
  const fake = await fakeLiveSplit(names);
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
  const run = { slot: 1, frames: 0, floors: [] };
  const gameData = () => ({ collection: [1], achievements: new Map(), achievementName: id => `#${id}` });
  const splitter = createSplitter({ dataDir: dir, gameData, selectedSave: () => ({ id: '123/1', file: saveFile }), currentRun: () => run });
  const api = async body => JSON.parse((await splitter.respond({ method: 'POST', pathname: '/api/livesplit', readJsonBody: async () => body })).body);
  const status = async () => JSON.parse((await splitter.respond({ method: 'GET', pathname: '/api/livesplit' })).body);
  await api({ action: 'settings', settings: { enabled: true, port: fake.port, ...settings } });
  await waitFor(() => fake.ls.log.length === 0 && true);
  const ready = async () => { for (let i = 0; i < 100; i++) { const s = await status(); if (s.connection.phase) return; await new Promise(r => setTimeout(r, 50)); } assert.fail('sin conexión'); };
  await ready();
  const done = () => { splitter.stop(); fake.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { ls: fake.ls, splitter, api, status, writeSave, run, dir, done };
}

const ROUTE = {
  name: 'Prueba', game: 'Isaac', category: 'DeadGod%',
  segments: [
    { name: '1. Pitch Black', conds: [{ t: 'challenge', id: 1 }], sure: true },
    { name: 'Isaac - Lamb', conds: [{ t: 'mark', row: 0, col: 5, min: 1 }], sure: true },
    { name: 'DEAD GOD', conds: [{ t: 'ach', id: 637 }], sure: true },
  ],
};
const NAMES = ROUTE.segments.map(s => s.name);

test('mi ruta: empieza con la primera partida y hace cada split al conseguirlo', async () => {
  const t = await setup(NAMES, { mode: 'route' });
  try {
    await t.api({ action: 'route', route: ROUTE });
    t.splitter.onLogEvent('start', { mode: 'New', slot: 1, seed: 'AAAA BBBB', run: t.run });
    await settle();
    assert.strictEqual(t.ls.phase, 'Running');
    assert.ok(t.ls.log.includes('switchto gametime'));
    t.writeSave({ challenges: { 1: 1 } });
    await waitFor(() => t.ls.index === 1);
    t.writeSave({ challenges: { 1: 1 }, counters: { 97: 1 } });
    await waitFor(() => t.ls.index === 2);
    t.writeSave({ challenges: { 1: 1 }, counters: { 97: 1 }, achievements: { 637: 1 } });
    await waitFor(() => t.ls.phase === 'Ended');
    assert.deepStrictEqual(t.ls.log.filter(l => /split/.test(l)), ['split', 'split', 'split']);
  } finally { t.done(); }
});

test('una partida de otra ranura no empieza la run del guardado elegido', async () => {
  const t = await setup(NAMES, { mode: 'route' });
  try {
    await t.api({ action: 'route', route: ROUTE });
    t.splitter.onLogEvent('start', { mode: 'New', slot: 2, seed: 'AAAA BBBB', run: { slot: 2 } });
    await settle();
    assert.strictEqual(t.ls.phase, 'NotRunning');
  } finally { t.done(); }
});

test('al retomar otro día: sigue con el tiempo guardado y salta lo ya conseguido', async () => {
  const t = await setup(NAMES, { mode: 'route' }, { session: { saveId: '123/1', base: 3600, achCount: 0, finished: false } });
  try {
    await t.api({ action: 'route', route: ROUTE });
    t.writeSave({ challenges: { 1: 1 } });
    t.splitter.onLogEvent('start', { mode: 'Continue', slot: 1, seed: 'AAAA BBBB', run: t.run });
    await settle();
    assert.ok(t.ls.log.includes('setgametime 1:00:00.00'), t.ls.log.join(' | '));
    await waitFor(() => t.ls.index === 1);
    assert.ok(t.ls.log.includes('skipsplit'));
    assert.ok(!t.ls.log.includes('split'), 'lo de sesiones anteriores no se cierra con tiempo');
    // Lo conseguido a partir de ahora sí es un split.
    t.writeSave({ challenges: { 1: 1 }, counters: { 97: 1 } });
    await waitFor(() => t.ls.index === 2);
    assert.ok(t.ls.log.includes('split'));
  } finally { t.done(); }
});

test('el Game Time de LiveSplit se guarda para la próxima sesión', async () => {
  const t = await setup(NAMES, { mode: 'route' });
  try {
    await t.api({ action: 'route', route: ROUTE });
    t.splitter.onLogEvent('start', { mode: 'New', slot: 1, seed: 'AAAA BBBB', run: t.run });
    await settle();
    t.ls.gameTime = '02:03:04.5000000';
    await waitFor(() => JSON.parse(fs.readFileSync(path.join(t.dir, 'livesplit.json'), 'utf8')).session.base === 7384.5);
  } finally { t.done(); }
});

test('si LiveSplit tiene otros splits abiertos, no se toca nada', async () => {
  const t = await setup(['Otra cosa', 'B', 'C'], { mode: 'route' });
  try {
    await t.api({ action: 'route', route: ROUTE });
    t.splitter.onLogEvent('start', { mode: 'New', slot: 1, seed: 'AAAA BBBB', run: t.run });
    await settle();
    t.writeSave({ challenges: { 1: 1 } });
    await new Promise(r => setTimeout(r, 1300));
    assert.strictEqual(t.ls.index, 0);
    assert.strictEqual((await t.status()).connection.mismatch, true);
  } finally { t.done(); }
});

test('pausa al cerrar el juego y sigue al volver a abrirlo', async () => {
  const t = await setup(NAMES, { mode: 'route' });
  try {
    await t.api({ action: 'route', route: ROUTE });
    t.splitter.onLogEvent('start', { mode: 'New', slot: 1, seed: 'AAAA BBBB', run: t.run });
    await settle();
    t.splitter.onLogEvent('shutdown', {});
    await settle();
    assert.strictEqual(t.ls.phase, 'Paused');
    t.splitter.onLogEvent('boot', {});
    await settle();
    assert.strictEqual(t.ls.phase, 'Running');
  } finally { t.done(); }
});

test('por partida: split al ganar o al empezar otra tras morir; continuar no cuenta', async () => {
  const names = ['Run 1', 'Run 2', 'Run 3', 'Run 4', 'Run 5', 'DEAD GOD'];
  const t = await setup(names, { mode: 'runs', runCount: 5 });
  try {
    const run = { slot: 1 };
    t.splitter.onLogEvent('start', { mode: 'New', slot: 1, seed: 'S1', run });
    await settle();
    t.splitter.onLogEvent('win', { run, cutscene: 17 });
    await settle();
    assert.strictEqual(t.ls.index, 1);
    t.splitter.onLogEvent('start', { mode: 'New', slot: 1, seed: 'S2', run });
    await settle();
    assert.strictEqual(t.ls.index, 1, 'la anterior ya tuvo su split');
    t.splitter.onLogEvent('menu', { run });
    await settle();
    t.splitter.onLogEvent('start', { mode: 'Continue', slot: 1, seed: 'S2', run });
    await settle();
    assert.strictEqual(t.ls.index, 1, 'continuar la misma partida no la cierra');
    t.splitter.onLogEvent('start', { mode: 'New', slot: 1, seed: 'S3', run });
    await settle();
    assert.strictEqual(t.ls.index, 2, 'la partida S2 terminó sin final (muerte)');
  } finally { t.done(); }
});

test('por piso y por capítulo, como el autosplitter clásico', async () => {
  const t = await setup(['B1', 'B2', 'C1', 'C2', 'End'], { mode: 'floors' });
  try {
    const run = { slot: 1, floors: [] };
    const floor = async stage => { run.floors.push({ stage, type: 0 }); t.splitter.onLogEvent('floor', { run, floor: run.floors[run.floors.length - 1] }); await settle(); };
    t.splitter.onLogEvent('start', { mode: 'New', slot: 3, seed: 'X', run });
    await settle();
    assert.strictEqual(t.ls.phase, 'Running');
    await floor(1);
    assert.strictEqual(t.ls.index, 0, 'el primer piso no es un split');
    await floor(2); await floor(3);
    assert.strictEqual(t.ls.index, 2);
    await t.api({ action: 'settings', settings: { mode: 'chapters' } });
    await floor(4);
    assert.strictEqual(t.ls.index, 2, 'mismo capítulo');
    await floor(5);
    assert.strictEqual(t.ls.index, 3);
    t.splitter.onLogEvent('win', { run, cutscene: 17 });
    await settle();
    assert.strictEqual(t.ls.index, 4);
    // Otra partida: reinicia y vuelve a empezar.
    t.splitter.onLogEvent('start', { mode: 'New', slot: 3, seed: 'Y', run: { slot: 3, floors: [] } });
    await settle();
    assert.ok(t.ls.log.includes('reset'));
    assert.strictEqual(t.ls.phase, 'Running');
    assert.strictEqual(t.ls.index, 0);
  } finally { t.done(); }
});

test('importar un .lss deduce las condiciones y pasa al modo de ruta', async () => {
  const t = await setup(NAMES, { mode: 'blocks' });
  try {
    const { writeLss } = require('../lib/splits.js');
    const s = await t.api({ action: 'importLss', fileName: 'Mi ruta.lss', text: writeLss({ game: 'G', category: 'C', segments: ['2. High Brow', 'Raro', 'DEAD GOD'] }) });
    assert.strictEqual(s.settings.mode, 'route');
    assert.deepStrictEqual(s.segments.map(x => [x.name, x.sure, x.conds.length]), [['2. High Brow', true, 1], ['Raro', false, 0], ['DEAD GOD', true, 1]]);
    assert.strictEqual(s.route.name, 'Mi ruta');
    const exported = await t.api({ action: 'exportLss' });
    assert.strictEqual(exported.fileName, 'Mi ruta.lss');
    assert.match(exported.text, /<Name>Raro<\/Name>/);
  } finally { t.done(); }
});
