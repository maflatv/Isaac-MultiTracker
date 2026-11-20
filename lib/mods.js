// Objetos, trinkets y personajes que añaden los mods. El juego les da número al arrancar, por el orden de la lista
// «Enabled Mods» de log.txt: los objetos siguen al último del juego (733...), los trinkets al último trinket y los
// personajes al último personaje (41...). El log trae además el nombre de cada objeto que se coge: con él se comprueba
// el número y, si no coincide (otro orden de carga), se busca por nombre.
const fs = require('fs');
const path = require('path');

const TRINKET_OFFSET = 2000;
const ITEM_TAG = /<(passive|active|familiar|trinket)\b([^>]*)>/g;
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = s => s.replace(/&(lt|gt|amp|quot|apos);/g, (_, e) => ENTITIES[e]);
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`)); return m ? decode(m[1]) : undefined; };
const norm = s => (s || '').trim().toLowerCase();

// Ruta real de base/rel sin distinguir mayúsculas: los xml de los mods no siempre escriben los nombres igual que los
// archivos, y en Linux eso importa. Devuelve null si algún tramo no existe.
function findCase(base, rel) {
  let cur = base;
  for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
    const direct = path.join(cur, part);
    if (fs.existsSync(direct)) { cur = direct; continue; }
    let found = null;
    try { found = fs.readdirSync(cur).find(f => f.toLowerCase() === part.toLowerCase()); } catch { return null; }
    if (!found) return null;
    cur = path.join(cur, found);
  }
  return cur;
}

// Carpeta de un mod tal como la escribe el log (en minúsculas y con la ruta de Windows). En Linux el juego corre con
// Proton, donde z: es la raíz del sistema.
function hostDir(logPath) {
  const p = logPath.replace(/[\\/]+$/, '');
  if (process.platform === 'win32') return fs.existsSync(p) ? p : null;
  const m = /^([a-z]):[\\/](.*)$/i.exec(p);
  if (!m) return fs.existsSync(p) ? p : null;
  return m[1].toLowerCase() === 'z' ? findCase('/', m[2]) : null;
}

// Repentance usa content-dlc3 y resources-dlc3 si el mod los trae.
const firstDir = (dir, names) => names.map(n => findCase(dir, n)).find(Boolean) || null;
const readXml = (dir, file) => {
  const f = firstDir(dir, ['content-dlc3', 'content']);
  const p = f && findCase(f, file);
  try { return p ? fs.readFileSync(p, 'utf8') : null; } catch { return null; }
};

// dirs: carpetas de los mods activos, en el orden de «Enabled Mods». first: primer número libre de cada tipo.
// Devuelve { list, items: Map id -> entrada, players: Map tipo -> entrada, resolve(id, nombreDelLog) }.
// Entrada de objeto: { n, id, name, icon (ruta absoluta o null), active, desc, mod }.
function loadModCatalog(dirs, first = { item: 733, trinket: 190, player: 41 }) {
  const list = [], items = new Map(), players = new Map();
  let nextItem = first.item, nextTrinket = first.trinket, nextPlayer = first.player;
  for (const logDir of dirs) {
    const dir = hostDir(logDir);
    if (!dir) continue;
    const mod = path.basename(dir);
    const resources = firstDir(dir, ['resources-dlc3', 'resources']);
    const xml = readXml(dir, 'items.xml');
    if (xml) {
      const root = attr((xml.match(/<items\b[^>]*>/) || [''])[0], 'gfxroot') || 'gfx/items/';
      for (const [, kind, tag] of xml.matchAll(ITEM_TAG)) {
        // Con id, la entrada cambia un objeto del juego en vez de añadir uno.
        if (attr(tag, 'id') !== undefined) continue;
        const trinket = kind === 'trinket';
        const id = trinket ? TRINKET_OFFSET + nextTrinket++ : nextItem++;
        const gfx = attr(tag, 'gfx');
        const name = attr(tag, 'name') || '';
        const entry = {
          n: list.length, id, mod, active: kind === 'active', trinket,
          name: name.startsWith('#') ? '' : name,
          desc: (attr(tag, 'description') || '').replace(/^#.*/, ''),
          icon: gfx && resources ? findCase(resources, path.join(root, trinket ? 'trinkets' : 'collectibles', gfx)) : null,
        };
        list.push(entry);
        items.set(id, entry);
      }
    }
    const pxml = readXml(dir, 'players.xml');
    if (pxml) {
      for (const [tag] of pxml.matchAll(/<player\b[^>]*>/g)) {
        const name = attr(tag, 'name') || '';
        // Las versiones Tainted de un personaje de mod llevan bskinparent y el mismo nombre que la normal.
        players.set(nextPlayer++, { name: (attr(tag, 'bskinparent') !== undefined ? 'T. ' : '') + name, mod });
      }
    }
  }
  const byName = new Map();
  for (const e of list) if (e.name && !byName.has(norm(e.name) + e.trinket)) byName.set(norm(e.name) + e.trinket, e);
  // El número manda si el nombre coincide (o el log no lo trae); si no, el nombre.
  const resolve = (id, logName) => {
    const e = items.get(id);
    if (!logName || !norm(logName) || (e && (!e.name || norm(e.name) === norm(logName)))) return e || null;
    return byName.get(norm(logName) + (id >= TRINKET_OFFSET)) || null;
  };
  return { list, items, players, resolve, actives: new Set(list.filter(e => e.active).map(e => e.id)) };
}

module.exports = { loadModCatalog, hostDir, findCase };
