// Genera en dist/ las dos formas de MultiTracker para Windows:
// - MultiTracker-Setup-<versión>.exe: instalador. La versión instalada se actualiza sola desde las releases de GitHub
//   y descarga solo lo que cambia gracias al .blockmap; latest.yml le dice cuál es la última versión.
// - MultiTracker.exe: portable, un solo archivo sin instalar nada. También va en el .zip, con las licencias a la vista.
// Uso: node build/build-exe.js 1.9.1. Los cinco archivos de dist/ van en la release v1.9.0 de GitHub.
// Solo incluye lo que Git publicaría: lo ignorado (userdata/, la fuente Upheaval...) nunca llega al programa.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, WORK, ELECTRON, ELECTRON_UPDATER, installTools, installRuntime, run } = require('./tools.js');

const VERSION = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(VERSION || '')) throw new Error('Indica la versión: node build/build-exe.js 1.9.1');
const REPO = { owner: 'maflatv', repo: 'Isaac-MultiTracker' };

const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(WORK, 'stage');
const OUT = path.join(WORK, 'out');
// Lo que necesita la aplicación en marcha. El resto del repositorio (README, pruebas, scripts .bat...) no va dentro.
const APP_FILES = ['app', 'data', 'lib', 'desktop', 'tracker.js', 'paths.js', 'server.js', 'build/icon.ico', 'LICENSE'];
const SETUP = `MultiTracker-Setup-${VERSION}.exe`;
const ZIP = `MultiTracker-${VERSION}-windows-x64.zip`;

function stage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...APP_FILES], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(rel => rel && fs.existsSync(path.join(ROOT, rel)));
  for (const rel of tracked) {
    const to = path.join(STAGE, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), to);
  }
  // electron-updater, para que la versión instalada se actualice. El portable lo lleva también, pero no lo usa.
  fs.cpSync(path.join(installRuntime(), 'node_modules'), path.join(STAGE, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({
    name: 'multitracker', productName: 'MultiTracker', version: VERSION,
    description: 'Item and Dead God progress tracker for The Binding of Isaac: Repentance+',
    author: 'Mafla', license: 'MIT', main: 'desktop/main.js',
    dependencies: { 'electron-updater': ELECTRON_UPDATER },
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
    win: { target: [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }], icon: path.join(STAGE, 'build', 'icon.ico') },
    // Instalador para el usuario, sin permisos de administrador. Se puede elegir la carpeta. Desinstalar no borra los
    // ajustes (%APPDATA%\MultiTracker). En el idioma de Windows, entre los cinco de MultiTracker.
    nsis: {
      oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'MultiTracker',
      deleteAppDataOnUninstall: false, artifactName: SETUP,
      multiLanguageInstaller: true, installerLanguages: ['en_US', 'es_ES', 'fr_FR', 'pt_BR', 'ru_RU'],
    },
    portable: { artifactName: 'MultiTracker.exe' },
    // De aquí lee la versión instalada dónde buscar actualizaciones (app-update.yml). Esto no publica nada.
    publish: [{ provider: 'github', owner: REPO.owner, repo: REPO.repo }],
  };
}

async function main() {
  // Se vacía dist/ salvo userdata/: los ajustes de quien prueba el portable desde ahí.
  fs.mkdirSync(DIST, { recursive: true });
  for (const f of fs.readdirSync(DIST)) if (f !== 'userdata') fs.rmSync(path.join(DIST, f), { recursive: true, force: true });
  fs.rmSync(OUT, { recursive: true, force: true });
  installTools();
  console.log(`${stage()} archivos incluidos`);

  const configFile = path.join(WORK, 'electron-builder.json');
  fs.writeFileSync(configFile, JSON.stringify(builderConfig(), null, 2));
  run(process.execPath, [path.join(WORK, 'node_modules', 'electron-builder', 'cli.js'), '--win', '--projectDir', STAGE, '--config', configFile, '--publish', 'never']);

  for (const f of ['MultiTracker.exe', SETUP, `${SETUP}.blockmap`, 'latest.yml']) fs.copyFileSync(path.join(OUT, f), path.join(DIST, f));

  // El .exe ya lleva dentro las licencias de Electron y Chromium; el .zip las incluye también a la vista.
  const pack = path.join(WORK, 'pack');
  fs.rmSync(pack, { recursive: true, force: true });
  fs.mkdirSync(pack);
  fs.copyFileSync(path.join(DIST, 'MultiTracker.exe'), path.join(pack, 'MultiTracker.exe'));
  fs.copyFileSync(path.join(__dirname, 'LEEME.txt'), path.join(pack, 'LEEME.txt'));
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(pack, 'LICENSE.txt'));
  fs.copyFileSync(path.join(ROOT, 'data', 'LICENSE-RebirthItemTracker.txt'), path.join(pack, 'LICENSE-RebirthItemTracker.txt'));
  const unpacked = path.join(OUT, 'win-unpacked');
  fs.copyFileSync(path.join(unpacked, 'LICENSE.electron.txt'), path.join(pack, 'LICENSE-Electron.txt'));
  fs.copyFileSync(path.join(unpacked, 'LICENSES.chromium.html'), path.join(pack, 'LICENSES-Chromium.html'));
  const zip = path.join(DIST, ZIP);
  execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Compress-Archive -Path (Join-Path $env:PACK "*") -DestinationPath $env:ZIP -Force'], { stdio: 'inherit', env: { ...process.env, PACK: pack, ZIP: zip } });

  console.log(`Listo en ${DIST}:`);
  for (const f of fs.readdirSync(DIST).filter(f => fs.statSync(path.join(DIST, f)).isFile())) console.log(`  ${f}`);
  console.log(`Estos cinco archivos van en la release v${VERSION} (latest.yml es imprescindible).`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
