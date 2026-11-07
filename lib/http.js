// Utilidades compartidas por el servidor y las herramientas.
const fs = require('fs');
const path = require('path');
const { readAsset } = require('./runtime.js');

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

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'No encontrado' });
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}
function serveAsset(res, rel) {
  const data = readAsset(rel);
  if (!data) return send(res, 404, { error: 'No encontrado' });
  send(res, 200, data, MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream');
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function writeFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

module.exports = { safeJoin, send, serveFile, serveAsset, readBody, writeFile, readJson };
