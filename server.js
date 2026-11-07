// MultiTracker: servidor local sin dependencias. Solo escucha en este PC.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { resolvePaths } = require('./paths.js');
const { createTracker } = require('./tracker.js');
const { send } = require('./lib/http.js');

const PORT = process.env.PORT || 7374;
const paths = resolvePaths(__dirname);

if (!paths.resDir || !fs.existsSync(path.join(paths.resDir, 'items.xml'))) {
  console.error(`No se encuentran los recursos extraídos del juego.

1. Ejecuta tools\\ResourceExtractor\\ResourceExtractor.exe, en la carpeta del juego en Steam.
2. Vuelve a iniciar MultiTracker.

Si ya los extrajiste en otra carpeta, indícala en multitracker.config.json (consulta el README).`);
  process.exit(1);
}

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
  console.log(`MultiTracker ya está en marcha en http://localhost:${PORT}`);
  process.exit(0);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`MultiTracker en http://localhost:${PORT}`);
  console.log(`Vista para OBS: http://localhost:${PORT}/overlay.html`);
});
