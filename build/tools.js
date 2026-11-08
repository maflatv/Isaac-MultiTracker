// Herramientas de compilación: se instalan en .build/, fuera del repositorio. MultiTracker no tiene dependencias propias.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WORK = path.join(ROOT, '.build');
// Versiones fijas: una compilación debe dar siempre el mismo resultado.
const ELECTRON = '44.9.3';
const ELECTRON_BUILDER = '26.18.0';

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

module.exports = { ROOT, WORK, ELECTRON, ELECTRON_BUILDER, installTools, run };
