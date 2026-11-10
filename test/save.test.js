// Pruebas del lector de rep+persistentgamedataN.dat con guardados construidos a mano. Ejecutar: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { parseSave, summarize, SaveError } = require('../lib/save.js');

// Guardado mínimo: cabecera y los bloques que se leen (logros, contadores, objetos vistos y desafíos).
// Cada bloque: tipo, tamaño (sin usar), número de elementos y los datos. Contadores de 4 bytes, el resto de 1.
function buildSave({ achievements = 641, counters = 500, collectibles = 733, challenges = 46, set = {} } = {}) {
  const parts = [Buffer.alloc(0x14)];
  parts[0].write('ISAACNGSAVE', 0, 'latin1');
  const block = (type, count, size, values = {}) => {
    const head = Buffer.alloc(12);
    head.writeInt32LE(type, 0);
    head.writeInt32LE(count * size, 4);
    head.writeInt32LE(count, 8);
    const body = Buffer.alloc(count * size);
    for (const [i, v] of Object.entries(values)) size === 4 ? body.writeInt32LE(v, i * 4) : (body[i] = v);
    parts.push(head, body);
  };
  block(1, achievements, 1, set.achievements);
  block(2, counters, 4, set.counters);
  block(4, collectibles, 1, set.collectibles);
  block(7, challenges, 1, set.challenges);
  return Buffer.concat(parts);
}

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
