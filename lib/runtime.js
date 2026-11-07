// Lo que cambia entre ejecutar el código fuente y MultiTracker.exe.
const fs = require('fs');
const path = require('path');
const sea = require('node:sea');

const IS_EXE = sea.isSea();
// Junto al .exe (o al código) están los ajustes del usuario y, si la añade, la fuente opcional.
const BASE_DIR = IS_EXE ? path.dirname(process.execPath) : path.join(__dirname, '..');

// Lee un archivo del programa (ruta con "/"). Un archivo en disco tiene prioridad sobre el incluido en el .exe.
function readAsset(rel) {
  try { return fs.readFileSync(path.join(BASE_DIR, rel)); } catch { /* se busca dentro del .exe */ }
  if (IS_EXE && sea.getAssetKeys().includes(rel)) return Buffer.from(sea.getRawAsset(rel));
  return null;
}

module.exports = { IS_EXE, BASE_DIR, readAsset };
