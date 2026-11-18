const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTracker } = require('../tracker.js');

const ROOT = path.join(__dirname, '..');
const RECOMMENDED = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'recommended-profile.json'), 'utf8'));

function setup(t, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-prof-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'data'), gameDir = path.join(dir, 'game');
  fs.mkdirSync(dataDir); fs.mkdirSync(gameDir);
  const file = path.join(dataDir, 'config.json');
  if (config !== undefined) fs.writeFileSync(file, JSON.stringify(config));
  const open = () => createTracker({ resDir: path.join(ROOT, 'data', 'resources'), gameDir, steamUserdata: path.join(dir, 'steam'), dataDir });
  const stored = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  return { open, stored, file };
}

const recommended = c => Object.entries(c.profiles || {}).filter(([, p]) => p.options && p.options.background === RECOMMENDED.options.background && p.options.removed === RECOMMENDED.options.removed);

test('instalación nueva: el perfil recomendado se añade y es también la configuración principal', t => {
  const { open, stored } = setup(t, {});
  const tr = open();
  const c = stored();
  const [[id, p]] = recommended(c);
  assert.strictEqual(p.options.font, 'Upheaval');
  assert.strictEqual(tr.config(id).options.rows, RECOMMENDED.options.rows);
  const main = tr.config();
  assert.strictEqual(main.profile, 'main');
  assert.strictEqual(main.options.rows, RECOMMENDED.options.rows);
  assert.strictEqual(main.options.gameNames, RECOMMENDED.options.gameNames);
  assert.strictEqual(main.show.winStreak, RECOMMENDED.show.winStreak);
});

test('con configuración guardada se añade a la lista sin tocar lo demás, y si se borra no vuelve', t => {
  const mine = { language: 'en', obsProfile: 'pabc', options: { layout: 'wide', fontSize: 18 }, show: { seed: false }, profiles: { pabc: { name: 'Mine', options: { iconSize: 60 } } } };
  const { open, stored, file } = setup(t, mine);
  open();
  const c = stored();
  assert.deepStrictEqual(c.options, mine.options);
  assert.deepStrictEqual(c.show, mine.show);
  assert.deepStrictEqual(c.profiles.pabc, mine.profiles.pabc);
  assert.strictEqual(c.obsProfile, 'pabc');
  assert.strictEqual(c.windowProfile, undefined);
  const [[id, p]] = recommended(c);
  assert.strictEqual(p.name, 'Recommended');
  delete c.profiles[id];
  fs.writeFileSync(file, JSON.stringify(c));
  open();
  assert.strictEqual(recommended(stored()).length, 0);
});
