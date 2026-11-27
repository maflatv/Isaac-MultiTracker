// Cronómetro propio de la edición avanzada (lib/timer.js): PB, mejores segmentos, deshacer y guardado.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTimer, parseTime, formatTime } = require('../lib/timer.js');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-timer-'));
  const file = path.join(dir, 'timer.json');
  const clock = { t: 1e6 };
  const make = () => createTimer({ file, now: () => clock.t });
  const done = () => fs.rmSync(dir, { recursive: true, force: true });
  return { file, clock, make, done };
}
const NAMES = ['A', 'B', 'C'];

// Un intento entero con estas duraciones de segmento (en segundos).
function attempt(timer, clock, segs) {
  timer.setRoute('r', NAMES);
  timer.start();
  segs.forEach((s, i) => { clock.t += s * 1000; timer.split(NAMES[i]); });
}

test('el primer intento terminado es el PB; uno más lento no lo cambia y uno más rápido sí', () => {
  const s = setup();
  try {
    const timer = s.make();
    attempt(timer, s.clock, [10, 20, 30]);
    assert.strictEqual(timer.phase, 'Ended');
    assert.strictEqual(timer.view().pb, 60);
    timer.reset();
    attempt(timer, s.clock, [12, 25, 30]);
    assert.strictEqual(timer.view().pb, 60);
    timer.reset();
    attempt(timer, s.clock, [9, 20, 29]);
    assert.strictEqual(timer.view().pb, 58);
    assert.strictEqual(timer.record('r').attempts, 3);
  } finally { s.done(); }
});

test('los mejores segmentos (golds) se guardan aunque el intento no sea PB', () => {
  const s = setup();
  try {
    const timer = s.make();
    attempt(timer, s.clock, [10, 20, 30]);
    timer.reset();
    attempt(timer, s.clock, [15, 5, 40]);
    const v = timer.view();
    assert.strictEqual(v.pb, 60);
    assert.strictEqual(v.sumOfBest, 10 + 5 + 30);
  } finally { s.done(); }
});

test('la diferencia con el PB y el gold se ven en cada fila', () => {
  const s = setup();
  try {
    const timer = s.make();
    attempt(timer, s.clock, [10, 20, 30]);
    timer.reset();
    timer.start();
    s.clock.t += 8000;
    timer.split('A');
    const row = timer.view().rows[0];
    assert.strictEqual(row.delta, -2);
    assert.strictEqual(row.gold, true);
  } finally { s.done(); }
});

test('deshacer un split devuelve el segmento y el gold que había', () => {
  const s = setup();
  try {
    const timer = s.make();
    attempt(timer, s.clock, [10, 20, 30]);
    timer.reset();
    timer.start();
    s.clock.t += 5000;
    timer.split('A');
    assert.strictEqual(timer.view().sumOfBest, 55);
    timer.undo();
    assert.strictEqual(timer.index(), 0);
    assert.strictEqual(timer.view().sumOfBest, 60);
  } finally { s.done(); }
});

test('saltar un segmento: no tiene tiempo y el siguiente no cuenta como gold', () => {
  const s = setup();
  try {
    const timer = s.make();
    attempt(timer, s.clock, [10, 20, 30]);
    timer.reset();
    timer.start();
    timer.skip();
    s.clock.t += 15000;
    timer.split('B');
    const v = timer.view();
    assert.strictEqual(v.rows[0].time, null);
    assert.strictEqual(v.rows[0].skipped, true);
    assert.strictEqual(v.sumOfBest, 60, 'B en 15 s no es gold: incluye el segmento saltado');
  } finally { s.done(); }
});

test('si la app se cierra con el tiempo en marcha, vuelve en pausa con el tiempo guardado', () => {
  const s = setup();
  try {
    const timer = s.make();
    timer.setRoute('r', NAMES);
    timer.start();
    s.clock.t += 42000;
    timer.save();
    const again = s.make();
    assert.strictEqual(again.phase, 'Paused');
    assert.strictEqual(again.time(), 42);
    s.clock.t += 1000;
    again.resume();
    s.clock.t += 1000;
    assert.strictEqual(again.time(), 43);
  } finally { s.done(); }
});

test('importar tiempos: PB solo si el último segmento tiene tiempo', () => {
  const s = setup();
  try {
    const timer = s.make();
    timer.importRecords('r', NAMES, [{ pb: 10, gold: 9 }, { pb: 30, gold: 18 }, { pb: 50, gold: 19 }]);
    timer.setRoute('r', NAMES);
    assert.strictEqual(timer.view().pb, 50);
    assert.strictEqual(timer.view().sumOfBest, 46);
    timer.importRecords('x', NAMES, [{ pb: 10, gold: 9 }, { pb: null, gold: null }, { pb: null, gold: null }]);
    assert.strictEqual(timer.record('x').pb.length, 0);
  } finally { s.done(); }
});

test('al batir el PB, las filas muestran lo ganado frente al PB anterior hasta reiniciar', () => {
  const s = setup();
  try {
    const timer = s.make();
    attempt(timer, s.clock, [10, 20, 30]);
    timer.reset();
    attempt(timer, s.clock, [8, 20, 30]);
    const v = timer.view();
    assert.strictEqual(v.pb, 58);
    assert.strictEqual(v.rows[2].delta, -2);
    timer.reset();
    timer.setRoute('r', NAMES);
    assert.strictEqual(timer.view().rows[2].pb, 58);
  } finally { s.done(); }
});

test('con segmentos saltados, la suma de mejores nunca pasa del PB', () => {
  const s = setup();
  try {
    const timer = s.make();
    attempt(timer, s.clock, [10, 20, 30]);
    timer.reset();
    timer.setRoute('r', NAMES);
    timer.start();
    timer.skip();
    timer.skip();
    s.clock.t += 50000;
    timer.split('C');
    const v = timer.view();
    assert.strictEqual(v.pb, 50);
    assert.strictEqual(v.sumOfBest, 50);
  } finally { s.done(); }
});

test('formato de tiempo de los .lss, con días', () => {
  assert.strictEqual(parseTime('01:02:03.5000000'), 3723.5);
  assert.strictEqual(parseTime('1.01:00:00'), 90000);
  assert.strictEqual(parseTime(formatTime(61.5)), 61.5);
});
