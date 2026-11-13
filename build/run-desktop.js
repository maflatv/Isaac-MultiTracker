// Abre la aplicación de escritorio desde el código fuente, sin compilar el .exe. Uso: node build/run-desktop.js
// Con --avanzada abre la edición avanzada (splits de LiveSplit).
const path = require('path');
const { ROOT, WORK, installTools, run } = require('./tools.js');

installTools();
const electron = path.join(WORK, 'node_modules', 'electron', 'dist', 'electron.exe');
// Desde la terminal de VS Code, ELECTRON_RUN_AS_NODE haría que Electron arrancase como un Node normal, sin ventanas.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (process.argv.includes('--avanzada')) env.MULTITRACKER_EDITION = 'avanzada';
run(electron, [path.join(ROOT, 'desktop', 'main.js')], { cwd: ROOT, env });
