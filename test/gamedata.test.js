// Pruebas de los recursos incluidos en data/resources. Ejecutar: node --test "test/*.test.js"
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadGameData } = require('../lib/gamedata.js');
const { BUNDLED, isComplete } = require('../lib/resources.js');

test('los recursos incluidos están completos', () => {
  assert.ok(isComplete(BUNDLED));
});

// Dentro del .exe (app.asar) las rutas distinguen mayúsculas: un nombre que solo coincide sin distinguirlas no carga.
test('cada icono de objeto y trinket apunta al nombre exacto de un archivo', () => {
  const { icons } = loadGameData(BUNDLED);
  const listing = new Map();
  const missing = [];
  for (const [id, rel] of icons) {
    const dir = path.dirname(rel);
    if (!listing.has(dir)) listing.set(dir, new Set(fs.readdirSync(path.join(BUNDLED, dir))));
    if (!listing.get(dir).has(path.basename(rel))) missing.push(`${id} ${rel}`);
  }
  assert.ok(icons.size > 900, `solo ${icons.size} iconos`);
  assert.deepStrictEqual(missing, []);
});
