// .lss completos (lib/lss.js): leer todo lo de LiveSplit y volver a escribirlo sin perder nada.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../lib/lss.js');

const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'livesplit-completo.lss'), 'utf8');

test('.lss: se lee todo (intentos, historial, comparaciones, iconos y ajustes)', () => {
  const run = L.parseLss(SAMPLE);
  assert.strictEqual(run.game, 'The Binding of Isaac: Repentance+');
  assert.strictEqual(run.offset, '-00:00:01.5000000');
  assert.strictEqual(run.attemptCount, 7);
  assert.deepStrictEqual(run.attempts.map(a => [a.id, a.r, a.g, a.pause]), [[1, null, null, null], [2, 10800, 10200, 600]]);
  assert.strictEqual(run.attempts[1].started, '01/06/2026 18:00:00');
  assert.deepStrictEqual(run.segments.map(s => s.name), ['-2. High Brow', '{Final} DEAD GOD']);
  assert.deepStrictEqual(run.segments[0].pb, { r: 3600, g: 3300 });
  assert.deepStrictEqual(run.segments[0].best, { r: 3480, g: 3240 });
  assert.deepStrictEqual(run.segments[0].history.map(h => [h.id, h.r, h.g]), [[1, 3480, 3240], [2, 3600, 3300], [-3, 5400, null]]);
  assert.deepStrictEqual(run.comparisons, ['Mi carrera & amigos']);
  assert.deepStrictEqual(run.segments[0].splits['Mi carrera & amigos'], { r: 4200, g: null });
  assert.match(run.segments[0].icon, /CDATA\[iVBOR/);
  assert.match(run.raw.autoSplitter, /split_on_boss/);
  assert.match(run.raw.metadata, /abc123/);
  assert.strictEqual(L.methodOf(run), 'g');
});

test('.lss: escrito y vuelto a leer queda igual', () => {
  const run = L.parseLss(SAMPLE);
  const again = L.parseLss(L.buildLss(run));
  assert.deepStrictEqual(again, run);
});

test('.lss: el bloque <MultiTracker> va y vuelve, aunque lleve "]]>"', () => {
  const run = L.parseLss(SAMPLE);
  run.block = { segments: [{ name: 'a]]>b', conds: [{ t: 'ach', id: 1 }], sure: true }] };
  assert.deepStrictEqual(L.parseLss(L.buildLss(run)).block, run.block);
});

test('.lss: un archivo que no es de LiveSplit no se acepta', () => {
  assert.throws(() => L.parseLss('<xml/>'), /err.lss/);
  assert.throws(() => L.parseLss('<Run><Segments></Segments></Run>'), /err.lss/);
  assert.throws(() => L.parseLss('<Run><Segments><Segment>'), /err.lss/);
});

test('.lss anteriores a la 1.6: el tiempo como texto es Real Time', () => {
  const old = '<Run><Segments><Segment><Name>A</Name><SplitTimes><SplitTime name="Personal Best">00:01:00</SplitTime></SplitTimes><BestSegmentTime>00:00:50</BestSegmentTime></Segment></Segments></Run>';
  const run = L.parseLss(old);
  assert.deepStrictEqual(run.segments[0].pb, { r: 60, g: null });
  assert.deepStrictEqual(run.segments[0].best, { r: 50, g: null });
});
