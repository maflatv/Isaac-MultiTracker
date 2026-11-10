// Recursos del juego que usa MultiTracker (iconos, nombres y traducciones). Van incluidos con el programa en
// data/resources (unos 5 MB), así que no hace falta el juego instalado para tenerlos ni extraer nada al arrancar.
// Para actualizarlos cuando el juego añade objetos: node build/update-resources.js
const fs = require('fs');
const path = require('path');
const { APP_ROOT } = require('./runtime.js');

const BUNDLED = path.join(APP_ROOT, 'data', 'resources');

const COSTUMES = path.join('gfx', 'characters', 'costumes');
// Cabeza de quien lleva cada objeto: la hoja del personaje (su primer cuadro es la cabeza de frente, 32x32)
// y la del pelo (primer cuadro de 64x64, con la cabeza en el centro).
const OWNER_SPRITES = {
  lazarus: { head: 'character_009b_lazarus.png', hair: 'character_009b_lazarushair.png' },
  lazarus_dead: { head: 'character_009b_lazarus2.png', hair: 'character_009b_lazarus2hair.png' },
  jacob: { head: 'character_002x_jacob.png', hair: 'character_002x_jacobhair.png' },
  esau: { head: 'character_003x_esau.png', hair: 'character_003x_esauhair.png' },
  // El Keeper de Strawman no tiene hoja de pelo.
  strawman: { head: 'character_015_keeper.png' },
};
const FILES = ['items.xml', 'items_metadata.xml', 'achievements.xml', 'stringtable.sta'];
const DIRS = [path.join('gfx', 'items', 'collectibles'), path.join('gfx', 'items', 'trinkets')];
const SPRITES = Object.values(OWNER_SPRITES).flatMap(s => [s.head, s.hair]).filter(Boolean).map(f => path.join(COSTUMES, f));

// Están todos los archivos que se leen sin alternativa. Las cabezas de los personajes son opcionales: sin ellas se usa una letra.
function isComplete(dir) {
  if (!dir) return false;
  try {
    return FILES.every(f => fs.statSync(path.join(dir, f)).isFile())
      && DIRS.every(d => fs.readdirSync(path.join(dir, d)).some(f => f.endsWith('.png')));
  } catch { return false; }
}

module.exports = { BUNDLED, COSTUMES, OWNER_SPRITES, FILES, DIRS, SPRITES, isComplete };
