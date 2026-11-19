// Localiza el juego en el PC de cada usuario. multitracker.config.json tiene prioridad sobre lo detectado.
// En Linux (y Steam Deck) el juego corre con Proton: cree que está en Windows y guarda log.txt y las partidas locales
// en el disco C de su prefijo, dentro de steamapps/compatdata/250900. La nube sigue en Steam/userdata, como en Windows.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { readJson } = require('./lib/http.js');
const { BUNDLED, isComplete } = require('./lib/resources.js');

const IS_WINDOWS = process.platform === 'win32';
const APP_ID = '250900';
const GAME_FOLDER = path.join('steamapps', 'common', 'The Binding of Isaac Rebirth');
const SAVE_FOLDER = path.join('My Games', 'Binding of Isaac Repentance+');
const PROTON_DOCUMENTS = path.join('steamapps', 'compatdata', APP_ID, 'pfx', 'drive_c', 'users', 'steamuser', 'Documents');
const DEFAULT_STEAM = 'C:/Program Files (x86)/Steam';
const HOME = os.homedir();
// Dónde instala Steam cada forma de instalarlo en Linux: paquete normal (~/.steam/steam es un enlace a la carpeta real),
// Flatpak y Snap.
const LINUX_STEAM = [
  path.join(HOME, '.steam', 'steam'),
  path.join(HOME, '.local', 'share', 'Steam'),
  path.join(HOME, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
  path.join(HOME, 'snap', 'steam', 'common', '.local', 'share', 'Steam'),
];
// registry.vdf hace en Linux de registro de Windows: ahí apunta Steam la cuenta con la sesión abierta.
const LINUX_REGISTRY = [
  path.join(HOME, '.steam', 'registry.vdf'),
  path.join(HOME, '.var', 'app', 'com.valvesoftware.Steam', '.steam', 'registry.vdf'),
  path.join(HOME, 'snap', 'steam', 'common', '.steam', 'registry.vdf'),
];

const realDir = d => { try { return fs.realpathSync(d); } catch { return null; } };

function steamDir() {
  if (!IS_WINDOWS) {
    const found = LINUX_STEAM.map(realDir).find(d => d && fs.existsSync(path.join(d, 'steamapps')));
    return found || LINUX_STEAM[1];
  }
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
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
    return [...new Set([steam, ...found].map(d => path.resolve(d)))];
  } catch { return [steam]; }
}

// Carpeta donde está instalado el juego (la que tiene tools/ResourceExtractor), en cualquier biblioteca de Steam.
// Solo la usa build/update-resources.js para actualizar los recursos incluidos.
function findIsaac(steam = steamDir()) {
  const dirs = steamLibraries(steam).map(lib => path.join(lib, GAME_FOLDER));
  return dirs.find(d => fs.existsSync(path.join(d, 'tools', 'ResourceExtractor', 'ResourceExtractor.exe')))
    || dirs.find(d => fs.existsSync(d)) || null;
}

function findSaveDir(steam) {
  let candidates;
  if (IS_WINDOWS) {
    const home = process.env.USERPROFILE || HOME;
    const oneDrive = process.env.OneDrive || path.join(home, 'OneDrive');
    candidates = [path.join(home, 'Documents'), path.join(oneDrive, 'Documents'), path.join(oneDrive, 'Documentos')];
  } else {
    // El prefijo de Proton está en la biblioteca donde está instalado el juego.
    candidates = steamLibraries(steam).map(lib => path.join(lib, PROTON_DOCUMENTS));
  }
  const dirs = candidates.map(d => path.join(d, SAVE_FOLDER));
  return dirs.find(d => fs.existsSync(path.join(d, 'log.txt'))) || dirs.find(d => fs.existsSync(d)) || dirs[0];
}

// Cuenta de Steam con la sesión abierta (el número de su carpeta en userdata), o null si Steam no está abierto.
function activeSteamAccount() {
  if (!IS_WINDOWS) {
    for (const file of LINUX_REGISTRY) {
      try {
        const m = /"ActiveUser"\s+"(\d+)"/.exec(fs.readFileSync(file, 'utf8'));
        if (m && +m[1]) return m[1];
      } catch { /* esta forma de instalar Steam no está */ }
    }
    return null;
  }
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam\\ActiveProcess', '/v', 'ActiveUser'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const m = /ActiveUser\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out);
    const id = m ? parseInt(m[1], 16) : 0;
    return id ? String(id) : null;
  } catch { return null; }
}

// Recursos del juego: los incluidos con MultiTracker, salvo que multitracker.config.json indique otra carpeta completa
// (por ejemplo, recursos más nuevos extraídos por el usuario).
function resolvePaths(baseDir) {
  const own = readJson(path.join(baseDir, 'multitracker.config.json'), {});
  const steam = steamDir();
  const dataDir = path.join(baseDir, 'userdata');
  const resDir = own.resourcesDir && isComplete(own.resourcesDir) ? own.resourcesDir : BUNDLED;
  return {
    // Rutas normalizadas: safeJoin compara prefijos y en el archivo pueden venir con "/".
    resDir: path.resolve(resDir),
    gameDir: path.resolve(own.gameDir || findSaveDir(steam)),
    steamUserdata: path.resolve(own.steamUserdata || path.join(steam, 'userdata')),
    dataDir,
  };
}

module.exports = { resolvePaths, activeSteamAccount, findIsaac };
