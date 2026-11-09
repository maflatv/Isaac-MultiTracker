// Recursos del juego que usa MultiTracker (iconos, nombres y traducciones). No se incluyen con el programa:
// la primera vez se extraen de la copia del juego del usuario con su ResourceExtractor y se guarda solo lo necesario
// (unos 5 MB) en userdata/resources. En cada arranque se comprueba que sigan ahí; si faltan, se vuelven a extraer.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const COSTUMES = path.join('gfx', 'characters', 'costumes');
// Cabeza de quien lleva cada objeto: la hoja del personaje (su primer cuadro es la cabeza de frente, 32x32)
// y la del pelo (primer cuadro de 64x64, con la cabeza en el centro).
const OWNER_SPRITES = {
  lazarus: { head: 'character_009b_lazarus.png', hair: 'character_009b_lazarushair.png' },
  lazarus_dead: { head: 'character_009b_lazarus2.png', hair: 'character_009b_lazarus2hair.png' },
  jacob: { head: 'character_002x_jacob.png', hair: 'character_002x_jacobhair.png' },
  esau: { head: 'character_003x_esau.png', hair: 'character_003x_esauhair.png' },
};
const FILES = ['items.xml', 'items_metadata.xml', 'achievements.xml', 'stringtable.sta'];
const DIRS = [path.join('gfx', 'items', 'collectibles'), path.join('gfx', 'items', 'trinkets')];
const SPRITES = Object.values(OWNER_SPRITES).flatMap(s => [s.head, s.hair]).map(f => path.join(COSTUMES, f));

const EXTRACTOR = path.join('tools', 'ResourceExtractor', 'ResourceExtractor.exe');
// La extracción completa ocupa unos 1,2 GB en la carpeta temporal mientras dura; se pide algo de margen.
const NEEDED_BYTES = 1.5 * 1024 ** 3;
// En un disco lento puede tardar bastante más que los 2-3 minutos habituales.
const TIMEOUT_MS = 30 * 60 * 1000;

class ResourceError extends Error {
  constructor(key, vars = {}) { super(key); this.key = key; this.vars = vars; }
}

// Están todos los archivos que se leen sin alternativa. Las cabezas de los personajes son opcionales: sin ellas se usa una letra.
function isComplete(dir) {
  if (!dir) return false;
  try {
    return FILES.every(f => fs.statSync(path.join(dir, f)).isFile())
      && DIRS.every(d => fs.readdirSync(path.join(dir, d)).some(f => f.endsWith('.png')));
  } catch { return false; }
}

function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return Infinity; }
}

// Ejecuta el extractor del juego. Escribe un ENTER cada segundo: al terminar espera uno para cerrarse,
// y no sirve mandarlo al principio porque lo descarta. onProgress(0..1) según los archivos ya extraídos.
function runExtractor(isaacDir, outDir, onProgress) {
  const exe = path.join(isaacDir, EXTRACTOR);
  let expected = 0;
  try { expected = fs.readFileSync(path.join(path.dirname(exe), 'filelist.txt'), 'latin1').split('\n').filter(Boolean).length; } catch { /* sin estimación */ }
  return new Promise((resolve, reject) => {
    // Con barras invertidas en las rutas no reconoce ningún nombre de archivo y termina sin extraer nada.
    const slashes = p => p.replace(/\\/g, '/');
    const child = spawn(exe, [slashes(isaacDir), slashes(outDir)], { cwd: path.dirname(exe), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let done = 0, tail = '', cancelled = false;
    child.stdout.on('data', chunk => {
      // Solo se cuentan líneas completas; la última, a medias, se guarda para el siguiente trozo.
      const text = tail + chunk.toString('latin1'), end = text.lastIndexOf('\n') + 1;
      done += (text.slice(0, end).match(/^Extract /gm) || []).length;
      tail = text.slice(end);
      if (expected) onProgress(Math.min(0.99, done / expected));
    });
    child.stdin.on('error', () => { /* el extractor ya se cerró */ });
    const enter = setInterval(() => { if (!child.stdin.destroyed) child.stdin.write('\r\n'); }, 1000);
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    const finish = err => { clearInterval(enter); clearTimeout(timer); err ? reject(err) : resolve(); };
    child.once('error', e => finish(new ResourceError('start.extractFailed', { error: e.code || e.message })));
    child.once('exit', () => finish(cancelled ? new ResourceError('cancelled') : null));
    cancelCurrent = () => { cancelled = true; child.kill(); };
  });
}
let cancelCurrent = null;

// Copia lo necesario a dest sin dejar nunca una carpeta a medias: se prepara al lado y se cambia de nombre al final.
function keepNeeded(src, dest) {
  const staging = dest + '.new';
  fs.rmSync(staging, { recursive: true, force: true });
  for (const f of [...FILES, ...SPRITES]) {
    const from = path.join(src, f);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(path.join(staging, f)), { recursive: true });
    fs.copyFileSync(from, path.join(staging, f));
  }
  for (const d of DIRS) fs.cpSync(path.join(src, d), path.join(staging, d), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(staging, dest);
}

// Extrae los recursos de la copia del juego en isaacDir y deja lo necesario en dest. Devuelve dest.
async function extractResources(isaacDir, dest, onProgress = () => {}) {
  if (!isaacDir || !fs.existsSync(path.join(isaacDir, EXTRACTOR))) throw new ResourceError('start.noGame');
  const temp = os.tmpdir();
  const free = freeBytes(temp);
  if (free < NEEDED_BYTES) throw new ResourceError('start.noSpace', { dir: temp, need: '1.5', free: (free / 1024 ** 3).toFixed(1) });
  const work = fs.mkdtempSync(path.join(temp, 'multitracker-'));
  try {
    onProgress(0);
    await runExtractor(isaacDir, work, onProgress);
    const extracted = path.join(work, 'resources');
    if (!isComplete(extracted)) throw new ResourceError('start.extractFailed', { error: 'incomplete' });
    keepNeeded(extracted, dest);
    onProgress(1);
    return dest;
  } finally {
    cancelCurrent = null;
    // Lo extraído pesa más de 1 GB: se borra siempre, también si falla o se cancela.
    try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* queda en la carpeta temporal */ }
  }
}

const cancelExtraction = () => { if (cancelCurrent) cancelCurrent(); };

module.exports = { COSTUMES, OWNER_SPRITES, isComplete, extractResources, cancelExtraction, ResourceError };
