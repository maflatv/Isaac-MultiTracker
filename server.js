// MultiTracker con Node, sin la aplicación de escritorio: sirve el panel y la vista en http://localhost.
// La aplicación de escritorio (desktop/main.js) reutiliza listen() para la fuente de navegador de OBS.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { send } = require('./lib/http.js');

const DEFAULT_PORT = 7374;

// Solo escucha en este PC. Llama a onReady(error) cuando el puerto está abierto o no se ha podido abrir.
function listen(handle, port, onReady = () => {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      await handle(req, res, url, decodeURIComponent(url.pathname));
    } catch (e) {
      console.error(e);
      send(res, 500, { error: String(e.message || e) });
    }
  });
  server.once('error', onReady);
  server.listen(port, '127.0.0.1', () => { server.off('error', onReady); onReady(null); });
  return server;
}

const hasResources = paths => !!paths.resDir && fs.existsSync(path.join(paths.resDir, 'items.xml'));

module.exports = { listen, hasResources, DEFAULT_PORT };

if (require.main === module) {
  const { resolvePaths } = require('./paths.js');
  const { createTracker } = require('./tracker.js');
  const { BASE_DIR } = require('./lib/runtime.js');
  const { t, resolve } = require('./app/i18n.js');

  const PORT = Number(process.env.PORT) || DEFAULT_PORT;
  const URL_BASE = `http://localhost:${PORT}`;
  const paths = resolvePaths(BASE_DIR);
  if (!hasResources(paths)) {
    const lang = resolve(Intl.DateTimeFormat().resolvedOptions().locale);
    console.error(`${t(lang, 'start.noResources')}\n\n${t(lang, 'start.noResourcesSteps')}`);
    process.exit(1);
  }
  const { handle } = createTracker(paths);
  listen(handle, PORT, e => {
    if (e && e.code === 'EADDRINUSE') return console.log(`MultiTracker: ${URL_BASE}`);
    if (e) throw e;
    console.log(`MultiTracker: ${URL_BASE}`);
    console.log(`OBS: ${URL_BASE}/overlay.html`);
  });
}
