// Rutas de splits de la edición avanzada: qué hay que conseguir en el guardado para cerrar cada segmento.
// Lógica pura (sin archivos ni red): la usan lib/splitter.js y las pruebas.
const { CHUNK, MARK_COUNTERS } = require('./save.js');

// Columnas de MARK_COUNTERS (EventCounter de REPENTOGON): una por jefe o final.
const BOSSES = ['heart', 'isaac', 'satan', 'bossrush', 'bluebaby', 'lamb', 'megasatan', 'greed', 'hush', 'delirium', 'mother', 'beast'];
const GREED = BOSSES.indexOf('greed');
// Filas de MARK_COUNTERS: los 17 personajes normales y luego sus versiones tainted, en el mismo orden.
const MARK_CHARACTERS = ['Isaac', 'Magdalene', 'Cain', 'Judas', '???', 'Eve', 'Samson', 'Azazel', 'Lazarus', 'Eden', 'The Lost', 'Lilith', 'Keeper', 'Apollyon', 'The Forgotten', 'Bethany', 'Jacob & Esau'];
const TAINTED = MARK_CHARACTERS.length;
const characterLabel = row => (row >= TAINTED ? 'T. ' : '') + MARK_CHARACTERS[row % TAINTED];

// Contadores (EventCounter) y logros que usan las rutas.
const COUNTER = { momsHeartKills: 1, deaths: 10 };
const ACH = { firstMom: 4, deadGod: 637 };
// Niveles de una marca: 1 normal (Greed en Greed), 2 difícil (Greedier en Greed).
const LEVEL = { any: 1, hard: 2 };

// ---------- Condiciones ----------
// { t: 'ach', id }             logro conseguido
// { t: 'challenge', id }       reto completado
// { t: 'mark', row, col, min } marca de un personaje contra un jefe (min: 1 normal, 2 difícil)
// { t: 'counter', id, min }    contador del juego mayor o igual que min
// { t: 'achCount', min }       al menos min logros
// { t: 'collection' }          colección completa
const TYPES = ['ach', 'challenge', 'mark', 'counter', 'achCount', 'collection'];
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Solo condiciones conocidas y con valores válidos: las rutas llegan del panel o de un archivo.
function cleanCondition(c) {
  if (!c || !TYPES.includes(c.t)) return null;
  if (c.t === 'ach' || c.t === 'challenge') return isInt(c.id, 1, 9999) ? { t: c.t, id: c.id } : null;
  if (c.t === 'mark') return isInt(c.row, 0, MARK_COUNTERS.length - 1) && isInt(c.col, 0, BOSSES.length - 1) && isInt(c.min, 1, 2) ? { t: 'mark', row: c.row, col: c.col, min: c.min } : null;
  if (c.t === 'counter') return isInt(c.id, 0, 9999) && isInt(c.min, 1, 1e9) ? { t: 'counter', id: c.id, min: c.min } : null;
  if (c.t === 'achCount') return isInt(c.min, 1, 9999) ? { t: 'achCount', min: c.min } : null;
  return { t: 'collection' };
}

// Lo que hace falta del guardado para comprobar condiciones. chunks: resultado de parseSave(); collection: ids de la colección.
function saveFacts(chunks, collection) {
  const ach = chunks[CHUNK.achievements], counters = chunks[CHUNK.counters];
  const seen = chunks[CHUNK.collectibles], challenges = chunks[CHUNK.challenges];
  return {
    ach: id => ach[id] === 1,
    achCount: ach.slice(1).filter(Boolean).length,
    challenge: id => !!challenges[id],
    counter: id => counters[id] || 0,
    // Los 2 bits bajos de la marca: 0 nada, 1 normal, 2 o más difícil.
    mark: (row, col) => (counters[MARK_COUNTERS[row][col]] || 0) & 3,
    collection: collection.every(id => seen[id]),
  };
}

function met(c, f) {
  switch (c.t) {
    case 'ach': return f.ach(c.id);
    case 'challenge': return f.challenge(c.id);
    case 'mark': return f.mark(c.row, c.col) >= c.min;
    case 'counter': return f.counter(c.id) >= c.min;
    case 'achCount': return f.achCount >= c.min;
    case 'collection': return f.collection;
    default: return false;
  }
}

// Un segmento sin condiciones nunca se cierra solo: queda para el split a mano.
const segmentDone = (seg, f) => seg.conds.length > 0 && seg.conds.every(c => met(c, f));

// ---------- Nombres de la ruta → condiciones ----------
const CHARACTER_ALIASES = [
  [/^isaac$/, 0], [/^(maggy|magdalene|mag|magda)$/, 1], [/^cain$/, 2], [/^judas$/, 3], [/^(bb|\?\?\?|blue ?baby)$/, 4], [/^eve$/, 5],
  [/^samson$/, 6], [/^azazel$/, 7], [/^(lazarus|laz)$/, 8], [/^eden$/, 9], [/^(the )?lost$/, 10], [/^lilith$/, 11], [/^keeper$/, 12],
  [/^apollyon$/, 13], [/^(the )?forgotten$/, 14], [/^bethany$/, 15], [/^(j ?& ?e|j and e|jacob( (&|and) esau)?)$/, 16],
];
// Palabras de cada jefe dentro del nombre. «greedier» va antes que «greed» para no confundirlos.
const BOSS_WORDS = [
  ['greedier', GREED, LEVEL.hard], ['greed', GREED, LEVEL.any], ["mom'?s heart|heart|mh", 0], ['isaac', 1], ['satan', 2], ['boss ?rush|br', 3],
  ['chest|\\?\\?\\?|blue ?baby', 4], ['lamb|dark ?room', 5], ['mega ?satan|ms', 6], ['hush', 8], ['delirium|deli|del', 9], ['mother', 10], ['beast', 11],
];
const bossWord = w => BOSS_WORDS.find(([re]) => new RegExp(`^(${re})$`).test(w));

function characterRow(name) {
  const m = /^(?:t\.\s*|tainted\s+)?(.+)$/i.exec(name.trim());
  const tainted = /^(t\.|tainted\s)/i.test(name.trim());
  const base = m[1].trim().toLowerCase();
  const hit = CHARACTER_ALIASES.find(([re]) => re.test(base));
  return hit ? hit[1] + (tainted ? TAINTED : 0) : null;
}

// Marcas de «All»: las 12, en difícil (Greedier en Greed), menos las excluidas con «no X».
function allMarks(row, excluded, greedOnlyNormal) {
  const conds = [];
  for (let col = 0; col < BOSSES.length; col++) {
    if (excluded.has(col)) continue;
    conds.push({ t: 'mark', row, col, min: col === GREED && greedOnlyNormal ? LEVEL.any : LEVEL.hard });
  }
  return conds;
}

// Logro que desbloquea algo nombrado en la ruta («Bethany», «unlock maggy»): por su nombre o, si es un personaje con
// otro nombre corto, por el del personaje. findAchievement(texto) devuelve el id o null.
function unlockOf(word, findAchievement) {
  if (!findAchievement) return null;
  const row = characterRow(word);
  return findAchievement(word) || (row !== null && row < TAINTED ? findAchievement(MARK_CHARACTERS[row].replace(' & ', ' and ')) : null);
}

// Deduce las condiciones de un segmento por su nombre. Devuelve { conds, sure }: sure es false si una parte del nombre
// no se entendió (hay que revisarlo en el editor). Sin nada reconocible, conds queda vacío.
// findAchievement(texto): id del logro con ese nombre, para los desbloqueos que nombra la ruta.
function guessConditions(rawName, findAchievement) {
  const name = String(rawName || '').replace(/^\s*\*\s*/, '').trim();
  const low = name.toLowerCase();
  let m;
  if ((m = /^(\d{1,2})\.\s*\S/.exec(name))) return { conds: [{ t: 'challenge', id: +m[1] }], sure: true };
  if (/^dead ?god%?$/.test(low)) return { conds: [{ t: 'ach', id: ACH.deadGod }], sure: true };
  if (/^first mom$/.test(low)) return { conds: [{ t: 'ach', id: ACH.firstMom }], sure: true };
  if ((m = /^mom'?s heart\s*(\d+)$/.exec(low))) return { conds: [{ t: 'counter', id: COUNTER.momsHeartKills, min: +m[1] }], sure: true };
  if ((m = /^(\d+)\s*deaths?$/.exec(low))) return { conds: [{ t: 'counter', id: COUNTER.deaths, min: +m[1] }], sure: true };
  if (/^(full )?collection( complete)?$/.test(low)) return { conds: [{ t: 'collection' }], sure: true };

  const dash = /^(.+?)\s*-\s*(.*)$/.exec(name);
  const row = dash ? characterRow(dash[1]) : null;
  if (row === null) return { conds: [], sure: false };
  let spec = dash[2].toLowerCase();
  let sure = true;
  // Exclusiones: «no greed», «noBR», «no del». «no reset» y similares no son jefes y se ignoran.
  const excluded = new Set();
  let greedOnlyNormal = false;
  spec = spec.replace(/\bno\s*([a-z?']+(?: ?rush| ?satan| ?baby)?)/g, (all, word) => {
    if (word === 'greedier') greedOnlyNormal = true;
    else { const b = bossWord(word); if (b) excluded.add(b[1]); }
    return '';
  });
  const conds = [];
  const add = c => { if (!conds.some(x => x.t === c.t && x.id === c.id && x.row === c.row && x.col === c.col)) conds.push(c); };
  // «unlock X»: además de lo demás, el logro que desbloquea X.
  spec = spec.replace(/\bunlock\s+(.+?)(?=,|$)/g, (all, what) => {
    const id = unlockOf(what.trim(), findAchievement);
    if (id) add({ t: 'ach', id }); else sure = false;
    return '';
  });
  for (const part of spec.split(/[,&/+]| and /)) {
    const word = part.replace(/[?¿!]+/g, '').trim();
    if (!word) continue;
    if (/^all\b/.test(word)) { for (const c of allMarks(row, excluded, greedOnlyNormal)) add(c); continue; }
    const b = bossWord(word);
    const unlock = !b && unlockOf(word, findAchievement);
    if (b) add({ t: 'mark', row, col: b[1], min: b[2] || LEVEL.any });
    else if (unlock) add({ t: 'ach', id: unlock });
    else sure = false;
  }
  return { conds, sure: sure && conds.length > 0 };
}

// ---------- Archivos .lss de LiveSplit ----------
const XML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unxml = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (all, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1));
  return XML_ENTITIES[e.toLowerCase()];
});
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Lee los nombres de los segmentos (y el juego y la categoría) de un .lss.
function readLss(text) {
  const body = String(text || '');
  if (!/<Run\b/.test(body) || !/<Segments>/.test(body)) throw new Error('err.lss');
  const tag = n => { const m = new RegExp(`<${n}>([\\s\\S]*?)</${n}>`).exec(body); return m ? unxml(m[1]).trim() : ''; };
  const segments = [...body.matchAll(/<Segment>\s*<Name>([\s\S]*?)<\/Name>/g)].map(m => unxml(m[1]).trim());
  if (!segments.length) throw new Error('err.lss');
  return { game: tag('GameName'), category: tag('CategoryName'), segments };
}

// Un .lss nuevo con los segmentos de la ruta, listo para abrir en LiveSplit.
function writeLss({ game, category, segments }) {
  const seg = name => `    <Segment>\n      <Name>${xml(name)}</Name>\n      <Icon />\n      <SplitTimes>\n        <SplitTime name="Personal Best" />\n      </SplitTimes>\n      <BestSegmentTime />\n      <SegmentHistory />\n    </Segment>\n`;
  return '<?xml version="1.0" encoding="UTF-8"?>\n<Run version="1.7.0">\n  <GameIcon />\n'
    + `  <GameName>${xml(game || 'The Binding of Isaac: Repentance+')}</GameName>\n  <CategoryName>${xml(category || 'DeadGod%')}</CategoryName>\n`
    + '  <LayoutPath>\n  </LayoutPath>\n  <Metadata>\n    <Run id="" />\n    <Platform usesEmulator="False">\n    </Platform>\n    <Region>\n    </Region>\n    <Variables />\n    <CustomVariables />\n  </Metadata>\n'
    + '  <Offset>00:00:00</Offset>\n  <AttemptCount>0</AttemptCount>\n  <AttemptHistory />\n  <Segments>\n'
    + segments.map(seg).join('') + '  </Segments>\n  <AutoSplitterSettings />\n</Run>\n';
}

// ---------- Rutas generadas ----------
const deadGodSegment = () => ({ name: 'DEAD GOD', conds: [{ t: 'ach', id: ACH.deadGod }] });

// Una por personaje (todas sus marcas en difícil), en el orden del juego.
function routeByCharacter() {
  const segments = MARK_COUNTERS.map((_, row) => ({ name: characterLabel(row), conds: allMarks(row, new Set(), false) }));
  return [...segments, deadGodSegment()];
}

// Cada «size» logros (por ejemplo, 64 = un 10 % aproximadamente). total: logros del juego.
function routeByBlocks(size, total) {
  const segments = [];
  for (let n = size; n < total; n += size) segments.push({ name: `${n} / ${total}`, conds: [{ t: 'achCount', min: n }] });
  return [...segments, deadGodSegment()];
}

// Por tipo de objetivo: retos, marcas en difícil, Mom's Heart, muertes, colección y, al final, Dead God.
function routeByType(challengeCount) {
  const challenges = Array.from({ length: challengeCount }, (_, i) => ({ t: 'challenge', id: i + 1 }));
  const marks = MARK_COUNTERS.flatMap((_, row) => allMarks(row, new Set(), false));
  return [
    { name: 'Challenges', conds: challenges },
    { name: 'Hard marks', conds: marks },
    { name: "Mom's Heart x11", conds: [{ t: 'counter', id: COUNTER.momsHeartKills, min: 11 }] },
    { name: '100 deaths', conds: [{ t: 'counter', id: COUNTER.deaths, min: 100 }] },
    { name: 'Full collection', conds: [{ t: 'collection' }] },
    deadGodSegment(),
  ];
}

// Por partida: «count» segmentos de partida y Dead God al final. Las condiciones no se usan (los cierra el log).
function routeByRuns(count) {
  return [...Array.from({ length: count }, (_, i) => ({ name: `Run ${i + 1}`, conds: [] })), deadGodSegment()];
}

// Capítulo de un piso (m_Stage): los pisos 1-8 van de dos en dos; del 9 en adelante, cada uno es el suyo.
const chapterOf = stage => (stage <= 8 ? Math.ceil(stage / 2) : stage - 4);

module.exports = {
  BOSSES, MARK_CHARACTERS, TAINTED, COUNTER, ACH, LEVEL, characterLabel, cleanCondition, saveFacts, met, segmentDone,
  guessConditions, readLss, writeLss, routeByCharacter, routeByBlocks, routeByType, routeByRuns, chapterOf,
};
