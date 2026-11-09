// Genera dist/MultiTracker.exe (portable: un solo archivo, sin instalar nada) y el .zip para publicar.
// Uso: node build/build-exe.js 1.7.0
// Solo incluye lo que Git publicaría: lo ignorado (userdata/, la fuente Upheaval...) nunca llega al .exe.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, WORK, ELECTRON, installTools, run } = require('./tools.js');

const VERSION = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(VERSION || '')) throw new Error('Indica la versión: node build/build-exe.js 1.7.0');

const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(WORK, 'stage');
const OUT = path.join(WORK, 'out');
// Lo que necesita la aplicación en marcha. El resto del repositorio (README, scripts .bat...) no va dentro.
const APP_FILES = ['app', 'data', 'lib', 'desktop', 'tracker.js', 'paths.js', 'server.js', 'build/icon.ico', 'LICENSE'];

function stage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...APP_FILES], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(rel => rel && fs.existsSync(path.join(ROOT, rel)));
  for (const rel of tracked) {
    const to = path.join(STAGE, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), to);
  }
  fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({
    name: 'multitracker', productName: 'MultiTracker', version: VERSION,
    description: 'Item and Dead God progress tracker for The Binding of Isaac: Repentance+',
    author: 'Mafla', license: 'MIT', main: 'desktop/main.js',
  }, null, 2));
  return tracked.length;
}

function builderConfig() {
  return {
    appId: 'io.github.maflatv.multitracker',
    productName: 'MultiTracker',
    copyright: 'Copyright (c) 2026 Mafla',
    electronVersion: ELECTRON,
    // Por defecto electron-builder excluye la carpeta build/ del paquete, y ahí está el icono de las ventanas.
    directories: { app: STAGE, output: OUT, buildResources: path.join(WORK, 'resources') },
    files: ['**/*'],
    asar: true,
    npmRebuild: false,
    win: { target: [{ target: 'portable', arch: ['x64'] }], icon: path.join(STAGE, 'build', 'icon.ico') },
    portable: { artifactName: 'MultiTracker.exe' },
  };
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  installTools();
  console.log(`${stage()} archivos incluidos`);

  const configFile = path.join(WORK, 'electron-builder.json');
  fs.writeFileSync(configFile, JSON.stringify(builderConfig(), null, 2));
  run(process.execPath, [path.join(WORK, 'node_modules', 'electron-builder', 'cli.js'), '--win', '--projectDir', STAGE, '--config', configFile]);

  const exe = path.join(DIST, 'MultiTracker.exe');
  fs.copyFileSync(path.join(OUT, 'MultiTracker.exe'), exe);

  // El .exe ya lleva dentro las licencias de Electron y Chromium; el .zip las incluye también a la vista.
  const pack = path.join(WORK, 'pack');
  fs.rmSync(pack, { recursive: true, force: true });
  fs.mkdirSync(pack);
  fs.copyFileSync(exe, path.join(pack, 'MultiTracker.exe'));
  fs.copyFileSync(path.join(__dirname, 'LEEME.txt'), path.join(pack, 'LEEME.txt'));
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(pack, 'LICENSE.txt'));
  fs.copyFileSync(path.join(ROOT, 'data', 'LICENSE-RebirthItemTracker.txt'), path.join(pack, 'LICENSE-RebirthItemTracker.txt'));
  const unpacked = path.join(OUT, 'win-unpacked');
  fs.copyFileSync(path.join(unpacked, 'LICENSE.electron.txt'), path.join(pack, 'LICENSE-Electron.txt'));
  fs.copyFileSync(path.join(unpacked, 'LICENSES.chromium.html'), path.join(pack, 'LICENSES-Chromium.html'));

  const zip = path.join(DIST, `MultiTracker-${VERSION}-windows-x64.zip`);
  execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Compress-Archive -Path (Join-Path $env:PACK "*") -DestinationPath $env:ZIP -Force'], { stdio: 'inherit', env: { ...process.env, PACK: pack, ZIP: zip } });
  console.log(`Listo: ${exe}\n       ${zip}`);
}

main();
