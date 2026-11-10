// Herramientas de compilación: se instalan en .build/, fuera del repositorio. El código de MultiTracker no tiene
// dependencias; solo la versión instalada lleva electron-updater dentro, para actualizarse sola.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WORK = path.join(ROOT, '.build');
// Versiones fijas: una compilación debe dar siempre el mismo resultado.
const ELECTRON = '44.9.3';
const ELECTRON_BUILDER = '26.18.0';
const ELECTRON_UPDATER = '6.8.12';
// electron-updater y sus dependencias, aparte de las herramientas: esta carpeta node_modules va dentro del programa.
const RUNTIME = path.join(WORK, 'runtime');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: WORK, ...opts });

function installed(name, version) {
  try { return JSON.parse(fs.readFileSync(path.join(WORK, 'node_modules', name, 'package.json'), 'utf8')).version === version; } catch { return false; }
}

function installTools() {
  fs.mkdirSync(WORK, { recursive: true });
  if (!installed('electron', ELECTRON) || !installed('electron-builder', ELECTRON_BUILDER)) {
    // Un package.json propio evita que npm busque uno en carpetas superiores.
    fs.writeFileSync(path.join(WORK, 'package.json'), JSON.stringify({ name: 'multitracker-build', private: true }, null, 2));
    run('npm', ['install', '--no-save', '--no-audit', '--no-fund', `electron@${ELECTRON}`, `electron-builder@${ELECTRON_BUILDER}`], { shell: true });
  }
  // npm no siempre ejecuta el script que descarga Electron: se lanza aquí si falta el programa.
  if (!fs.existsSync(path.join(WORK, 'node_modules', 'electron', 'dist', 'electron.exe'))) {
    run(process.execPath, [path.join(WORK, 'node_modules', 'electron', 'install.js')]);
  }
}

function installRuntime() {
  const pkg = path.join(RUNTIME, 'node_modules', 'electron-updater', 'package.json');
  try { if (JSON.parse(fs.readFileSync(pkg, 'utf8')).version === ELECTRON_UPDATER) return RUNTIME; } catch { /* hay que instalarlo */ }
  fs.rmSync(RUNTIME, { recursive: true, force: true });
  fs.mkdirSync(RUNTIME, { recursive: true });
  fs.writeFileSync(path.join(RUNTIME, 'package.json'), JSON.stringify({ name: 'multitracker-runtime', private: true }, null, 2));
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--save-exact', `electron-updater@${ELECTRON_UPDATER}`], { shell: true, cwd: RUNTIME });
  return RUNTIME;
}

module.exports = { ROOT, WORK, ELECTRON, ELECTRON_BUILDER, ELECTRON_UPDATER, installTools, installRuntime, run };
