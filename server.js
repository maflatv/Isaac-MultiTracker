// MultiTracker: servidor local sin dependencias. Solo escucha en este PC.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { resolvePaths } = require('./paths.js');
const { createTracker } = require('./tracker.js');
const { send } = require('./lib/http.js');
const { IS_EXE, BASE_DIR } = require('./lib/runtime.js');

const PORT = process.env.PORT || 7374;
const URL_BASE = `http://localhost:${PORT}`;
const paths = resolvePaths(BASE_DIR);

// El .exe se abre con doble clic: abre el panel por su cuenta.
function openPanel() {
  if (IS_EXE && !process.argv.includes('--no-open')) execFile('cmd', ['/c', 'start', '', URL_BASE]);
}

// Con doble clic, la consola se cerraría antes de poder leer el error.
function failAndWait(message) {
  console.error(message);
  if (!IS_EXE) process.exit(1);
  console.error('\nPulsa Enter para cerrar.');
  process.stdin.once('data', () => process.exit(1));
}

if (!paths.resDir || !fs.existsSync(path.join(paths.resDir, 'items.xml'))) {
  failAndWait(`No se encuentran los recursos extraídos del juego.

1. Ejecuta tools\\ResourceExtractor\\ResourceExtractor.exe, en la carpeta del juego en Steam.
2. Vuelve a iniciar MultiTracker.

Si ya los extrajiste en otra carpeta, indícala en multitracker.config.json (consulta el README).`);
} else {
  const { handle } = createTracker(paths);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      await handle(req, res, url, decodeURIComponent(url.pathname));
    } catch (e) {
      console.error(e);
      send(res, 500, { error: String(e.message || e) });
    }
  });

  server.on('error', e => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.log(`MultiTracker ya está en marcha en ${URL_BASE}`);
    openPanel();
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`MultiTracker en ${URL_BASE}`);
    console.log(`Vista para OBS: ${URL_BASE}/overlay.html`);
    if (IS_EXE) console.log('\nDeja esta ventana abierta mientras uses el tracker.');
    openPanel();
  });
}
