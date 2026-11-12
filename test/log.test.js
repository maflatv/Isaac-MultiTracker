// Pruebas del lector de log.txt con líneas en el formato real del juego. Ejecutar: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RunLog } = require('../lib/log.js');

const L = {
  seed: (seed = 'ABCD EFGH', mode = 'New', slot = 1) => `[INFO] - RNG Start Seed: ${seed} (123456789) [${mode}, ${slot}]`,
  player: subtype => `[INFO] - [Frame: 0] Initialized player with Variant 0 and Subtype ${subtype}`,
  level: (stage, type = 0) => `[INFO] - Level::Init m_Stage ${stage}, m_StageType ${type} Seed 2033709761`,
  room: (name, key = '1.2') => `[INFO] - Room ${key}(${name})`,
  // Sin número de frame: el juego lo escribe, pero solo importa para Glowing Hourglass.
  transition: () => '[INFO] - Starting room transition (type 0) ',
  stage: n => `[INFO] - [Frame ${n}] Starting stage transition (transition type: 0) `,
  flush: () => '[INFO] - item queue flush',
  add: (id, name = 'Item', player = 0, who = 'Isaac') => `[INFO] - Adding collectible ${id} (${name}) to player ${player} (${who}) from pool treasure`,
  remove: (id, player = 0) => `[INFO] - Removing collectible ${id} (Item) from player ${player} (Isaac)`,
  blind: () => '[INFO] - Curse of Blind',
  frame: n => `[INFO] - [Frame ${n}] Starting room transition (type 0) `,
  swapControl: () => '[INFO] - SetControllerId() Setting controller ID to 0, (Prev: 0)',
  swapHud: () => '[INFO] - Assinging player entity 0 (ControlerIndex = 0) to HUD slot 0',
};

// Activos y objetos de misión de las pruebas: como en items.xml.
const ACTIVES = new Set([105, 711]); // The D6, Flip
const QUESTS = new Set([327]); // The Polaroid

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'log.txt');
  fs.writeFileSync(file, '');
  const make = saved => new RunLog(file, saved, id => ACTIVES.has(id), id => QUESTS.has(id));
  const log = make();
  // Escribe las líneas y lee como lo haría el tracker. Un segundo poll() cierra las ráfagas (rerolls).
  const write = (...lines) => { fs.appendFileSync(file, lines.join('\n') + '\n'); log.poll(); log.poll(); };
  const live = () => log.run.items.filter(i => !i.removed).map(i => i.id);
  return { file, log, write, live, make };
}

// Partida nueva con Isaac en el primer piso.
const start = (write, character = 0) => write(L.seed(), L.player(character), L.level(1), L.room('Start Room'));
const pick = (id, ...rest) => [L.flush(), L.add(id, ...rest)];
// Entrar en una sala andando: siempre hay una transición antes. Con frame, la transición lo lleva.
const go = (name, key = '1.3', frame) => [frame === undefined ? L.transition() : L.frame(frame), L.room(name, key)];

test('un objeto recogido se añade en su piso y uno quitado se marca', t => {
  const { log, write, live } = setup(t);
  start(write);
  write(...pick(1, 'The Sad Onion'));
  write(L.level(2), ...pick(2, 'The Inner Eye'));
  assert.deepStrictEqual(live(), [1, 2]);
  assert.deepStrictEqual(log.run.items.map(i => i.floor), [0, 1]);
  write(L.remove(1));
  assert.deepStrictEqual(live(), [2]);
});

test('un reroll (D4) quita los pasivos que tenía y deja los nuevos como no recogidos', t => {
  const { log, write, live } = setup(t);
  start(write);
  for (const id of [1, 2, 3, 4, 5]) write(...pick(id));
  write(...pick(105, 'The D6')); // activo: un reroll no lo cambia
  write(...[11, 12, 13, 14, 15].map(id => L.add(id)));
  assert.deepStrictEqual(live().sort((a, b) => a - b), [11, 12, 13, 14, 15, 105]);
  assert.ok(log.run.items.filter(i => i.id > 10 && i.id < 20).every(i => i.granted));
});

test('un objeto suelto sin recoger (un regalo) no se toma por reroll', t => {
  const { write, live } = setup(t);
  start(write);
  for (const id of [1, 2, 3]) write(...pick(id));
  write(L.add(50));
  assert.deepStrictEqual(live(), [1, 2, 3, 50]);
});

test('Genesis quita todo al entrar en su sala; lo de misión vuelve a su piso', t => {
  const { log, write, live } = setup(t);
  start(write);
  write(...pick(327, 'The Polaroid'));
  write(L.level(2), ...pick(1));
  write(L.remove(622), ...go('Genesis Room'));
  assert.deepStrictEqual(live(), []);
  write(L.add(327, 'The Polaroid'));
  assert.deepStrictEqual(live(), [327]);
  assert.strictEqual(log.run.items[0].floor, 0);
});

test('lo del Esau del Alma de Jacob y Esaú desaparece al cambiar de sala', t => {
  const { log, write, live } = setup(t);
  start(write);
  write(...pick(1));
  write(...pick(2, 'Item', 1, 'Esau'));
  assert.strictEqual(log.run.items.find(i => i.id === 2).soul, true);
  write(...go('Normal Room'));
  assert.deepStrictEqual(live(), [1]);
});

test('con Jacob y Esaú, cada objeto es de quien lo toma', t => {
  const { log, write } = setup(t);
  start(write, 19);
  write(...pick(1, 'Item', 0, 'Jacob'), ...pick(2, 'Item', 1, 'Esau'));
  assert.deepStrictEqual(log.run.items.map(i => i.owner), ['jacob', 'esau']);
  assert.ok(!log.run.items.some(i => i.soul));
});

test('lo que recoge el Keeper de Strawman es suyo y no se quita al cambiar de sala', t => {
  const { log, write, live } = setup(t);
  start(write);
  write(...pick(667, 'Strawman'));
  write(...pick(30, "Mom's Heels", 2, 'Keeper'));
  const heels = log.run.items.find(i => i.id === 30);
  assert.strictEqual(heels.owner, 'strawman');
  assert.strictEqual(heels.helper, true);
  write(...go('Normal Room'));
  assert.deepStrictEqual(live(), [667, 30]);
});

test('sin Strawman, un Keeper que no es el personaje no se marca como suyo', t => {
  const { log, write } = setup(t);
  start(write);
  write(...pick(30, "Mom's Heels", 2, 'Keeper'));
  assert.strictEqual(log.run.items[0].owner, undefined);
});

test('Tainted Lazarus: cada objeto es de la forma activa y Flip se muestra una vez sin dueño', t => {
  const { log, write } = setup(t);
  start(write, 29);
  write(...pick(1));
  write(L.swapControl(), L.swapControl(), L.swapHud());
  write(...pick(2));
  write(...pick(711, 'Flip'), ...pick(711, 'Flip'));
  const owners = Object.fromEntries(log.run.items.map(i => [i.id, i.owner]));
  assert.deepStrictEqual(owners, { 1: 'lazarus', 2: 'lazarus_dead', 711: undefined });
  assert.strictEqual(log.run.items.filter(i => i.id === 711).length, 1);
});

test('la maldición del ciego marca lo tomado en el piso; Black Candle la quita para lo siguiente', t => {
  const { log, write } = setup(t);
  start(write);
  write(L.blind(), ...pick(1));
  write(...pick(260, 'Black Candle'), ...pick(2));
  assert.deepStrictEqual(log.run.items.map(i => i.blind), [true, true, false]);
});

test('el contador de frames avanza y no retrocede', t => {
  const { log, write } = setup(t);
  start(write);
  write(L.frame(500), L.frame(300));
  assert.strictEqual(log.run.frames, 500);
});

test('si el juego vacía el log, se empieza de nuevo desde el principio', t => {
  const { file, log, write, live } = setup(t);
  start(write);
  write(...pick(1));
  fs.writeFileSync(file, '');
  log.poll();
  assert.strictEqual(log.run, null);
  write(L.seed('ZZZZ ZZZZ'), L.player(0), L.level(1), ...pick(2));
  assert.deepStrictEqual(live(), [2]);
});

test('una partida continuada tras reiniciar el juego recupera sus objetos de la instantánea', t => {
  const { file, log, write, make } = setup(t);
  start(write);
  write(...pick(1), ...pick(2));
  const saved = JSON.parse(JSON.stringify(log.snapshot()));
  fs.writeFileSync(file, ''); // el juego vacía el log al arrancar
  const again = make(saved);
  fs.appendFileSync(file, [L.player(0), L.seed('ABCD EFGH', 'Continue'), L.level(1)].join('\n') + '\n');
  again.poll();
  assert.deepStrictEqual(again.run.items.map(i => i.id), [1, 2]);
});

test('una línea a medio escribir se completa en la siguiente lectura', t => {
  const { file, log, write, live } = setup(t);
  start(write);
  const line = L.add(7);
  fs.appendFileSync(file, L.flush() + '\n' + line.slice(0, 20));
  log.poll();
  assert.deepStrictEqual(live(), []);
  fs.appendFileSync(file, line.slice(20) + '\n');
  log.poll();
  assert.deepStrictEqual(live(), [7]);
});

// Glowing Hourglass: el juego no escribe nada al usarlo. Vuelve a la sala anterior sin transición, o con el contador
// de frames más bajo, y todo queda como al entrar en ella.
test('Glowing Hourglass quita del todo lo tomado en la sala donde se usa y conserva lo de la anterior', t => {
  const { log, write, live } = setup(t);
  start(write);
  write(...go('Sala A', '1.10'), ...pick(1));
  write(...go('Sala B', '1.20'), ...pick(2));
  write(L.room('Sala A', '1.10')); // rebobinado: sin transición
  assert.deepStrictEqual(live(), [1]);
  // Desaparece, no se marca: lo quitado sigue contando para las transformaciones y esto no debe contar.
  assert.deepStrictEqual(log.run.items.map(i => i.id), [1]);
  write(...go('Sala B', '1.20'), ...pick(2));
  assert.deepStrictEqual(log.run.items.map(i => i.id), [1, 2]);
});

test('volver andando a una sala no deshace nada', t => {
  const { log, write } = setup(t);
  start(write);
  write(...go('Sala A', '1.10'), ...pick(1));
  write(...go('Sala B', '1.20'), ...pick(2));
  write(...go('Sala A', '1.10'));
  assert.deepStrictEqual(log.run.items.map(i => i.id), [1, 2]);
});

test('Glowing Hourglass también se reconoce si la transición vuelve al frame de la sala deshecha', t => {
  const { log, write } = setup(t);
  start(write);
  write(...go('Sala A', '1.10', 100), ...pick(1));
  write(...go('Sala B', '1.20', 400), ...pick(2));
  write(...go('Sala A', '1.10', 400));
  assert.deepStrictEqual(log.run.items.map(i => i.id), [1]);
  // Lo siguiente vuelve a ser normal.
  write(...go('Sala B', '1.20', 450), ...pick(3));
  assert.deepStrictEqual(log.run.items.map(i => i.id), [1, 3]);
});

test('Glowing Hourglass en la primera sala de un piso vuelve al piso anterior sin lo tomado en el nuevo', t => {
  const { log, write } = setup(t);
  start(write);
  write(...go('Sala A', '1.10'), ...pick(1));
  write(L.stage(300), L.level(2), L.room('Start Room', '1.2'), ...pick(2));
  write(L.level(1), L.room('Sala A', '1.10'));
  assert.deepStrictEqual(log.run.items.map(i => i.id), [1]);
  assert.deepStrictEqual(log.run.floors.map(f => f.stage), [1]);
});

test('Glowing Hourglass tras un reroll devuelve los objetos que tenía', t => {
  const { log, write, live } = setup(t);
  start(write);
  for (const id of [1, 2, 3, 4, 5]) write(...pick(id));
  write(...go('Sala de dados', '1.20'), ...[11, 12, 13, 14, 15].map(id => L.add(id)));
  assert.deepStrictEqual(live(), [11, 12, 13, 14, 15]);
  write(L.room('Start Room', '1.2'));
  assert.deepStrictEqual(live(), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(log.run.items.map(i => i.id), [1, 2, 3, 4, 5]);
});

test('una sala sin transición que no se había visitado no deshace nada', t => {
  const { log, write } = setup(t);
  start(write);
  write(...go('Sala A', '1.10'), ...pick(1));
  write(L.room('Sala X', '1.99'));
  assert.deepStrictEqual(log.run.items.map(i => i.id), [1]);
});
