// Lo que cambia entre ejecutar el código fuente con Node y la aplicación de escritorio (MultiTracker.exe).
const fs = require('fs');
const path = require('path');

const IS_DESKTOP = !!process.versions.electron;
// Archivos del programa. En el .exe están dentro de su paquete (app.asar), que fs lee como una carpeta normal.
const APP_ROOT = path.join(__dirname, '..');

// Junto al .exe (o al código) están los ajustes del usuario y, si la añade, la fuente opcional.
// El .exe portable se descomprime en una carpeta temporal: PORTABLE_EXECUTABLE_DIR indica dónde está de verdad.
function baseDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (IS_DESKTOP && require('electron').app.isPackaged) return path.dirname(process.execPath);
  return APP_ROOT;
}
const BASE_DIR = baseDir();

// Lee un archivo del programa (ruta con "/"). Un archivo junto al .exe tiene prioridad sobre el incluido.
function readAsset(rel) {
  for (const dir of new Set([BASE_DIR, APP_ROOT])) {
    try { return fs.readFileSync(path.join(dir, rel)); } catch { /* se prueba el siguiente */ }
  }
  return null;
}

module.exports = { IS_DESKTOP, APP_ROOT, BASE_DIR, readAsset };
