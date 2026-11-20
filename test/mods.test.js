// Objetos y personajes de mods: catálogo (lib/mods.js), lectura de la lista de mods en el log y vista del tracker.
// Las líneas del log son las que escribió la copia de pruebas (REPENTOGON) con dos mods de prueba y el personaje Mafla:
// los objetos tomaron 733-735 y los personajes 41-42 siguiendo el orden de «Enabled Mods», no el alfabético.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadModCatalog } = require('../lib/mods.js');
const { RunLog } = require('../lib/log.js');
const { createTracker } = require('../tracker.js');

const ROOT = path.join(__dirname, '..');
const PNG = fs.readFileSync(path.join(ROOT, 'data', 'resources', 'gfx', 'items', 'collectibles', 'collectibles_001_thesadonion.png'));

// Crea una carpeta mods/ con los mods dados: { carpeta: { items: '<items>…', players: '<players>…', icons: [...], dlc3 } }.
function makeMods(t, mods) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-mods-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, m] of Object.entries(mods)) {
    const content = path.join(dir, name, m.dlc3 ? 'content-dlc3' : 'content');
    fs.mkdirSync(content, { recursive: true });
    if (m.items) fs.writeFileSync(path.join(content, 'items.xml'), m.items);
    if (m.players) fs.writeFileSync(path.join(content, 'players.xml'), m.players);
    for (const icon of m.icons || []) {
      const f = path.join(dir, name, m.dlc3 ? 'resources-dlc3' : 'resources', icon);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, PNG);
    }
  }
  // Como las escribe el log: en minúsculas y con barras normales.
  const logDir = name => path.join(dir, name).replace(/\\/g, '/').toLowerCase();
  return { dir, logDir };
}

const MODS = {
  aa_items: {
    items: `<items gfxroot="gfx/items/" version="1">
  <passive name="MT Pasivo" description="Pasivo de prueba" gfx="MT_Pasivo.png" />
  <active name="MT Activo" description="Activo de prueba" gfx="mt_activo.png" />
  <passive id="1" name="#THE_SAD_ONION_NAME" gfx="x.png" />
  <trinket name="MT Trinket" gfx="mt_trinket.png" />
</items>`,
    icons: ['gfx/items/collectibles/mt_pasivo.png', 'gfx/items/collectibles/mt_activo.png', 'gfx/items/trinkets/mt_trinket.png'],
  },
  zz_items: {
    items: '<items gfxroot="gfx/items/"><passive name="MT B" gfx="mt_b.png" /></items>',
    players: '<players><player name="MT Pj" skin="a.png" /><player name="MT Pj" skin="b.png" bskinparent="MT Pj" /></players>',
    icons: ['gfx/items/collectibles/mt_b.png'],
    dlc3: true,
  },
  mafla_character: { players: '<players><player name="Mafla" skin="character_mafla.png" /></players>' },
};

test('catálogo: números por el orden dado, sin las entradas que cambian objetos del juego', t => {
  const { logDir } = makeMods(t, MODS);
  const c = loadModCatalog(['aa_items', 'zz_items', 'mafla_character'].map(logDir));
  assert.deepStrictEqual([...c.items.values()].map(e => [e.id, e.name]), [[733, 'MT Pasivo'], [734, 'MT Activo'], [2190, 'MT Trinket'], [735, 'MT B']]);
  assert.deepStrictEqual([...c.players].map(([id, p]) => [id, p.name]), [[41, 'MT Pj'], [42, 'T. MT Pj'], [43, 'Mafla']]);
  assert.deepStrictEqual([...c.actives], [734]);
  // El icono se encuentra aunque el xml no use las mismas mayúsculas, también en resources-dlc3.
  assert.ok(c.items.get(733).icon && fs.existsSync(c.items.get(733).icon));
  assert.ok(c.items.get(735).icon.includes('resources-dlc3'));
  assert.ok(c.items.get(2190).icon.includes('trinkets'));
  assert.strictEqual(c.items.get(733).desc, 'Pasivo de prueba');
});

test('catálogo: si el nombre del log no coincide con el número (otro orden), manda el nombre', t => {
  const { logDir } = makeMods(t, MODS);
  const c = loadModCatalog(['zz_items', 'aa_items'].map(logDir));
  assert.strictEqual(c.resolve(733, 'MT B').name, 'MT B');
  assert.strictEqual(c.resolve(733, 'MT Pasivo').name, 'MT Pasivo');
  assert.strictEqual(c.resolve(733).name, 'MT B');
  assert.strictEqual(c.resolve(733, 'No existe'), null);
});

// Líneas reales del arranque del juego con mods (las de la lista no llevan prefijo).
const bootLines = (logDir, folders) => [
  '[INFO] - begin list mods',
  ...folders.flatMap(f => [`[INFO] - Loading: ${f}(${f}) `, `[INFO] - LOADED MOD ${logDir(f)}/content/`]),
  '[INFO] - -- Enabled Mods START -- ',
  ...folders.slice().reverse(),
  '[INFO] - -- Enabled Mods END -- ',
];

test('log: la partida guarda los mods activos en su orden y el nombre del personaje de mod', t => {
  const { logDir } = makeMods(t, MODS);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'log.txt');
  fs.writeFileSync(file, [
    ...bootLines(logDir, ['aa_items', 'mafla_character', 'zz_items']),
    '[INFO] - RNG Start Seed: B91Y 9THH (12345) [New, 0]',
    '[INFO] - [Frame: 0] Initialized player with Variant 0 and Subtype 42',
    '[INFO] - Adding collectible 265 (Dry Baby) to player 0 (Mafla) from pool treasure',
    '',
  ].join('\r\n'));
  const log = new RunLog(file);
  log.poll();
  assert.deepStrictEqual(log.run.mods, ['zz_items', 'mafla_character', 'aa_items'].map(logDir));
  assert.strictEqual(log.run.character, 42);
  assert.strictEqual(log.run.charName, 'Mafla');
  // Al reabrir el tracker a mitad de sesión se conservan para la siguiente partida.
  const again = new RunLog(file, log.snapshot());
  assert.deepStrictEqual(again.mods, log.mods);
});

test('tracker: objetos de mods con nombre, icono, descripción y activo; personaje de mod con nombre', async t => {
  const { logDir } = makeMods(t, MODS);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-trk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'data'), gameDir = path.join(dir, 'game');
  fs.mkdirSync(dataDir); fs.mkdirSync(gameDir);
  fs.writeFileSync(path.join(gameDir, 'log.txt'), [
    ...bootLines(logDir, ['zz_items', 'mafla_character', 'aa_items']), // activos: aa_items, mafla_character, zz_items
    '[INFO] - RNG Start Seed: B91Y 9THH (12345) [New, 0]',
    '[INFO] - [Frame: 0] Initialized player with Variant 0 and Subtype 41',
    '[INFO] - Level::Init m_Stage 1, m_StageType 0 Seed 1',
    '[INFO] - Room 1.2(Start Room)',
    '[INFO] - item queue flush',
    '[INFO] - Adding collectible 733 (MT Pasivo) to player 0 (Mafla) from pool treasure',
    '[INFO] - item queue flush',
    '[INFO] - Adding collectible 734 (MT Activo) to player 0 (Mafla) from pool treasure',
    '[INFO] - item queue flush',
    '[INFO] - Adding collectible 735 (MT B) to player 0 (Mafla) from pool treasure',
    // Un activo del mod que se vuelve a coger (tras soltarlo) no se repite.
    '[INFO] - item queue flush',
    '[INFO] - Adding collectible 734 (MT Activo) to player 0 (Mafla) from pool treasure',
    '',
  ].join('\n'));
  const tr = createTracker({ resDir: path.join(ROOT, 'data', 'resources'), gameDir, steamUserdata: path.join(dir, 'steam'), dataDir });
  const res = await tr.respond({ method: 'GET', pathname: '/api/state' });
  const { run } = JSON.parse(res.body);
  assert.strictEqual(run.character, 'Mafla');
  assert.deepStrictEqual(run.items.map(i => i.name), ['MT Pasivo', 'MT Activo', 'MT B']);
  assert.strictEqual(run.items[0].desc, 'Pasivo de prueba');
  for (const i of run.items) {
    assert.match(i.icon, /^icon\/mod\/[0-9a-f]{12}\/\d+\.png$/);
    const img = await tr.respond({ method: 'GET', pathname: '/' + i.icon });
    assert.strictEqual(img.status, 200);
    assert.strictEqual(img.type, 'image/png');
  }
  const bad = await tr.respond({ method: 'GET', pathname: '/icon/mod/000000000000/0.png' });
  assert.strictEqual(bad.status, 404);
});

test('tracker: antes de coger nada, el personaje de mod se nombra por el orden de los mods', async t => {
  const { logDir } = makeMods(t, MODS);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-trk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'data'), gameDir = path.join(dir, 'game');
  fs.mkdirSync(dataDir); fs.mkdirSync(gameDir);
  fs.writeFileSync(path.join(gameDir, 'log.txt'), [
    ...bootLines(logDir, ['zz_items', 'mafla_character', 'aa_items']),
    '[INFO] - RNG Start Seed: B91Y 9THH (12345) [New, 0]',
    '[INFO] - [Frame: 0] Initialized player with Variant 0 and Subtype 43',
    '',
  ].join('\n'));
  const tr = createTracker({ resDir: path.join(ROOT, 'data', 'resources'), gameDir, steamUserdata: path.join(dir, 'steam'), dataDir });
  const { run } = JSON.parse((await tr.respond({ method: 'GET', pathname: '/api/state' })).body);
  assert.strictEqual(run.character, 'T. MT Pj');
});
