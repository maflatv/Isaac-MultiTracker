// Datos de consulta: nombres e iconos del juego, y descripciones de items.json (Rebirth Item Tracker).
const fs = require('fs');
const path = require('path');

const CHARACTERS = ['Isaac', 'Magdalene', 'Cain', 'Judas', '???', 'Eve', 'Samson', 'Azazel', 'Lazarus', 'Eden', 'The Lost', 'Lazarus II', 'Dark Judas', 'Lilith', 'Keeper', 'Apollyon', 'The Forgotten', 'The Soul', 'Bethany', 'Jacob', 'Esau',
  'T. Isaac', 'T. Magdalene', 'T. Cain', 'T. Judas', 'T. ???', 'T. Eve', 'T. Samson', 'T. Azazel', 'T. Lazarus', 'T. Eden', 'T. Lost', 'T. Lilith', 'T. Keeper', 'T. Apollyon', 'T. Forgotten', 'T. Bethany', 'T. Jacob', 'T. Lazarus', 'T. Jacob', 'T. Forgotten'];

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

const TRANSFORMS = {
  guppy: 'Guppy', bob: 'Bob', conjoined: 'Conjoined', funguy: 'Fun Guy', leviathan: 'Leviathan', ohcrap: 'Oh Crap', seraphim: 'Seraphim',
  spun: 'Spun', yesmother: 'Mom', superbum: 'Super Bum', beelzebub: 'Beelzebub', bookworm: 'Bookworm', spiderbaby: 'Spider Baby',
};
const TRANSFORM_GOAL = 3;

const STAT_LABELS = [
  ['dmg', 'DMG'], ['dmg_x', 'DMG x'], ['tears', 'Tears'], ['tears_x', 'Tears x'], ['health', 'Vida'], ['soul_hearts', 'Almas'], ['sin_hearts', 'Negros'],
  ['bone_hearts', 'Huesos'], ['speed', 'Velocidad'], ['shot_speed', 'V. disparo'], ['range', 'Alcance'], ['height', 'Altura'], ['luck', 'Suerte'],
];

const TRINKET_OFFSET = 2000;
const ITEM_TAG = /<(?:passive|active|familiar)\b[^>]*>/g;
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];

const cleanAchievementName = s => s
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/^You unlocked (?:the )?/, '').replace(/ has appeared in the basement$/, '')
  .replace(/^"(.*)"$/, '$1');

function loadGameData(resDir) {
  const info = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'items.json'), 'utf8'));
  const icons = new Map(), collection = [];
  const actives = new Set([...fs.readFileSync(path.join(resDir, 'items.xml'), 'latin1').matchAll(/<active\b[^>]*?\bid="(\d+)"/g)].map(m => +m[1]));
  const quests = new Set([...fs.readFileSync(path.join(resDir, 'items_metadata.xml'), 'latin1').matchAll(/<item\b[^>]*>/g)]
    .filter(([tag]) => /tags="[^"]*\bquest\b/.test(tag)).map(([tag]) => +/\bid="(\d+)"/.exec(tag)[1]));
  const itemsXml = fs.readFileSync(path.join(resDir, 'items.xml'), 'latin1');
  for (const [tag] of itemsXml.matchAll(ITEM_TAG)) {
    const id = +attr(tag, 'id');
    const gfx = attr(tag, 'gfx');
    if (gfx) icons.set(id, path.join('gfx', 'items', 'collectibles', gfx));
    if (id !== 59) collection.push(id); // 59 (Book of Belial pasivo) nunca aparece en la colección del juego.
  }
  for (const [tag] of itemsXml.matchAll(/<trinket\b[^>]*>/g)) {
    const gfx = attr(tag, 'gfx');
    if (gfx) icons.set(TRINKET_OFFSET + +attr(tag, 'id'), path.join('gfx', 'items', 'trinkets', gfx));
  }
  const achievements = new Map();
  const achXml = fs.readFileSync(path.join(resDir, 'achievements.xml'), 'utf8');
  for (const [tag] of achXml.matchAll(/<achievement\b[^>]*>/g)) {
    const quoted = n => (tag.match(new RegExp(`\\b${n}=(?:"([^"]*)"|'([^']*)')`)) || []).slice(1).find(v => v !== undefined);
    achievements.set(+quoted('id'), { name: cleanAchievementName(quoted('steam_name') || quoted('text') || '') });
  }

  const describe = id => {
    const it = info[id];
    if (!it) return '';
    const stats = STAT_LABELS.filter(([k]) => it[k]).map(([k, label]) => `${label} ${/^-/.test(it[k]) || k.endsWith('_x') ? '' : '+'}${it[k]}`);
    return [...stats, it.text].filter(Boolean).join(', ');
  };
  return { info, icons, collection, actives, quests, achievements, describe };
}

module.exports = { loadGameData, floorLabel, CHARACTERS, TRANSFORMS, TRANSFORM_GOAL };
