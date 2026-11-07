// Genera dist/MultiTracker.exe y el .zip para publicar. Uso: node build/build-exe.js 1.0.0
// Solo incluye archivos versionados en Git: lo que no está en el repositorio tampoco llega al .exe.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(VERSION || '')) throw new Error('Indica la versión: node build/build-exe.js 1.0.0');

const ROOT = path.resolve(__dirname, '..');
const WORK = path.join(ROOT, '.build');
const DIST = path.join(ROOT, 'dist');
const EXE = path.join(DIST, 'MultiTracker.exe');
const POSTJECT = '1.0.0-alpha.6';
const RCEDIT = '5.0.2';
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: WORK, ...opts });

// Une los módulos en un solo script: un ejecutable de Node solo puede cargar módulos internos con require.
function bundle(entry) {
  const sources = new Map();
  const visit = id => {
    if (sources.has(id)) return;
    const src = fs.readFileSync(path.join(ROOT, id), 'utf8');
    sources.set(id, src);
    for (const [, rel] of src.matchAll(/require\('(\.\.?\/[^']+)'\)/g)) visit(path.posix.join(path.posix.dirname(id), rel));
  };
  visit(entry);
  const modules = [...sources].map(([id, src]) => `${JSON.stringify(id)}: function (require, module, exports, __dirname) {\n${src}\n}`);
  return `const __path = require('path').posix;
const __modules = {${modules.join(',\n')}};
const __cache = {};
const __load = id => {
  if (__cache[id]) return __cache[id].exports;
  const module = __cache[id] = { exports: {} };
  const local = rel => (rel.startsWith('.') ? __load(__path.join(__path.dirname(id), rel)) : require(rel));
  __modules[id](local, module, module.exports, '');
  return module.exports;
};
__load(${JSON.stringify(entry)});
`;
}

function embeddedAssets() {
  const tracked = execFileSync('git', ['ls-files', 'app', 'data'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  return Object.fromEntries(tracked.map(rel => [rel, path.join(ROOT, rel)]));
}

// La firma de Node.js deja de ser válida al modificar el binario, y una firma rota genera más avisos que ninguna.
function stripSignature(file) {
  const b = fs.readFileSync(file);
  const pe = b.readUInt32LE(0x3c);
  if (b.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('node.exe no es un ejecutable PE');
  const optional = pe + 24;
  if (b.readUInt16LE(optional) !== 0x20b) throw new Error('Se esperaba un ejecutable de 64 bits');
  const entry = optional + 112 + 4 * 8; // Directorio de seguridad
  const offset = b.readUInt32LE(entry);
  if (!offset) return b;
  b.writeUInt32LE(0, entry);
  b.writeUInt32LE(0, entry + 4);
  fs.writeFileSync(file, b.subarray(0, offset));
}

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });

  run('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', `postject@${POSTJECT}`, `rcedit@${RCEDIT}`], { shell: true });

  fs.writeFileSync(path.join(WORK, 'bundle.js'), bundle('server.js'));
  fs.writeFileSync(path.join(WORK, 'sea-config.json'), JSON.stringify({
    main: 'bundle.js', output: 'sea.blob', disableExperimentalSEAWarning: true, useCodeCache: false, assets: embeddedAssets(),
  }, null, 2));
  run(process.execPath, ['--experimental-sea-config', 'sea-config.json']);

  fs.copyFileSync(process.execPath, EXE);
  fs.chmodSync(EXE, 0o755);
  stripSignature(EXE);
  run(path.join(WORK, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'), [EXE,
    '--set-icon', path.join(__dirname, 'icon.ico'),
    '--set-file-version', VERSION, '--set-product-version', VERSION,
    '--set-version-string', 'FileDescription', 'MultiTracker',
    '--set-version-string', 'ProductName', 'MultiTracker',
    '--set-version-string', 'CompanyName', 'Mafla',
    '--set-version-string', 'LegalCopyright', 'Copyright (c) 2026 Mafla',
    '--set-version-string', 'OriginalFilename', 'MultiTracker.exe',
    '--set-version-string', 'InternalName', 'MultiTracker',
  ]);
  run(process.execPath, [path.join(WORK, 'node_modules', 'postject', 'dist', 'cli.js'), EXE, 'NODE_SEA_BLOB', 'sea.blob', '--sentinel-fuse', SEA_FUSE]);

  // El .exe contiene Node.js: su licencia debe acompañarlo.
  const nodeLicense = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
  if (!nodeLicense.ok) throw new Error('No se pudo descargar la licencia de Node.js: ' + nodeLicense.status);
  const pack = path.join(WORK, 'pack');
  fs.rmSync(pack, { recursive: true, force: true });
  fs.mkdirSync(pack);
  fs.copyFileSync(EXE, path.join(pack, 'MultiTracker.exe'));
  fs.copyFileSync(path.join(__dirname, 'LEEME.txt'), path.join(pack, 'LEEME.txt'));
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(pack, 'LICENSE.txt'));
  fs.copyFileSync(path.join(ROOT, 'data', 'LICENSE-RebirthItemTracker.txt'), path.join(pack, 'LICENSE-RebirthItemTracker.txt'));
  fs.writeFileSync(path.join(pack, 'LICENSE-Node.txt'), await nodeLicense.text());

  const zip = path.join(DIST, `MultiTracker-${VERSION}-windows-x64.zip`);
  execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Compress-Archive -Path (Join-Path $env:PACK "*") -DestinationPath $env:ZIP -Force'], { stdio: 'inherit', env: { ...process.env, PACK: pack, ZIP: zip } });
  console.log(`Listo: ${EXE}\n       ${zip}`);
}

main().catch(e => { console.error(e); process.exit(1); });
