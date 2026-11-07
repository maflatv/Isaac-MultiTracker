// Lector de rep+persistentgamedataN.dat (solo lectura): progreso permanente hacia Dead God.
const fs = require('fs');
const path = require('path');

const HEADER = 'ISAACNGSAVE';
const FIRST_CHUNK = 0x14;
// Bytes por elemento de cada bloque: el campo de tamaño del archivo no siempre coincide con los datos.
const ELEMENT_SIZE = { 1: 1, 2: 4, 3: 4, 4: 1, 5: 1, 6: 1, 7: 1, 8: 4, 9: 4, 10: 1, 11: 1 };
const CHUNK = { achievements: 1, counters: 2, collectibles: 4, challenges: 7 };
// EventCounter.STREAK_COUNTER y BEST_STREAK en enums_ex.lua de REPENTOGON.
const WIN_STREAK_COUNTER = 22;
const BEST_STREAK_COUNTER = 23;

// Contadores de marcas: una fila por personaje y una columna por jefe.
const MARK_COUNTERS = [
  [27, 41, 55, 69, 83, 97, 116, 130, 144, 173, 423, 457], [28, 42, 56, 70, 84, 98, 117, 131, 145, 174, 424, 458],
  [29, 43, 57, 71, 85, 99, 118, 132, 146, 175, 425, 459], [30, 44, 58, 72, 86, 100, 119, 133, 147, 176, 426, 460],
  [31, 45, 59, 73, 87, 101, 120, 134, 148, 177, 427, 461], [32, 46, 60, 74, 88, 102, 121, 135, 149, 178, 428, 462],
  [33, 47, 61, 75, 89, 103, 122, 136, 150, 179, 429, 463], [34, 48, 62, 76, 90, 104, 123, 137, 151, 180, 430, 464],
  [35, 49, 63, 77, 91, 105, 124, 138, 152, 181, 431, 465], [36, 50, 64, 78, 92, 106, 125, 139, 153, 182, 432, 466],
  [37, 51, 65, 79, 93, 107, 126, 140, 154, 183, 433, 467], [38, 52, 66, 80, 94, 108, 127, 141, 155, 184, 434, 468],
  [39, 53, 67, 81, 95, 109, 128, 142, 156, 185, 435, 469], [40, 54, 68, 82, 96, 110, 129, 143, 157, 186, 436, 470],
  [203, 204, 205, 206, 207, 208, 209, 210, 211, 213, 437, 471], [214, 233, 252, 271, 290, 309, 328, 347, 366, 404, 438, 472],
  [215, 234, 253, 272, 291, 310, 329, 348, 367, 405, 439, 473], [216, 235, 254, 273, 292, 311, 330, 349, 368, 406, 440, 474],
  [217, 236, 255, 274, 293, 312, 331, 350, 369, 407, 441, 475], [218, 237, 256, 275, 294, 313, 332, 351, 370, 408, 442, 476],
  [219, 238, 257, 276, 295, 314, 333, 352, 371, 409, 443, 477], [220, 239, 258, 277, 296, 315, 334, 353, 372, 410, 444, 478],
  [221, 240, 259, 278, 297, 316, 335, 354, 373, 411, 445, 479], [222, 241, 260, 279, 298, 317, 336, 355, 374, 412, 446, 480],
  [223, 242, 261, 280, 299, 318, 337, 356, 375, 413, 447, 481], [224, 243, 262, 281, 300, 319, 338, 357, 376, 414, 448, 482],
  [225, 244, 263, 282, 301, 320, 339, 358, 377, 415, 449, 483], [226, 245, 264, 283, 302, 321, 340, 359, 378, 416, 450, 484],
  [227, 246, 265, 284, 303, 322, 341, 360, 379, 417, 451, 485], [228, 247, 266, 285, 304, 323, 342, 361, 380, 418, 452, 486],
  [229, 248, 267, 286, 305, 324, 343, 362, 381, 419, 453, 487], [230, 249, 268, 287, 306, 325, 344, 363, 382, 420, 454, 488],
  [231, 250, 269, 288, 307, 326, 345, 364, 383, 421, 455, 489], [232, 251, 270, 289, 308, 327, 346, 365, 384, 422, 456, 490],
];

// Logros que dependen de un contador acumulado.
const COUNTER_GOALS = [
  { id: 'c64', achievement: 64, counter: 14, goal: 100, name: 'Trileros jugados' },
  { id: 'c354', achievement: 354, counter: 193, goal: 7, name: 'Retos diarios completados' },
  { id: 'c382', achievement: 382, counter: 201, goal: 5, name: 'Rubber Cement recogido' },
  { id: 'c385', achievement: 385, counter: 202, goal: 10, name: 'Veces dormido en cama' },
  { id: 'c523', achievement: 523, counter: 495, goal: 5, name: 'Objetos de Battery Bum' },
  { id: 'c336', achievement: 336, counter: 192, goal: 5, name: 'Diarios seguidos' },
  { id: 'c147', achievement: 147, counter: 17, goal: 30, name: 'Donaciones de sangre' },
  { id: 'c36', achievement: 36, counter: 7, goal: 4, name: 'XIII - Death usada' },
  { id: 'c148', achievement: 148, counter: 18, goal: 30, name: 'Tragaperras destruidas' },
  { id: 'c545', achievement: 545, counter: 494, goal: 10, name: 'Battery Bums eliminados' },
  { id: 'c377', achievement: 377, counter: 200, goal: 10, name: 'Blood Clot recogido' },
  { id: 'c138', achievement: 138, counter: 20, goal: 999, name: 'Monedas en máquina de donación' },
  { id: 'c12', achievement: 12, counter: 3, goal: 100, name: 'Rocas marcadas destruidas' },
  { id: 'c34', achievement: 34, counter: 1, goal: 11, name: "Mom's Heart derrotado" },
  { id: 'c57', achievement: 57, counter: 11, goal: 5, name: 'Isaac derrotado' },
  { id: 'c66', achievement: 66, counter: 15, goal: 10, name: 'Objetos de sala de ángel' },
  { id: 'c78', achievement: 78, counter: 13, goal: 5, name: 'Satan derrotado' },
  { id: 'c407', achievement: 407, counter: 158, goal: 3, name: 'Hush derrotado' },
  { id: 'c409', achievement: 409, counter: 493, goal: 10, name: 'Baby Plum derrotado' },
];

// Logros secretos que suele interesar vigilar por separado.
const WATCHED_ACHIEVEMENTS = [23, 24, 25, 19, 27, 82, 258, 324, 337, 361, 366, 378, 384, 386, 406, 65, 1, 389, 326, 330, 327, 155, 408, 410, 276, 547, 583, 635];

// Partes un archivo en bloques. Lanza un error si está incompleto (por ejemplo, si el juego lo está escribiendo).
function parseSave(buf) {
  if (buf.toString('latin1', 0, HEADER.length) !== HEADER) throw new Error('No es un guardado de Isaac');
  const chunks = {};
  let at = FIRST_CHUNK;
  while (at + 12 <= buf.length) {
    const type = buf.readInt32LE(at), count = buf.readInt32LE(at + 8), size = ELEMENT_SIZE[type];
    if (!size || count < 0) break; // Los bloques posteriores no tienen este formato y aquí no hacen falta.
    if (at + 12 + count * size > buf.length) throw new Error('Guardado incompleto');
    const start = at + 12;
    chunks[type] = size === 1
      ? Array.from(buf.subarray(start, start + count))
      : Array.from({ length: count }, (_, i) => buf.readInt32LE(start + i * 4));
    at = start + count * size;
  }
  for (const type of Object.values(CHUNK)) if (!chunks[type]) throw new Error('Guardado incompleto');
  return chunks;
}

// itemIds: objetos que cuentan para la colección.
function summarize(chunks, itemIds) {
  const ach = chunks[CHUNK.achievements], counters = chunks[CHUNK.counters];
  const seen = chunks[CHUNK.collectibles], challenges = chunks[CHUNK.challenges];
  const count = a => a.slice(1).filter(Boolean).length;
  let hard = 0, any = 0, marks = 0;
  for (const row of MARK_COUNTERS) for (const c of row) {
    const level = (counters[c] || 0) & 3; // Los 2 bits bajos: 0 nada, 1 normal, 2 o más difícil.
    marks++;
    if (level >= 2) hard++;
    if (level > 0) any++;
  }
  const achievements = { done: count(ach), total: ach.length - 1 };
  const items = { done: itemIds.filter(id => seen[id]).length, total: itemIds.length };
  const marksHard = { done: hard, total: marks };
  const challengesDone = { done: count(challenges), total: challenges.length - 1 };
  return {
    deadGod: ach[637] === 1,
    winStreak: counters[WIN_STREAK_COUNTER] || 0,
    bestStreak: counters[BEST_STREAK_COUNTER] || 0,
    complete: [achievements, items, marksHard, challengesDone].every(x => x.done >= x.total),
    achievements,
    items,
    marksHard,
    marksAny: { done: any, total: marks },
    challenges: challengesDone,
    goals: COUNTER_GOALS.map(g => ({ id: g.id, value: counters[g.counter] || 0, goal: g.goal, done: ach[g.achievement] === 1 })),
    watched: WATCHED_ACHIEVEMENTS.map(id => ({ id: 's' + id, done: ach[id] === 1 })),
  };
}

// Busca todos los guardados: uno por cuenta de Steam y ranura, más los locales si no se usa Steam Cloud.
function listSaves(steamUserdata, documentsDir) {
  const out = [];
  const addDir = (dir, account) => {
    for (const slot of [1, 2, 3]) {
      const file = path.join(dir, `rep+persistentgamedata${slot}.dat`);
      try { out.push({ id: `${account}/${slot}`, account, slot, file, mtime: fs.statSync(file).mtimeMs }); } catch { /* ranura sin guardado */ }
    }
  };
  let accounts = [];
  try { accounts = fs.readdirSync(steamUserdata); } catch { /* sin Steam */ }
  for (const a of accounts) addDir(path.join(steamUserdata, a, '250900', 'remote'), a);
  addDir(documentsDir, 'local');
  return out;
}

module.exports = { parseSave, summarize, listSaves, COUNTER_GOALS, WATCHED_ACHIEVEMENTS };
