// Actualiza data/resources, los recursos del juego que van incluidos con MultiTracker, desde la copia del juego
// instalada en este PC. Hace falta cuando una actualización del juego añade objetos, trinkets o logros.
// Uso: node build/update-resources.js [carpeta del juego]
// Ejecuta el ResourceExtractor del juego (unos 1,2 GB en la carpeta temporal, 2-3 minutos) y guarda solo lo necesario.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { findIsaac } = require('../paths.js');
const { BUNDLED, FILES, DIRS, SPRITES, isComplete } = require('../lib/resources.js');

const EXTRACTOR = path.join('tools', 'ResourceExtractor', 'ResourceExtractor.exe');

// Ejecuta el extractor del juego. Escribe un ENTER cada segundo: al terminar espera uno para cerrarse,
// y no sirve mandarlo al principio porque lo descarta.
function runExtractor(isaacDir, outDir) {
  const exe = path.join(isaacDir, EXTRACTOR);
  let expected = 0;
  try { expected = fs.readFileSync(path.join(path.dirname(exe), 'filelist.txt'), 'latin1').split('\n').filter(Boolean).length; } catch { /* sin estimación */ }
  return new Promise((resolve, reject) => {
    // Con barras invertidas en las rutas no reconoce ningún nombre de archivo y termina sin extraer nada.
    const slashes = p => p.replace(/\\/g, '/');
    const child = spawn(exe, [slashes(isaacDir), slashes(outDir)], { cwd: path.dirname(exe), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let done = 0, tail = '', shown = -1;
    child.stdout.on('data', chunk => {
      // Solo se cuentan líneas completas; la última, a medias, se guarda para el siguiente trozo.
      const text = tail + chunk.toString('latin1'), end = text.lastIndexOf('\n') + 1;
      done += (text.slice(0, end).match(/^Extract /gm) || []).length;
      tail = text.slice(end);
      const pct = expected ? Math.min(99, Math.floor(done / expected * 100)) : done;
      if (pct !== shown) { shown = pct; process.stdout.write(expected ? `\r${pct}%` : `\r${done}`); }
    });
    child.stdin.on('error', () => { /* el extractor ya se cerró */ });
    const enter = setInterval(() => { if (!child.stdin.destroyed) child.stdin.write('\r\n'); }, 1000);
    const finish = err => { clearInterval(enter); process.stdout.write('\n'); err ? reject(err) : resolve(); };
    child.once('error', finish);
    child.once('exit', () => finish(null));
  });
}

// Copia lo necesario a dest sin dejar nunca una carpeta a medias: se prepara al lado y se cambia de nombre al final.
function keepNeeded(src, dest) {
  const staging = dest + '.new';
  fs.rmSync(staging, { recursive: true, force: true });
  for (const f of [...FILES, ...SPRITES]) {
    const from = path.join(src, f);
    if (!fs.existsSync(from)) { console.warn(`Falta ${f}`); continue; }
    fs.mkdirSync(path.dirname(path.join(staging, f)), { recursive: true });
    fs.copyFileSync(from, path.join(staging, f));
  }
  for (const d of DIRS) fs.cpSync(path.join(src, d), path.join(staging, d), { recursive: true });
  // El aviso de autoría no viene del juego: se conserva.
  const notice = path.join(dest, 'LEEME.txt');
  if (fs.existsSync(notice)) fs.copyFileSync(notice, path.join(staging, 'LEEME.txt'));
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(staging, dest);
}

async function main() {
  const isaacDir = process.argv[2] || findIsaac();
  if (!isaacDir || !fs.existsSync(path.join(isaacDir, EXTRACTOR))) throw new Error('No se encuentra el juego. Indica su carpeta: node build/update-resources.js "D:/.../The Binding of Isaac Rebirth"');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'multitracker-'));
  try {
    console.log(`Extrayendo de ${isaacDir}…`);
    await runExtractor(isaacDir, work);
    const extracted = path.join(work, 'resources');
    if (!isComplete(extracted)) throw new Error('La extracción no está completa');
    keepNeeded(extracted, BUNDLED);
    console.log(`Listo: ${BUNDLED}`);
  } finally {
    // Lo extraído pesa más de 1 GB: se borra siempre, también si falla.
    try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* queda en la carpeta temporal */ }
  }
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
