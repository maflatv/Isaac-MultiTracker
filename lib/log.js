// Lector de log.txt: sigue la partida actual leyendo solo lo nuevo en cada consulta.
const fs = require('fs');

const RE = {
  seed: /RNG Start Seed: (\S+ \S+) \(\d+\) \[(\w+), (\d)\]/,
  player: /Initialized player with Variant \d+ and Subtype (\d+)/,
  level: /Level::Init m_Stage (\d+), m_StageType (\d+)/,
  coopSpawn: /Spawning Co-Op Player/,
  room: /- Room \d+\.\d+\((.*)\)/,
  add: /Adding collectible (\d+) \((.*?)\) to player (-?\d+)(?: \((.*?)\))?/,
  remove: /Removing collectible (\d+) (?:.*from player (-?\d+))?/,
  addTrinket: /Adding smelted trinket (\d+) \((.*?)\) to player (-?\d+)(?: \((.*?)\))?/,
  removeTrinket: /Removing smelted trinket (\d+) (?:.*from player (-?\d+))?/,
  pickup: /item taken without exchange|item queue flush/,
};
// Los trinkets absorbidos se guardan como objetos con este desplazamiento, igual que en items.json.
const TRINKET_OFFSET = 2000;
const MARK_BYTES = 256;
const JACOB_AND_ESAU = 19;
const GENESIS = 622;
const TWINS = { Jacob: 'jacob', Esau: 'esau' };
// Con varios rerolls seguidos la ráfaga es un múltiplo: con pocos pasivos no se distinguiría de una casualidad.
const MIN_PASSIVES_FOR_REPEATS = 5;
// Sube al cambiar el formato de las partidas guardadas: entonces se releen desde el log.
const SNAPSHOT_VERSION = 2;

// El juego no registra lo que quita un reroll (D4, D100, sala de dados, Missing No...): solo añade de golpe tantos
// objetos como pasivos tenía el personaje, y alguno más si salen activos. Ante la duda no se quita nada.
function isReroll(added, passives) {
  // Dos objetos seguidos también los puede dar otro efecto: por debajo de tres no se puede asegurar.
  if (passives < 2 || added < 3 || added < passives - Math.max(1, Math.floor(passives / 10))) return false;
  if (added <= passives + 3) return true;
  const times = Math.round(added / passives);
  return passives >= MIN_PASSIVES_FOR_REPEATS && Math.abs(added - times * passives) <= times + 1;
}

class RunLog {
  // saved: resultado de snapshot(). Conserva la última partida de cada ranura para recuperarla al continuar
  // tras reiniciar el juego y, si el log sigue siendo el mismo, permite seguir leyendo donde se quedó.
  // isActive: indica si un objeto es activo. Los activos se pueden soltar y recoger muchas veces.
  // isQuest: objetos de misión (Polaroid, piezas de llave...), que un reroll no cambia.
  constructor(file, saved = {}, isActive = () => false, isQuest = () => false) {
    if (saved.version !== SNAPSHOT_VERSION) saved = {};
    this.file = file;
    this.isActive = isActive;
    this.isQuest = isQuest;
    this.runs = saved.runs || {};
    this.run = null;
    this.offset = 0;
    this.tail = '';
    this.lastChar = null;
    this.changed = false;
    this.coopSpawn = false;
    this.genesisUsed = false;
    this.genesisLost = null;
    this.pickup = false;
    this.burst = {};
    if (saved.offset && saved.mark === this.mark(saved.offset)) {
      this.offset = saved.offset;
      this.tail = saved.tail || '';
      this.lastChar = saved.lastChar ?? null;
      this.run = this.runs[saved.slot] || null;
    }
  }

  // Últimos bytes antes de offset: distinguen este log de otro nuevo que haya llegado a crecer igual o más.
  mark(offset) {
    try {
      const len = Math.min(MARK_BYTES, offset), buf = Buffer.alloc(len);
      const fd = fs.openSync(this.file, 'r');
      try { fs.readSync(fd, buf, 0, len, offset - len); } finally { fs.closeSync(fd); }
      return buf.toString('latin1');
    } catch { return null; }
  }

  snapshot() {
    return { version: SNAPSHOT_VERSION, runs: this.runs, slot: this.run && this.run.slot, offset: this.offset, tail: this.tail, lastChar: this.lastChar, mark: this.mark(this.offset) };
  }

  line(l) {
    let m;
    if ((m = RE.seed.exec(l))) {
      const [, seed, mode, slot] = m;
      this.endBurst();
      const known = this.runs[slot];
      if (mode === 'Continue' && known && known.seed === seed) this.run = known;
      else {
        this.run = { seed, slot: +slot, mode, character: mode === 'Continue' ? this.lastChar : null, floors: [], items: [] };
        this.runs[slot] = this.run;
      }
    } else if (RE.coopSpawn.test(l)) {
      this.coopSpawn = true;
      return;
    } else if ((m = RE.player.exec(l))) {
      // Un jugador añadido durante la partida (Esau) no es el personaje elegido.
      if (!this.coopSpawn) this.lastChar = +m[1];
      this.coopSpawn = false;
      if (this.run && this.run.character === null) this.run.character = this.lastChar;
    } else if ((m = RE.room.exec(l))) {
      this.endBurst();
      this.enterRoom(m[1]);
      return;
    } else if (RE.pickup.test(l)) {
      this.endBurst();
      this.genesisLost = null;
      this.pickup = true;
      return;
    } else if ((m = RE.level.exec(l))) {
      this.endBurst();
      if (!this.run) return;
      const last = this.run.floors[this.run.floors.length - 1];
      if (!last || last.stage !== +m[1] || last.type !== +m[2]) this.run.floors.push({ stage: +m[1], type: +m[2], blind: false });
    } else if (l.includes('Curse of Blind')) {
      const last = this.run && this.run.floors[this.run.floors.length - 1];
      if (last) last.blind = true;
    } else if (l.includes('Curse of the Labyrinth')) {
      const last = this.run && this.run.floors[this.run.floors.length - 1];
      if (last) last.xl = true;
    } else if ((m = RE.add.exec(l))) {
      this.addCollectible(+m[1], m[2], +m[3], m[4]);
    } else if ((m = RE.addTrinket.exec(l))) {
      this.addItem(TRINKET_OFFSET + +m[1], m[2], +m[3], m[4]);
    } else if ((m = RE.remove.exec(l))) {
      if (+m[1] === GENESIS) this.genesisUsed = true;
      this.removeItem(+m[1], +(m[2] || 0));
    } else if ((m = RE.removeTrinket.exec(l))) {
      this.removeItem(TRINKET_OFFSET + +m[1], +(m[2] || 0));
    } else return;
    this.changed = true;
  }

  endBurst() {
    this.pickup = false;
    for (const [player, burst] of Object.entries(this.burst)) {
      if (isReroll(burst.count, burst.lost.length)) this.applyReroll(+player, burst);
    }
    this.burst = {};
  }

  rerollable(player) {
    return this.run.items.filter(i => (i.player || 0) === player && !i.removed && !i.soul && i.id < TRINKET_OFFSET && !this.isActive(i.id) && !this.isQuest(i.id));
  }

  applyReroll(player, { lost, added }) {
    for (const item of lost) item.removed = true;
    // Si hubo varios rerolls seguidos, solo cuenta el último.
    if (added.length > lost.length + 3) for (const item of added.slice(0, -lost.length)) item.removed = true;
    // Un activo nuevo ocupa el sitio del que ya llevaba.
    const current = added.filter(i => !i.removed && this.isActive(i.id));
    const old = this.run.items.filter(i => (i.player || 0) === player && !i.removed && !i.soul && this.isActive(i.id) && !added.includes(i));
    for (const item of old.slice(0, current.length)) item.removed = true;
    this.changed = true;
  }

  // Lo que se recoge llega tras "item queue flush"; lo demás se agrupa por si es un reroll.
  addCollectible(id, name, player, who) {
    if (!this.run) return;
    const single = this.pickup || this.genesisLost || this.ownerOf(player, who).soul;
    this.pickup = false;
    if (single) { this.addItem(id, name, player, who); return; }
    const burst = this.burst[player] || (this.burst[player] = { count: 0, lost: this.rerollable(player), added: [] });
    const item = this.addItem(id, name, player, who);
    burst.count++;
    if (item) burst.added.push(item);
    // No los ha recogido nadie: la animación solo es para lo que toma el personaje.
    if (burst.count > 1) for (const i of burst.added) i.granted = true;
  }

  // El Esau del Alma de Jacob y Esaú solo dura la sala donde aparece. El juego no registra lo que Genesis quita:
  // al entrar en su sala se pierde todo, y lo que conserva (Polaroid, piezas de llave...) se vuelve a añadir enseguida.
  enterRoom(name) {
    const genesis = this.genesisUsed && name === 'Genesis Room';
    this.genesisUsed = false;
    this.genesisLost = null;
    if (!this.run) return;
    const before = this.run.items.length;
    this.run.items = this.run.items.filter(i => !i.soul);
    if (genesis) {
      this.genesisLost = this.run.items;
      this.run.items = [];
    }
    if (this.run.items.length !== before) this.changed = true;
  }

  // Con Jacob y Esaú, Esau es el jugador 1; cualquier otro Esau viene del Alma de Jacob y Esaú.
  ownerOf(player, who) {
    const twins = this.run.character === JACOB_AND_ESAU;
    if (who === 'Esau' && (!twins || player >= 2)) return { owner: 'esau', soul: true };
    return twins && TWINS[who] ? { owner: TWINS[who] } : {};
  }

  // Lo conservado por Genesis vuelve al piso donde se tomó.
  restoreKept(id, player) {
    const n = this.genesisLost ? this.genesisLost.findIndex(i => i.id === id && (i.player || 0) === player) : -1;
    if (n < 0) return false;
    const [item] = this.genesisLost.splice(n, 1);
    const next = this.run.items.findIndex(i => i.floor > item.floor);
    this.run.items.splice(next < 0 ? this.run.items.length : next, 0, item);
    return true;
  }

  addItem(id, name, player = 0, who) {
    if (!this.run || this.restoreKept(id, player)) return;
    const owner = this.ownerOf(player, who);
    // Un activo que vuelve a recogerse sigue en el piso donde se tomó por primera vez, aunque cambie de manos.
    const held = this.isActive(id) && this.run.items.find(i => i.id === id && !i.removed && !i.soul === !owner.soul);
    if (held) { Object.assign(held, { player }, owner); return; }
    const floor = Math.max(0, this.run.floors.length - 1), f = this.run.floors[floor];
    const item = { id, name, floor, blind: !!(f && f.blind), removed: false, player, ...owner };
    this.run.items.push(item);
    return item;
  }

  removeItem(id, player = 0) {
    if (!this.run || this.isActive(id)) return;
    for (let i = this.run.items.length - 1; i >= 0; i--) {
      const item = this.run.items[i];
      if (item.id === id && !item.removed && (item.player || 0) === player) { item.removed = true; return; }
    }
  }

  // Devuelve true si llegaron datos nuevos. El juego vacía log.txt al arrancar: entonces se relee desde el inicio.
  poll() {
    const size = fs.statSync(this.file).size;
    if (size < this.offset) { this.offset = 0; this.tail = ''; this.run = null; this.burst = {}; }
    const burstSize = () => Object.values(this.burst).reduce((n, b) => n + b.count, 0);
    const pending = burstSize();
    if (size > this.offset) {
      const fd = fs.openSync(this.file, 'r');
      try {
        const buf = Buffer.alloc(size - this.offset);
        const n = fs.readSync(fd, buf, 0, buf.length, this.offset);
        this.offset += n;
        const lines = (this.tail + buf.toString('latin1', 0, n)).split('\n');
        this.tail = lines.pop();
        for (const l of lines) this.line(l);
      } finally { fs.closeSync(fd); }
    }
    // Una ráfaga se escribe de una vez: si dejó de crecer, ya ha terminado.
    if (pending && burstSize() === pending) this.endBurst();
    const changed = this.changed;
    this.changed = false;
    return changed;
  }
}

module.exports = { RunLog };
