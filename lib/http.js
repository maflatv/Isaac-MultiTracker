// Utilidades compartidas por el servidor y las herramientas.
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.anm2': 'application/xml; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.ttf': 'font/ttf',
};

// Resuelve una ruta dentro de base sin permitir salir de ella.
function safeJoin(base, rel) {
  const p = path.resolve(base, '.' + path.sep + rel);
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

// Los iconos no cambian mientras el programa está abierto: se pueden reutilizar en vez de pedirlos en cada redibujado.
const CACHE_ICONS = 'max-age=3600';
const cacheControl = cache => (cache ? CACHE_ICONS : 'no-store');

function send(res, code, body, type = 'application/json; charset=utf-8', cache = false) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': cacheControl(cache) });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
// Se escribe en un archivo temporal y se renombra: si el programa se cierra a medias, el archivo anterior sigue intacto.
function writeFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Un antivirus o un editor pueden tener el archivo abierto y bloquear el cambio de nombre: se escribe directamente.
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(file, data);
  }
}
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

module.exports = { MIME, safeJoin, send, cacheControl, readBody, writeFile, readJson };
