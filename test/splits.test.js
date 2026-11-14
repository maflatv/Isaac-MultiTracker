// Pruebas de las rutas de splits (edición avanzada): nombres → condiciones, guardado → segmentos y archivos .lss.
const test = require('node:test');
const assert = require('node:assert');
const S = require('../lib/splits.js');
const { parseSave } = require('../lib/save.js');
const { buildSave } = require('./build-save.js');

const marks = conds => conds.filter(c => c.t === 'mark').map(c => `${S.characterLabel(c.row)}:${S.BOSSES[c.col]}${c.min}`);
const ACHIEVEMENTS = new Map([['magdalene', 1], ['bethany', 404], ['the forgotten', 390]]);
const find = w => ACHIEVEMENTS.get(w.toLowerCase()) || ACHIEVEMENTS.get('the ' + w.toLowerCase()) || null;

test('retos, Dead God, Mom\'s Heart, muertes y colección por su nombre', () => {
  assert.deepStrictEqual(S.guessConditions('3. Head Trauma'), { conds: [{ t: 'challenge', id: 3 }], sure: true });
  assert.deepStrictEqual(S.guessConditions('* 13. Beans!'), { conds: [{ t: 'challenge', id: 13 }], sure: true });
  assert.deepStrictEqual(S.guessConditions('DEAD GOD').conds, [{ t: 'ach', id: 637 }]);
  assert.deepStrictEqual(S.guessConditions("Mom's Heart 7").conds, [{ t: 'counter', id: 1, min: 7 }]);
  assert.deepStrictEqual(S.guessConditions('100 deaths').conds, [{ t: 'counter', id: 10, min: 100 }]);
  assert.deepStrictEqual(S.guessConditions('Full collection').conds, [{ t: 'collection' }]);
  assert.deepStrictEqual(S.guessConditions('First mom').conds, [{ t: 'ach', id: 4 }]);
});

test('marcas de un personaje: jefes sueltos, All y exclusiones', () => {
  assert.deepStrictEqual(marks(S.guessConditions('Eve - Chest, Lamb, Beast').conds), ['Eve:bluebaby1', 'Eve:lamb1', 'Eve:beast1']);
  const all = S.guessConditions('T.Lilith - All, no greed');
  assert.strictEqual(all.sure, true);
  assert.strictEqual(all.conds.length, 11);
  assert.ok(!marks(all.conds).some(m => m.includes('greed')));
  assert.ok(marks(all.conds).every(m => m.startsWith('T. Lilith:') && m.endsWith('2')));
  // «no Greedier»: Greed basta en normal.
  assert.ok(marks(S.guessConditions('T.Cain - All, no Greedier').conds).includes('T. Cain:greed1'));
  assert.deepStrictEqual(marks(S.guessConditions('Isaac - Greedier no reset?').conds), ['Isaac:greed2']);
  assert.deepStrictEqual(marks(S.guessConditions('J&E - Greed').conds), ['Jacob & Esau:greed1']);
  assert.deepStrictEqual(marks(S.guessConditions('BB- Beast').conds), ['???:beast1']);
});

test('desbloqueos nombrados en la ruta se buscan como logros', () => {
  assert.deepStrictEqual(S.guessConditions('Lazarus - Bethany, Lamb noBR', find), { conds: [{ t: 'ach', id: 404 }, { t: 'mark', row: 8, col: 5, min: 1 }], sure: true });
  assert.deepStrictEqual(S.guessConditions('Azazel - Greed unlock maggy', find).conds, [{ t: 'ach', id: 1 }, { t: 'mark', row: 7, col: 7, min: 1 }]);
  // Sin la búsqueda, queda para revisar.
  assert.strictEqual(S.guessConditions('Lazarus - Bethany, Lamb noBR').sure, false);
  assert.deepStrictEqual(S.guessConditions('Lost - Ace of Spades', find), { conds: [], sure: false });
});

test('un segmento se cierra cuando se cumplen todas sus condiciones', () => {
  const seg = { conds: [{ t: 'challenge', id: 2 }, { t: 'mark', row: 0, col: 5, min: 2 }, { t: 'counter', id: 1, min: 3 }] };
  const facts = set => S.saveFacts(parseSave(buildSave({ set })), [1, 2]);
  assert.strictEqual(S.segmentDone(seg, facts({ challenges: { 2: 1 }, counters: { 97: 1, 1: 3 } })), false, 'Lamb solo en normal');
  assert.strictEqual(S.segmentDone(seg, facts({ challenges: { 2: 1 }, counters: { 97: 2, 1: 3 } })), true);
  assert.strictEqual(S.segmentDone({ conds: [] }, facts({})), false, 'sin condiciones nunca se cierra solo');
  assert.strictEqual(S.segmentDone({ conds: [{ t: 'collection' }] }, facts({ collectibles: { 1: 1, 2: 1 } })), true);
  assert.strictEqual(S.segmentDone({ conds: [{ t: 'achCount', min: 2 }] }, facts({ achievements: { 5: 1, 6: 1 } })), true);
});

test('rutas generadas: por personaje, por bloques, por tipo y por partida', () => {
  const chars = S.routeByCharacter();
  assert.strictEqual(chars.length, 35);
  assert.strictEqual(chars[33].name, 'T. Jacob & Esau');
  assert.strictEqual(chars[0].conds.length, 12);
  assert.strictEqual(chars[34].name, 'DEAD GOD');
  assert.deepStrictEqual(S.routeByBlocks(64, 641).map(s => s.name).slice(0, 2), ['64 / 641', '128 / 641']);
  assert.strictEqual(S.routeByBlocks(64, 641).length, 11);
  assert.strictEqual(S.routeByType(45)[0].conds.length, 45);
  assert.strictEqual(S.routeByRuns(10).length, 11);
});

test('capítulos: los pisos 1-8 de dos en dos y el resto cada uno el suyo', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13].map(S.chapterOf), [1, 1, 2, 2, 4, 4, 5, 6, 7, 8, 9]);
});

test('.lss: se leen los segmentos y se escribe uno que vuelve a leerse igual', () => {
  const text = S.writeLss({ game: 'Isaac & co', category: 'DeadGod%', segments: ['1. Pitch Black', 'T.Lilith - All, no greed', 'A <b> "c"'] });
  const back = S.readLss(text);
  assert.deepStrictEqual(back, { game: 'Isaac & co', category: 'DeadGod%', segments: ['1. Pitch Black', 'T.Lilith - All, no greed', 'A <b> "c"'] });
  assert.throws(() => S.readLss('<xml/>'));
});

test('solo se aceptan condiciones conocidas y con valores válidos', () => {
  assert.deepStrictEqual(S.cleanCondition({ t: 'mark', row: 3, col: 11, min: 2, x: 1 }), { t: 'mark', row: 3, col: 11, min: 2 });
  assert.strictEqual(S.cleanCondition({ t: 'mark', row: 99, col: 0, min: 1 }), null);
  assert.strictEqual(S.cleanCondition({ t: 'eval', id: 1 }), null);
  assert.strictEqual(S.cleanCondition({ t: 'ach', id: '5' }), null);
});
