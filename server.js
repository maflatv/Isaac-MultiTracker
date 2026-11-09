// MultiTracker con Node, sin la aplicación de escritorio: sirve el panel y la vista en http://localhost.
// La aplicación de escritorio (desktop/main.js) reutiliza listen() para la fuente de navegador de OBS.
const http = require('http');
const { send } = require('./lib/http.js');

const DEFAULT_PORT = 7374;

// Una web cuyo dominio apunte a 127.0.0.1 (DNS rebinding) llega con su propio nombre en Host: se rechaza.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

// Solo escucha en este PC. Llama a onReady(error) cuando el puerto está abierto o no se ha podido abrir.
function listen(handle, port, onReady = () => {}) {
  const server = http.createServer(async (req, res) => {
    if (!LOCAL_HOST.test(req.headers.host || '')) return send(res, 403, { error: 'Forbidden host' });
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

module.exports = { listen, DEFAULT_PORT };

if (require.main === module) {
  const { resolvePaths } = require('./paths.js');
  const { createTracker } = require('./tracker.js');
  const { extractResources } = require('./lib/resources.js');
  const { BASE_DIR } = require('./lib/runtime.js');
  const { t, resolve } = require('./app/i18n.js');

  const PORT = Number(process.env.PORT) || DEFAULT_PORT;
  const URL_BASE = `http://localhost:${PORT}`;
  const lang = resolve(Intl.DateTimeFormat().resolvedOptions().locale);

  // Sin recursos completos (primera vez, o se borraron), se extraen de la copia del juego antes de abrir el servidor.
  async function ensureResources(paths) {
    if (paths.resDir) return paths;
    console.log(t(lang, 'start.extracting'));
    let shown = -1;
    try {
      const resDir = await extractResources(paths.isaacDir, paths.ownResDir, p => {
        const pct = Math.floor(p * 100);
        if (pct !== shown) { shown = pct; process.stdout.write(`\r${pct}%`); }
      });
      console.log('');
      return { ...paths, resDir };
    } catch (e) {
      if (!e.key) throw e;
      console.error(`\n${t(lang, e.key, e.vars)}\n\n${t(lang, 'start.manualSteps')}`);
      process.exit(1);
    }
  }

  ensureResources(resolvePaths(BASE_DIR)).then(paths => {
    const { handle } = createTracker(paths);
    listen(handle, PORT, e => {
      if (e && e.code === 'EADDRINUSE') return console.log(`MultiTracker: ${URL_BASE}`);
      if (e) throw e;
      console.log(`MultiTracker: ${URL_BASE}`);
      console.log(`OBS: ${URL_BASE}/overlay.html`);
    });
  });
}
