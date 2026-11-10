// Iconos oficiales de los logros (64x64), los mismos que muestra Steam.
// Qué icono tiene cada logro sale del esquema que el cliente de Steam guarda en appcache/stats;
// la imagen se descarga una vez de la CDN de Steam y queda en la caché del usuario.
const fs = require('fs');
const path = require('path');
const { writeFile } = require('./http.js');

const APP_ID = 250900;
const CDN = `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${APP_ID}/`;
const SCHEMA = `UserGameStatsSchema_${APP_ID}.bin`;
const TIMEOUT_MS = 10000;
// Tras un fallo (sin internet, por ejemplo) no se reintenta cada segundo: la vista muestra el texto mientras tanto.
const RETRY_MS = 10 * 60 * 1000;
const HASH = /^[0-9a-f]{40}\.jpg$/;
// Una descarga cortada o una página de error no deben quedar en la caché como si fueran el icono.
// Empieza como un JPEG y tiene su marca de fin (FF D9), que algunos archivos llevan seguida de unos bytes de relleno.
const JPEG_END = Buffer.from([0xff, 0xd9]);
const isJpeg = b => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b.lastIndexOf(JPEG_END) >= b.length - 32;

// KeyValues binario de Valve: tipo (1 byte), nombre terminado en 0 y valor. 0 abre un bloque, 8 lo cierra.
function parseKeyValues(buf) {
  let p = 0;
  const str = () => { const end = buf.indexOf(0, p); const s = buf.toString('utf8', p, end); p = end + 1; return s; };
  const block = () => {
    const out = {};
    for (;;) {
      const type = buf[p++];
      if (type === 8 || type === undefined) return out;
      const key = str();
      if (type === 0) out[key] = block();
      else if (type === 1) out[key] = str();
      else if (type === 2 || type === 3) { out[key] = type === 2 ? buf.readInt32LE(p) : buf.readFloatLE(p); p += 4; }
      else if (type === 7) { out[key] = buf.readBigUInt64LE(p).toString(); p += 8; }
      else throw new Error(`KeyValues: tipo ${type} desconocido`);
    }
  };
  return block();
}

// id del logro (su nombre en Steam coincide con el número del juego) -> archivo del icono.
function readSchema(file) {
  const root = Object.values(parseKeyValues(fs.readFileSync(file)))[0] || {};
  const icons = new Map();
  for (const stat of Object.values(root.stats || {})) {
    for (const bit of Object.values(stat.bits || {})) {
      const icon = bit.display && bit.display.icon;
      if (/^\d+$/.test(bit.name) && HASH.test(icon || '')) icons.set(+bit.name, icon);
    }
  }
  return icons;
}

// steamUserdata: carpeta userdata de Steam; el esquema está en ../appcache/stats. cacheDir: dónde guardar las imágenes.
function createAchievementIcons({ steamUserdata, cacheDir }) {
  let schema = null;
  const pending = new Map();
  const failedAt = new Map();

  function icons() {
    if (schema && schema.size) return schema;
    try { schema = readSchema(path.join(steamUserdata, '..', 'appcache', 'stats', SCHEMA)); } catch { schema = new Map(); }
    return schema;
  }

  async function download(id, file) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(CDN + icons().get(id), { signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = Buffer.from(await r.arrayBuffer());
      if (!isJpeg(data)) throw new Error('Not a JPEG');
      // Se escribe a un temporal y se renombra: si el programa se cierra a medias, no queda un icono roto.
      writeFile(file, data);
      return data;
    } finally { clearTimeout(timer); }
  }

  // Devuelve la imagen (JPEG) o null si no se puede conseguir ahora.
  async function get(id) {
    if (!icons().has(id)) return null;
    const file = path.join(cacheDir, `${id}.jpg`);
    try { return fs.readFileSync(file); } catch { /* aún no está en caché */ }
    if (Date.now() - (failedAt.get(id) || 0) < RETRY_MS) return null;
    if (!pending.has(id)) {
      pending.set(id, download(id, file)
        .catch(() => { failedAt.set(id, Date.now()); return null; })
        .finally(() => pending.delete(id)));
    }
    return pending.get(id);
  }

  return { get };
}

module.exports = { createAchievementIcons, parseKeyValues };
