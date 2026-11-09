// Localiza el juego en el PC de cada usuario. multitracker.config.json tiene prioridad sobre lo detectado.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readJson } = require('./lib/http.js');
const { isComplete } = require('./lib/resources.js');

const GAME_FOLDER = path.join('steamapps', 'common', 'The Binding of Isaac Rebirth');
const SAVE_FOLDER = path.join('My Games', 'Binding of Isaac Repentance+');
const DEFAULT_STEAM = 'C:/Program Files (x86)/Steam';

function steamDir() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
    if (m) return m[1].trim();
  } catch { /* Steam no está en el registro */ }
  return DEFAULT_STEAM;
}

// El juego puede estar en cualquier biblioteca de Steam, no solo en la principal.
function steamLibraries(steam) {
  try {
    const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    const found = [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map(m => m[1].replace(/\\\\/g, '\\'));
    return [steam, ...found];
  } catch { return [steam]; }
}

// Carpeta donde está instalado el juego (la que tiene tools/ResourceExtractor), en cualquier biblioteca de Steam.
function findIsaac(steam) {
  const dirs = steamLibraries(steam).map(lib => path.join(lib, GAME_FOLDER));
  return dirs.find(d => fs.existsSync(path.join(d, 'tools', 'ResourceExtractor', 'ResourceExtractor.exe')))
    || dirs.find(d => fs.existsSync(d)) || null;
}

function findSaveDir() {
  const home = process.env.USERPROFILE || '';
  const oneDrive = process.env.OneDrive || path.join(home, 'OneDrive');
  const candidates = [path.join(home, 'Documents'), path.join(oneDrive, 'Documents'), path.join(oneDrive, 'Documentos')].map(d => path.join(d, SAVE_FOLDER));
  return candidates.find(d => fs.existsSync(d)) || candidates[0];
}

// Cuenta de Steam con la sesión abierta (el número de su carpeta en userdata), o null si Steam no está abierto.
function activeSteamAccount() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam\\ActiveProcess', '/v', 'ActiveUser'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const m = /ActiveUser\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out);
    const id = m ? parseInt(m[1], 16) : 0;
    return id ? String(id) : null;
  } catch { return null; }
}

// Recursos del juego, por orden: la carpeta indicada en multitracker.config.json, la copia propia de MultiTracker
// (userdata/resources, la que se crea al extraerlos) y la que deja el ResourceExtractor en la carpeta del juego.
// Solo vale una carpeta completa. Si ninguna lo está, resDir es null y hay que extraerlos en ownResDir.
function resolvePaths(baseDir) {
  const own = readJson(path.join(baseDir, 'multitracker.config.json'), {});
  const steam = steamDir();
  const dataDir = path.join(baseDir, 'userdata');
  const isaacDir = own.isaacDir || findIsaac(steam);
  const ownResDir = path.join(dataDir, 'resources');
  const candidates = [own.resourcesDir, ownResDir, isaacDir && path.join(isaacDir, 'extracted_resources', 'resources')];
  const resDir = candidates.find(d => d && isComplete(d));
  return {
    // Rutas normalizadas: safeJoin compara prefijos y en el archivo pueden venir con "/".
    resDir: resDir ? path.resolve(resDir) : null,
    ownResDir,
    isaacDir: isaacDir && path.resolve(isaacDir),
    gameDir: path.resolve(own.gameDir || findSaveDir()),
    steamUserdata: path.resolve(own.steamUserdata || path.join(steam, 'userdata')),
    dataDir,
  };
}

module.exports = { resolvePaths, activeSteamAccount };
