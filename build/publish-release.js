// Publica en GitHub la release v<versión> con los cinco archivos que deja build/build-exe.js en dist/.
// Uso: node build/publish-release.js 1.9.0
//      node build/publish-release.js 1.9.0 --notas   (solo cambia las notas de una release ya publicada)
// Antes: subir el commit y la etiqueta (git push origin main v1.9.0) y escribir las notas en build/notas/1.9.0.md,
// primero en inglés y después en una sección «# Español».
// La credencial es GH_TOKEN o, si no está, la que Git ya usa para subir a GitHub (administrador de credenciales de
// Windows). Solo se lee en este momento: no se guarda ni se muestra.
// Al terminar comprueba que la release es la última y que su latest.yml es el de esta versión: es lo que leen las
// versiones instaladas para actualizarse.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(VERSION || '')) throw new Error('Indica la versión: node build/publish-release.js 1.9.0');
const TAG = `v${VERSION}`;
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const NOTES = path.join(__dirname, 'notas', `${VERSION}.md`);
const API = 'https://api.github.com/repos/maflatv/Isaac-MultiTracker';
const FILES = [`MultiTracker-Setup-${VERSION}.exe`, `MultiTracker-Setup-${VERSION}.exe.blockmap`, 'latest.yml', 'MultiTracker.exe', `MultiTracker-${VERSION}-windows-x64.zip`];
const TYPES = { '.exe': 'application/vnd.microsoft.portable-executable', '.zip': 'application/zip', '.yml': 'text/yaml', '.blockmap': 'application/octet-stream' };

function token() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const out = execFileSync('git', ['credential', 'fill'], { cwd: ROOT, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    return (/^password=(.+)$/m.exec(out) || [])[1] || '';
  } catch { return ''; }
}
const TOKEN = token();
if (!TOKEN) throw new Error('No hay credencial de GitHub: define GH_TOKEN o inicia sesión con git push.');
const HEADERS = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'multitracker-publish' };

async function gh(url, options = {}) {
  const r = await fetch(url.startsWith('http') ? url : API + url, { ...options, headers: { ...HEADERS, ...options.headers } });
  if (!r.ok && r.status !== 404) throw new Error(`GitHub ${options.method || 'GET'} ${url}: HTTP ${r.status} ${await r.text()}`);
  return r.status === 404 ? null : r.status === 204 ? {} : r.json();
}

function checkFiles() {
  for (const f of FILES) if (!fs.existsSync(path.join(DIST, f))) throw new Error(`Falta dist/${f}: compila antes con node build/build-exe.js ${VERSION}`);
  const yml = fs.readFileSync(path.join(DIST, 'latest.yml'), 'utf8');
  if (!new RegExp(`^version: ${VERSION.replace(/\./g, '\\.')}$`, 'm').test(yml)) throw new Error(`dist/latest.yml no es de la ${VERSION}: vuelve a compilar`);
  if (!fs.existsSync(NOTES)) throw new Error(`Faltan las notas: ${path.relative(ROOT, NOTES)}`);
  return yml;
}

// Corrige el texto de una release publicada sin tocar sus archivos.
async function updateNotes() {
  if (!fs.existsSync(NOTES)) throw new Error(`Faltan las notas: ${path.relative(ROOT, NOTES)}`);
  const release = await gh(`/releases/tags/${TAG}`);
  if (!release) throw new Error(`No hay ninguna release publicada ${TAG}`);
  await gh(`/releases/${release.id}`, { method: 'PATCH', body: JSON.stringify({ body: fs.readFileSync(NOTES, 'utf8') }) });
  console.log(`Notas actualizadas: ${release.html_url}`);
}

async function main() {
  if (process.argv.includes('--notas')) return updateNotes();
  const yml = checkFiles();
  if (!await gh(`/git/ref/tags/${TAG}`)) throw new Error(`La etiqueta ${TAG} no está en GitHub: git push origin main ${TAG}`);

  // Una release ya publicada no se toca: las instaladas ya pueden haberla descargado.
  const all = await gh('/releases?per_page=50');
  let release = all.find(r => r.tag_name === TAG);
  if (release && !release.draft) throw new Error(`La release ${TAG} ya está publicada: ${release.html_url}`);
  const body = fs.readFileSync(NOTES, 'utf8');
  // Se prepara como borrador: hasta el final, nadie ve una release a medias.
  if (!release) release = await gh('/releases', { method: 'POST', body: JSON.stringify({ tag_name: TAG, name: `MultiTracker ${VERSION}`, body, draft: true }) });

  for (const f of FILES) {
    const old = release.assets.find(a => a.name === f);
    if (old) await gh(`/releases/assets/${old.id}`, { method: 'DELETE' });
    const data = fs.readFileSync(path.join(DIST, f));
    process.stdout.write(`Subiendo ${f} (${(data.length / 1048576).toFixed(1)} MB)… `);
    const url = release.upload_url.replace(/\{.*\}$/, '') + '?name=' + encodeURIComponent(f);
    await gh(url, { method: 'POST', headers: { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }, body: data });
    console.log('hecho');
  }

  release = await gh(`/releases/${release.id}`, { method: 'PATCH', body: JSON.stringify({ name: `MultiTracker ${VERSION}`, body, draft: false, prerelease: false, make_latest: 'true' }) });

  // Lo que verá una versión instalada: la última release y su latest.yml.
  const latest = await gh('/releases/latest');
  const asset = latest && latest.assets.find(a => a.name === 'latest.yml');
  const remote = asset && await (await fetch(asset.browser_download_url)).text();
  if (!latest || latest.tag_name !== TAG || remote !== yml) throw new Error('La release se publicó, pero GitHub aún no la da como última con su latest.yml: revísala.');
  console.log(`Publicada: ${release.html_url}`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
