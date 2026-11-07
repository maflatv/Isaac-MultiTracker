// Localiza el juego en el PC de cada usuario. multitracker.config.json tiene prioridad sobre lo detectado.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readJson } = require('./lib/http.js');

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

function findResources(steam) {
  for (const lib of steamLibraries(steam)) {
    const dir = path.join(lib, GAME_FOLDER, 'extracted_resources', 'resources');
    if (fs.existsSync(path.join(dir, 'items.xml'))) return dir;
  }
  return null;
}

function findSaveDir() {
  const home = process.env.USERPROFILE || '';
  const oneDrive = process.env.OneDrive || path.join(home, 'OneDrive');
  const candidates = [path.join(home, 'Documents'), path.join(oneDrive, 'Documents'), path.join(oneDrive, 'Documentos')].map(d => path.join(d, SAVE_FOLDER));
  return candidates.find(d => fs.existsSync(d)) || candidates[0];
}

function resolvePaths(baseDir) {
  const own = readJson(path.join(baseDir, 'multitracker.config.json'), {});
  const steam = steamDir();
  const resDir = own.resourcesDir || findResources(steam);
  return {
    // Rutas normalizadas: safeJoin compara prefijos y en el archivo pueden venir con "/".
    resDir: resDir && path.resolve(resDir),
    gameDir: path.resolve(own.gameDir || findSaveDir()),
    steamUserdata: path.resolve(own.steamUserdata || path.join(steam, 'userdata')),
    dataDir: path.join(baseDir, 'userdata'),
  };
}

module.exports = { resolvePaths };
