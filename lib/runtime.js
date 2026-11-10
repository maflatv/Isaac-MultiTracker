// Lo que cambia entre ejecutar el código fuente con Node, el .exe portable y la versión instalada.
const fs = require('fs');
const path = require('path');

const IS_DESKTOP = !!process.versions.electron;
// Archivos del programa. En el .exe están dentro de su paquete (app.asar), que fs lee como una carpeta normal.
const APP_ROOT = path.join(__dirname, '..');
// El .exe portable se descomprime en una carpeta temporal: PORTABLE_EXECUTABLE_DIR indica dónde está de verdad.
const IS_PORTABLE = !!process.env.PORTABLE_EXECUTABLE_DIR;
// Instalada con el instalador: es la única que se actualiza sola.
const IS_INSTALLED = IS_DESKTOP && !IS_PORTABLE && require('electron').app.isPackaged;

// Dónde están los ajustes del usuario (userdata/, multitracker.config.json) y, si la añade, la fuente opcional:
// - Portable: junto al .exe, para llevarlo todo en una carpeta.
// - Instalada: en %APPDATA%\MultiTracker. La carpeta del programa la reemplazan las actualizaciones y la borra el
//   desinstalador; los ajustes no deben ir ahí.
// - Código fuente: en la carpeta del proyecto.
function baseDir() {
  if (IS_PORTABLE) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (IS_INSTALLED) return path.join(require('electron').app.getPath('appData'), 'MultiTracker');
  return APP_ROOT;
}
const BASE_DIR = baseDir();

// Lee un archivo del programa (ruta con "/"). Uno en BASE_DIR tiene prioridad sobre el incluido.
function readAsset(rel) {
  for (const dir of new Set([BASE_DIR, APP_ROOT])) {
    try { return fs.readFileSync(path.join(dir, rel)); } catch { /* se prueba el siguiente */ }
  }
  return null;
}

module.exports = { IS_DESKTOP, IS_PORTABLE, IS_INSTALLED, APP_ROOT, BASE_DIR, readAsset };
