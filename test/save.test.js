// Pruebas del lector de rep+persistentgamedataN.dat con guardados construidos a mano. Ejecutar: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { parseSave, summarize, SaveError } = require('../lib/save.js');

const { buildSave } = require('./build-save.js');

test('cuenta logros, objetos vistos, racha y Dead God', () => {
  const buf = buildSave({ set: { achievements: { 1: 1, 2: 1, 637: 1 }, counters: { 22: 3, 23: 7 }, collectibles: { 1: 1, 5: 1 } } });
  const s = summarize(parseSave(buf), [1, 2, 5]);
  assert.deepStrictEqual(s.achievements, { done: 3, total: 640 });
  assert.deepStrictEqual(s.items, { done: 2, total: 3 });
  assert.strictEqual(s.winStreak, 3);
  assert.strictEqual(s.bestStreak, 7);
  assert.strictEqual(s.deadGod, true);
  assert.strictEqual(s.complete, false);
});

test('las marcas cuentan como difíciles desde el nivel 2', () => {
  const s = summarize(parseSave(buildSave({ set: { counters: { 27: 1, 41: 2, 55: 3 } } })), []);
  assert.strictEqual(s.marksAny.done, 3);
  assert.strictEqual(s.marksHard.done, 2);
});

test('un archivo que no es un guardado de Isaac se rechaza', () => {
  assert.throws(() => parseSave(Buffer.from('no es un guardado')), e => e instanceof SaveError && e.message === 'err.notIsaacSave');
});

test('un guardado cortado (el juego lo está escribiendo) se rechaza sin romper nada', () => {
  const buf = buildSave();
  assert.throws(() => parseSave(buf.subarray(0, buf.length - 100)), e => e instanceof SaveError && e.message === 'err.incompleteSave');
  assert.throws(() => parseSave(buf.subarray(0, 0x20)), e => e instanceof SaveError);
});
