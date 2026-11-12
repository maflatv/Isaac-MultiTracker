// Datos de consulta: nombres e iconos del juego, y descripciones de items.json (Rebirth Item Tracker).
// Los nombres traducidos salen del stringtable.sta del propio juego; las descripciones, de data/descriptions/.
const fs = require('fs');
const path = require('path');
const { readAsset } = require('./runtime.js');
const { t, LANGUAGES } = require('../app/i18n.js');

const CHARACTERS = ['Isaac', 'Magdalene', 'Cain', 'Judas', '???', 'Eve', 'Samson', 'Azazel', 'Lazarus', 'Eden', 'The Lost', 'Lazarus II', 'Dark Judas', 'Lilith', 'Keeper', 'Apollyon', 'The Forgotten', 'The Soul', 'Bethany', 'Jacob', 'Esau',
  'T. Isaac', 'T. Magdalene', 'T. Cain', 'T. Judas', 'T. ???', 'T. Eve', 'T. Samson', 'T. Azazel', 'T. Lazarus', 'T. Eden', 'T. Lost', 'T. Lilith', 'T. Keeper', 'T. Apollyon', 'T. Forgotten', 'T. Bethany', 'T. Jacob', 'T. Lazarus', 'T. Jacob', 'T. Forgotten'];
// Clave del stringtable de cada personaje (mismo orden que CHARACTERS). Solo sirve para no traducir los logros que se
// llaman como un personaje.
const CHARACTER_KEYS = ['ISAAC', 'MAGDALENE', 'CAIN', 'JUDAS', 'BLUEBABY', 'EVE', 'SAMSON', 'AZAZEL', 'LAZARUS', 'EDEN', 'THE_LOST', 'LAZARUS2', 'BLACK_JUDAS', 'LILITH', 'KEEPER', 'APOLLYON', 'THE_FORGOTTEN', 'THE_SOUL', 'BETHANY', 'JACOB', 'ESAU',
  'ISAAC', 'MAGDALENE', 'CAIN', 'JUDAS', 'BLUEBABY', 'EVE', 'SAMSON', 'AZAZEL', 'LAZARUS', 'EDEN', 'THE_LOST', 'LILITH', 'KEEPER', 'APOLLYON', 'THE_FORGOTTEN', 'BETHANY', 'JACOB', 'LAZARUS', 'JACOB', 'THE_FORGOTTEN'];

// Mismas etiquetas que Rebirth Item Tracker. Fila por capítulo; columna por m_StageType.
const CHAPTERS = [
  ['B', 'B', 'B', null, 'Do', 'Do'],
  ['C', 'C', 'C', null, 'Mi', 'Mi'],
  ['D', 'D', 'D', null, 'Ma', 'Ma'],
  ['W', 'W', 'W', null, 'Co', 'Co'],
];
const LATE_FLOORS = { 9: () => 'HUSH', 10: t => (t ? 'CATH' : 'SHEOL'), 11: t => (t ? 'CHEST' : 'DARK'), 12: () => 'VOID', 13: () => 'HOME' };

function floorLabel({ stage, type, xl }) {
  if (stage > 8) return LATE_FLOORS[stage] ? LATE_FLOORS[stage](type) : String(stage);
  const chapter = (CHAPTERS[(stage - 1) >> 1] || [])[type];
  if (!chapter) return String(stage);
  if (xl) return chapter + 'XL';
  return chapter + (stage % 2 ? 1 : 2);
}

// Nombre corto en inglés y clave del stringtable. Super Bum no tiene clave propia en el juego.
const TRANSFORMS = {
  guppy: ['Guppy', 'GUPPY'], bob: ['Bob', 'BOB'], conjoined: ['Conjoined', 'CONJOINED'], funguy: ['Fun Guy', 'FUN_GUY'], leviathan: ['Leviathan', 'LEVIATHAN'],
  ohcrap: ['Oh Crap', 'OH_CRAP'], seraphim: ['Seraphim', 'SERAPHIM'], spun: ['Spun', 'SPUN'], yesmother: ['Mom', 'YES_MOTHER'], superbum: ['Super Bum', null],
  beelzebub: ['Beelzebub', 'BEELZEBUB'], bookworm: ['Bookworm', 'BOOK_WORM'], spiderbaby: ['Spider Baby', 'SPIDER_BABY'],
};
const TRANSFORM_GOAL = 3;

const STATS = ['dmg', 'dmg_x', 'tears', 'tears_x', 'health', 'soul_hearts', 'sin_hearts', 'bone_hearts', 'speed', 'shot_speed', 'range', 'height', 'luck'];

// Columna de cada idioma en el stringtable. El juego no trae portugués: se usan los nombres en inglés.
const STRINGTABLE_COLUMNS = { en: 'English', es: 'Spanish', fr: 'French', ru: 'Russian' };

const TRINKET_OFFSET = 2000;
const ITEM_TAG = /<(?:passive|active|familiar)\b[^>]*>/g;
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = s => s.replace(/&(lt|gt|amp|quot|apos);/g, (_, e) => ENTITIES[e]);

const cleanAchievementName = s => s
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/^You unlocked (?:the )?/, '').replace(/ has appeared in the basement$/, '')
  .replace(/^"(.*)"$/, '$1');

// Devuelve key -> textos por idioma ({ en, es, fr, ru }). Sin el archivo, todo se queda en inglés.
function loadStringTable(resDir) {
  let xml;
  try { xml = fs.readFileSync(path.join(resDir, 'stringtable.sta'), 'utf8'); } catch { return new Map(); }
  const order = [...xml.matchAll(/<language\b[^>]*\bindex="(\d+)"[^>]*\bname="([^"]*)"/g)].map(m => ({ index: +m[1], name: m[2] }));
  const column = {};
  for (const [lang, name] of Object.entries(STRINGTABLE_COLUMNS)) {
    const l = order.find(x => x.name === name);
    if (l) column[lang] = l.index - 1; // El índice 0 es la propia clave, que no tiene <string>.
  }
  const table = new Map();
  for (const [, key, body] of xml.matchAll(/<key name="([^"]+)">([\s\S]*?)<\/key>/g)) {
    const strings = [...body.matchAll(/<string>([\s\S]*?)<\/string>|<string\s*\/>/g)].map(m => decode(m[1] || ''));
    const entry = {};
    for (const [lang, i] of Object.entries(column)) if (strings[i]) entry[lang] = strings[i];
    table.set(key, entry);
  }
  return table;
}

// Descripciones traducidas: data/descriptions/<idioma>.json usa los mismos números que en.json.
function loadDescriptions() {
  const read = lang => { const b = readAsset(`data/descriptions/${lang}.json`); return b ? JSON.parse(b.toString('utf8')) : {}; };
  const source = read('en');
  const byText = {};
  for (const lang of Object.keys(LANGUAGES)) {
    if (lang === 'en') continue;
    const tr = read(lang), map = new Map();
    for (const [n, text] of Object.entries(source)) if (tr[n]) map.set(text, tr[n]);
    byText[lang] = map;
  }
  return (lang, text) => (byText[lang] && byText[lang].get(text)) || text;
}

// items.xml nombra los iconos con mayúsculas (Collectibles_001_TheSadOnion.png) y el ResourceExtractor los deja en
// minúsculas. Windows no distingue unas de otras, pero el paquete del .exe (app.asar) sí: se usa el nombre real del
// archivo. Devuelve gfx -> ruta relativa a resDir (o la del xml si la carpeta no se puede leer).
function iconFinder(resDir, dir) {
  let real = new Map();
  try { real = new Map(fs.readdirSync(path.join(resDir, dir)).map(f => [f.toLowerCase(), f])); } catch { /* sin carpeta */ }
  return gfx => path.join(dir, real.get(gfx.toLowerCase()) || gfx);
}

function loadGameData(resDir) {
  const info = JSON.parse(readAsset('data/items.json').toString('utf8'));
  const icons = new Map(), nameKeys = new Map(), collection = [];
  const itemsXml = fs.readFileSync(path.join(resDir, 'items.xml'), 'latin1');
  const actives = new Set([...itemsXml.matchAll(/<active\b[^>]*?\bid="(\d+)"/g)].map(m => +m[1]));
  const quests = new Set([...fs.readFileSync(path.join(resDir, 'items_metadata.xml'), 'latin1').matchAll(/<item\b[^>]*>/g)]
    .filter(([tag]) => /tags="[^"]*\bquest\b/.test(tag)).map(([tag]) => +/\bid="(\d+)"/.exec(tag)[1]));
  const collectibleIcon = iconFinder(resDir, path.join('gfx', 'items', 'collectibles'));
  const trinketIcon = iconFinder(resDir, path.join('gfx', 'items', 'trinkets'));
  const keyOf = tag => { const n = attr(tag, 'name'); return n && n.startsWith('#') ? n.slice(1) : null; };
  for (const [tag] of itemsXml.matchAll(ITEM_TAG)) {
    const id = +attr(tag, 'id');
    const gfx = attr(tag, 'gfx');
    if (gfx) icons.set(id, collectibleIcon(gfx));
    if (keyOf(tag)) nameKeys.set(id, keyOf(tag));
    if (id !== 59) collection.push(id); // 59 (Book of Belial pasivo) nunca aparece en la colección del juego.
  }
  for (const [tag] of itemsXml.matchAll(/<trinket\b[^>]*>/g)) {
    const id = TRINKET_OFFSET + +attr(tag, 'id');
    const gfx = attr(tag, 'gfx');
    if (gfx) icons.set(id, trinketIcon(gfx));
    if (keyOf(tag)) nameKeys.set(id, keyOf(tag));
  }
  const achievements = new Map();
  const achXml = fs.readFileSync(path.join(resDir, 'achievements.xml'), 'utf8');
  for (const [tag] of achXml.matchAll(/<achievement\b[^>]*>/g)) {
    const quoted = n => (tag.match(new RegExp(`\\b${n}=(?:"([^"]*)"|'([^']*)')`)) || []).slice(1).find(v => v !== undefined);
    achievements.set(+quoted('id'), { name: cleanAchievementName(quoted('steam_name') || quoted('text') || '') });
  }

  const strings = loadStringTable(resDir);
  const translateDescription = loadDescriptions();
  const fromTable = (key, lang) => { const e = key && strings.get(key); return (e && e[lang]) || null; };
  // Casi todos los logros vigilados se llaman como un objeto o personaje: se reutiliza su traducción.
  const byEnglishName = new Map();
  // Los que se llaman como un personaje (sus desbloqueos) no se traducen: los personajes conservan su nombre original.
  const characterKeys = new Set(CHARACTER_KEYS.map(k => k + '_NAME'));
  for (const [key, e] of strings) if (/_NAME$/.test(key) && !characterKeys.has(key) && e.en && !byEnglishName.has(e.en.toLowerCase())) byEnglishName.set(e.en.toLowerCase(), key);

  const itemName = (id, lang, fallback) => {
    const english = (info[id] && info[id].name) || fallback || fromTable(nameKeys.get(id), 'en');
    if (lang === 'en' || lang === 'pt') return english || `#${id}`;
    return fromTable(nameKeys.get(id), lang) || english || `#${id}`;
  };
  // Los personajes se llaman igual en todos los idiomas: con su nombre original, en inglés.
  const characterName = index => CHARACTERS[index] || '';
  const transformName = (id, lang) => {
    const [english, key] = TRANSFORMS[id];
    const local = lang !== 'en' && lang !== 'pt' && fromTable(key && 'TRANSFORMATION_' + key, lang);
    return local ? local.replace(/[¡!¿?]/g, '').replace(/\s+/g, ' ').trim() : english;
  };
  const achievementName = (id, lang) => {
    const english = (achievements.get(id) || {}).name || `#${id}`;
    const own = t(lang, 'ach.' + id, null, null);
    if (own) return own;
    if (lang === 'en' || lang === 'pt') return english;
    return fromTable(byEnglishName.get(english.toLowerCase()), lang) || english;
  };
  const describe = (id, lang) => {
    const it = info[id];
    if (!it) return '';
    const stats = STATS.filter(k => it[k]).map(k => `${t(lang, 'stat.' + k)} ${/^-/.test(it[k]) || k.endsWith('_x') ? '' : '+'}${it[k]}`);
    return [...stats, it.text && translateDescription(lang, it.text)].filter(Boolean).join(', ');
  };
  return { info, icons, collection, actives, quests, achievements, itemName, characterName, transformName, achievementName, describe };
}

module.exports = { loadGameData, floorLabel, CHARACTERS, TRANSFORMS, TRANSFORM_GOAL };
