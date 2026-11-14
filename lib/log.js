// Lector de log.txt: sigue la partida actual leyendo solo lo nuevo en cada consulta.
const fs = require('fs');

const RE = {
  seed: /RNG Start Seed: (\S+ \S+) \(\d+\) \[(\w+), (\d)\]/,
  player: /Initialized player with Variant \d+ and Subtype (\d+)/,
  level: /Level::Init m_Stage (\d+), m_StageType (\d+)/,
  coopSpawn: /Spawning Co-Op Player/,
  // El número (tipo.variante) distingue la sala; el nombre del paréntesis se repite entre salas distintas.
  room: /- Room (\d+\.\d+)\((.*)\)/,
  // Toda entrada en una sala viene precedida de una transición (o de la seed, al empezar o continuar).
  transition: /Starting (?:room|stage) transition/,
  add: /Adding collectible (\d+) \((.*?)\) to player (-?\d+)(?: \((.*?)\))?/,
  remove: /Removing collectible (\d+) (?:.*from player (-?\d+))?/,
  addTrinket: /Adding smelted trinket (\d+) \((.*?)\) to player (-?\d+)(?: \((.*?)\))?/,
  removeTrinket: /Removing smelted trinket (\d+) (?:.*from player (-?\d+))?/,
  pickup: /item taken without exchange|item queue flush/,
  // Cambio de forma de Tainted Lazarus (al limpiar una sala o con Flip): dos veces la primera línea y luego la segunda.
  // Otros personajes también la escriben suelta o en pareja (al continuar, Clicker...): solo cuenta con él.
  swapControl: /SetControllerId\(\) Setting controller ID to 0, \(Prev: 0\)/,
  swapHud: /Assinging player entity 0 \(ControlerIndex = 0\) to HUD slot 0/,
  // Contador de la partida: empieza en 0, sigue al continuar y no avanza en pausa ni en los menús.
  frame: /\[Frame:? (\d+)\]/,
  // Para la edición avanzada (splits de LiveSplit): finales, vuelta al menú y cierre del juego.
  // La 1 es la intro del arranque; cualquier otra escena durante una partida es un final.
  cutscene: /playing cutscene (\d+) \((.*)\)/,
  menu: /Menu Manager Init/,
  shutdown: /Isaac has shut down successfully/,
  // Partidas online. En la sala del lobby llega el nombre de Steam de cada jugador; al empezar, el juego crea a cada uno
  // en orden («local» es quien juega en este PC) y ese orden es su número en «to player N».
  lobby: /Menu (?:Online Lobby|Create Lobby|Join Lobby) Init/,
  netUser: /message from user (.+?) \[(\d+)\]/,
  netLocal: /Adding local player/,
  netRemote: /Adding remote player, UserID = (\d+)/,
};
// Al acabar una partida online puede empezar un Deathmatch, que vuelve a crear a los jugadores con objetos propios:
// nada de eso es de la partida.
const DEATHMATCH_ROOM = /^Deathmatch\b/;
// Las partidas online usan la ranura 1 sin ser la partida de esa ranura: se guardan aparte para no pisarla.
const NET = 'Net';
const runKey = (mode, slot) => (mode === NET ? 'net' : String(slot));
const INTRO_CUTSCENE = 1;
// Los trinkets absorbidos se guardan como objetos con este desplazamiento, igual que en items.json.
const TRINKET_OFFSET = 2000;
const MARK_BYTES = 256;
const JACOB_AND_ESAU = 19;
const GENESIS = 622;
// Quita las maldiciones del piso al recogerlo. El juego no registra cuándo se quita una maldición: se deduce de esto,
// y de Genesis. La runa Dagaz también las quita, pero el log solo dice "Action PillCard Triggered", sin qué carta era.
const BLACK_CANDLE = 260;
// Crea un Keeper que acompaña al jugador y recoge sus propios objetos: en el log, "to player N (Keeper)" con N > 0.
// Su muerte no queda registrada, así que lo suyo no se puede quitar al morir: se marca para que no se confunda.
const STRAWMAN = 667;
const TWINS = { Jacob: 'jacob', Esau: 'esau' };
// Tainted Lazarus y su forma muerta. Las dos son "player 0 (Lazarus)" en el log: solo se distinguen siguiendo los cambios.
const TAINTED_LAZARUS = 29;
const DEAD_TAINTED_LAZARUS = 38;
const isLazarus = c => c === TAINTED_LAZARUS || c === DEAD_TAINTED_LAZARUS;
const FLIP = 711;
// Con varios rerolls seguidos la ráfaga es un múltiplo: con pocos pasivos no se distinguiría de una casualidad.
const MIN_PASSIVES_FOR_REPEATS = 5;
// Glowing Hourglass devuelve a la sala anterior tal como estaba al entrar en ella. Basta con recordar las últimas salas.
const ROOM_HISTORY = 4;
// Sube al cambiar el formato de las partidas guardadas: entonces se releen desde el log.
// 3: las partidas guardan sus frames (tiempo de juego); releer el log recupera el de la sesión actual.
// 4: los objetos de Tainted Lazarus guardan qué forma los tomó.
// 5: Flip es común a las dos formas de Tainted Lazarus (una sola vez, sin dueño).
const SNAPSHOT_VERSION = 5;

// Una instantánea de la versión anterior se convierte en vez de descartarse: el juego vacía log.txt al arrancar, así que
// los objetos de una partida continuada pueden existir ya solo aquí.
const MIGRATIONS = {
  4: saved => {
    for (const run of Object.values(saved.runs || {})) {
      if (!isLazarus(run.character)) continue;
      let seen = false;
      run.items = run.items.filter(i => {
        if (i.id !== FLIP || i.soul || (i.player || 0) !== 0) return true;
        if (seen) return false;
        seen = true;
        delete i.owner;
        return true;
      });
    }
    return { ...saved, version: 5 };
  },
};

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
  // onFrames(run): se llama cuando avanza el contador de frames de una partida (run.frames), para el tiempo de juego.
  // onEvent(type, data): momentos de la partida para los splits: start { mode, slot, seed, run }, floor { run, floor },
  // win { run, cutscene }, menu { run }, shutdown y boot (el juego ha vuelto a arrancar y ha vaciado el log).
  constructor(file, saved = {}, isActive = () => false, isQuest = () => false, onFrames = () => {}, onEvent = () => {}) {
    while (saved.version !== SNAPSHOT_VERSION && MIGRATIONS[saved.version]) saved = MIGRATIONS[saved.version](saved);
    if (saved.version !== SNAPSHOT_VERSION) saved = {};
    this.file = file;
    this.isActive = isActive;
    this.isQuest = isQuest;
    this.onFrames = onFrames;
    this.onEvent = onEvent;
    this.runs = saved.runs || {};
    this.run = null;
    this.offset = 0;
    this.tail = '';
    this.lastChar = null;
    this.changed = false;
    this.coopSpawn = false;
    // Online: nombres de Steam por id (del lobby), el jugador que el juego está creando y si se juega un Deathmatch.
    this.netNames = {};
    this.netPending = null;
    this.deathmatch = false;
    // Al reiniciar una partida online el juego vuelve a crear a los jugadores sin decir quién es cada uno: se repite el
    // orden de la anterior. netStarting: aún no se ha entrado en la primera sala, que es cuando se crean.
    this.netLayout = [];
    this.netStarting = false;
    // Id de Steam (64 bits) de quien juega en este PC, para poner su nombre. Lo asigna el tracker.
    this.localUser = () => null;
    this.genesisUsed = false;
    this.genesisLost = null;
    this.pickup = false;
    this.burst = {};
    // Líneas "Prev: 0" seguidas: el cambio de forma de Tainted Lazarus escribe dos antes de la del HUD.
    this.swapLines = 0;
    // Tras la seed, el primer jugador creado es la forma activa de Tainted Lazarus.
    this.formPending = false;
    this.resetRewind();
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
    return { version: SNAPSHOT_VERSION, runs: this.runs, slot: this.run && runKey(this.run.mode, this.run.slot), offset: this.offset, tail: this.tail, lastChar: this.lastChar, mark: this.mark(this.offset) };
  }

  // Lo que hace falta para deshacer un Glowing Hourglass: las últimas salas con el estado al entrar en ellas.
  resetRewind() {
    this.rooms = [];
    // Hubo una transición desde la última sala: si no, la siguiente sala no se ha entrado andando.
    this.transition = true;
    // Contador de frames de la última transición y el de una transición que lo hizo retroceder.
    this.lastFrame = null;
    this.rewindFrame = null;
    this.rewindFrom = null;
  }

  line(l) {
    let m;
    // Durante un Deathmatch solo importa saber cuándo acaba: otra partida, el menú o el cierre del juego.
    if (this.deathmatch) {
      if (!RE.seed.test(l) && !RE.menu.test(l) && !RE.shutdown.test(l)) return;
      this.deathmatch = false;
    }
    // Va en líneas de otros tipos (cambio de sala, jugador...): se mira aparte y la línea sigue su curso.
    // Lo que deshace un Glowing Hourglass sigue contando como tiempo jugado (run.rewound).
    if (this.run && (m = RE.frame.exec(l)) && +m[1] + (this.run.rewound || 0) > (this.run.frames || 0)) {
      this.run.frames = +m[1] + (this.run.rewound || 0);
      this.changed = true;
      this.onFrames(this.run);
    }
    if (RE.transition.test(l)) {
      this.transition = true;
      // El contador solo retrocede (o se repite) si el juego vuelve a un estado anterior: Glowing Hourglass vuelve al de
      // la última transición. Entre dos transiciones normales siempre pasa algún frame.
      const frame = m ? +m[1] : null;
      if (frame !== null && this.lastFrame !== null && frame <= this.lastFrame) { this.rewindFrame = frame; this.rewindFrom = this.lastFrame; }
      if (frame !== null) this.lastFrame = frame;
    }
    if (RE.swapControl.test(l)) { this.swapLines++; return; }
    const swapLines = this.swapLines;
    this.swapLines = 0;
    if ((m = RE.cutscene.exec(l))) {
      if (this.run && +m[1] !== INTRO_CUTSCENE) this.onEvent('win', { run: this.run, cutscene: +m[1] });
      return;
    }
    if (RE.menu.test(l)) { this.netPending = null; this.onEvent('menu', { run: this.run }); return; }
    if (RE.lobby.test(l)) { this.netNames = {}; return; }
    if ((m = RE.netUser.exec(l))) { this.netNames[m[2]] = m[1]; return; }
    if (RE.netLocal.test(l)) { this.netPending = { local: true }; return; }
    if ((m = RE.netRemote.exec(l))) { this.netPending = { id: m[1] }; return; }
    if (RE.shutdown.test(l)) { this.onEvent('shutdown', {}); return; }
    if (RE.swapHud.test(l)) {
      if (swapLines === 2 && this.run && isLazarus(this.run.character)) {
        this.endBurst();
        this.run.deadForm = !this.run.deadForm;
        this.changed = true;
      }
      return;
    }
    if ((m = RE.seed.exec(l))) {
      const [, seed, mode, slot] = m;
      this.endBurst();
      this.resetRewind();
      const known = this.runs[runKey(mode, slot)];
      this.netPending = null;
      if (mode === 'Continue' && known && known.seed === seed) this.run = known;
      else {
        this.run = { seed, slot: +slot, mode, character: mode === 'Continue' ? this.lastChar : null, floors: [], items: [] };
        if (mode === NET) this.run.players = [];
        this.netStarting = mode === NET;
        this.runs[runKey(mode, slot)] = this.run;
      }
      // Forma activa de Tainted Lazarus. En partida nueva, el juego crea las dos formas tras la seed, la activa primero.
      // Al continuar, crea la activa antes de la seed y la otra después.
      this.formPending = mode !== 'Continue';
      if (mode === 'Continue' && isLazarus(this.lastChar)) this.run.deadForm = this.lastChar === DEAD_TAINTED_LAZARUS;
      this.onEvent('start', { mode, slot: +slot, seed, run: this.run });
    } else if (RE.coopSpawn.test(l)) {
      this.coopSpawn = true;
      return;
    } else if ((m = RE.player.exec(l)) && this.run && this.run.players && (this.netPending || (this.netStarting && this.run.players.length < this.netLayout.length))) {
      this.addNetPlayer(+m[1]);
      this.coopSpawn = false;
      this.formPending = false;
    } else if ((m = RE.player.exec(l))) {
      // Un jugador añadido durante la partida (Esau) no es el personaje elegido.
      if (!this.coopSpawn) this.lastChar = +m[1];
      this.coopSpawn = false;
      if (this.run && this.run.character === null) this.run.character = this.lastChar;
      // En partida nueva, la primera forma creada tras la seed es la activa (la viva). Al continuar ya se sabe por la
      // seed (ver arriba) y la forma que se crea después es la otra.
      if (this.run && this.formPending && isLazarus(+m[1])) this.run.deadForm = +m[1] === DEAD_TAINTED_LAZARUS;
      this.formPending = false;
    } else if ((m = RE.room.exec(l))) {
      this.endBurst();
      this.netStarting = false;
      if (DEATHMATCH_ROOM.test(m[2])) { this.deathmatch = true; this.netPending = null; return; }
      if (!this.rewindTo(m[1])) {
        this.rememberRoom(m[1]);
        this.enterRoom(m[2]);
      }
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
      if (!last || last.stage !== +m[1] || last.type !== +m[2]) {
        this.run.floors.push({ stage: +m[1], type: +m[2], blind: false });
        this.onEvent('floor', { run: this.run, floor: this.run.floors[this.run.floors.length - 1] });
      }
    } else if (l.includes('Curse of Blind')) {
      const last = this.run && this.run.floors[this.run.floors.length - 1];
      if (last) last.blind = true;
    } else if (l.includes('Curse of the Labyrinth')) {
      const last = this.run && this.run.floors[this.run.floors.length - 1];
      if (last) last.xl = true;
    } else if ((m = RE.add.exec(l))) {
      if (+m[1] === STRAWMAN && this.run) this.run.strawman = true;
      this.addCollectible(+m[1], m[2], +m[3], m[4]);
      // El Black Candle se tomó con la maldición puesta; lo que venga después en este piso, ya no.
      if (+m[1] === BLACK_CANDLE) this.liftCurse();
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

  // Jugador de una partida online, con su personaje y su nombre de Steam. El local no llega con id: se usa el de la
  // cuenta de Steam abierta en este PC.
  addNetPlayer(character) {
    // Una partida que dice quién es cada uno empieza un orden nuevo.
    if (this.netPending && !this.run.players.length) this.netLayout = [];
    const known = this.netPending || this.netLayout[this.run.players.length];
    this.netPending = null;
    const p = { local: !!known.local, character };
    if (known.id) p.id = known.id;
    p.name = this.netNames[p.local ? this.localUser() : p.id] || known.name || '';
    if (p.local) { this.lastChar = character; this.run.character = character; }
    this.netLayout[this.run.players.length] = { local: p.local, id: p.id, name: p.name };
    this.run.players.push(p);
  }

  endBurst() {
    this.pickup = false;
    for (const [player, burst] of Object.entries(this.burst)) {
      if (isReroll(burst.count, burst.lost.length)) this.applyReroll(+player, burst);
    }
    this.burst = {};
  }

  // Lo lleva ese jugador. Con Tainted Lazarus, además, la forma activa: la otra no pierde nada por un reroll.
  holds(item, player) {
    if ((item.player || 0) !== player) return false;
    return !isLazarus(this.run.character) || item.owner === this.lazarusOwner();
  }

  lazarusOwner() {
    return this.run.deadForm ? 'lazarus_dead' : 'lazarus';
  }

  rerollable(player) {
    return this.run.items.filter(i => this.holds(i, player) && !i.removed && !i.soul && i.id < TRINKET_OFFSET && !this.isActive(i.id) && !this.isQuest(i.id));
  }

  applyReroll(player, { lost, added }) {
    for (const item of lost) item.removed = true;
    // Si hubo varios rerolls seguidos, solo cuenta el último.
    if (added.length > lost.length + 3) for (const item of added.slice(0, -lost.length)) item.removed = true;
    // Un activo nuevo ocupa el sitio del que ya llevaba.
    const current = added.filter(i => !i.removed && this.isActive(i.id));
    const old = this.run.items.filter(i => this.holds(i, player) && !i.removed && !i.soul && this.isActive(i.id) && !added.includes(i));
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
      // Genesis quita la maldición del ciego: lo que se elige en su sala ya se ve. Lo conservado guarda su marca.
      this.liftCurse();
    }
    if (this.run.items.length !== before) this.changed = true;
  }

  // Glowing Hourglass devuelve a la sala anterior y deshace todo lo de la sala donde se usa: el estado vuelve a como
  // estaba al entrar en ella. Si se usa en la primera sala de un piso, vuelve a la sala de la trampilla del anterior.
  // Lo tomado en la sala deshecha desaparece, no se marca como quitado: así deja de contar para las transformaciones,
  // que sí cuentan lo quitado. Vuelve también lo que quitó allí un reroll o Genesis.
  // El juego no escribe nada al usarlo. Se reconoce porque se llega a la sala sin transición (andando, por una puerta,
  // un teletransporte o un cambio de piso siempre hay una) o porque el contador de frames retrocede.
  rewindTo(room) {
    const rewound = !this.transition || this.rewindFrame !== null;
    const frame = this.rewindFrame;
    this.transition = false;
    this.rewindFrame = null;
    // Solo devuelve a la sala de antes de la actual: cualquier otra cosa no es un Glowing Hourglass.
    const undone = this.rooms[this.rooms.length - 1], back = this.rooms[this.rooms.length - 2];
    if (!rewound || !this.run || !back || back.room !== room) return false;
    const state = structuredClone(undone.state);
    this.run.items = state.items;
    // Al volver al piso anterior, el nuevo deja de contar.
    this.run.floors = state.floors.slice(0, back.state.floors.length);
    this.run.deadForm = state.deadForm;
    this.run.strawman = state.strawman;
    // El tiempo deshecho se jugó igualmente: se sigue sumando al de la partida.
    const restored = frame ?? undone.frame;
    const before = frame === null ? this.lastFrame : this.rewindFrom;
    if (before !== null && restored !== null && before > restored) this.run.rewound = (this.run.rewound || 0) + before - restored;
    this.lastFrame = restored;
    // Se vuelve a estar en la sala anterior: un segundo uso seguido deshace también esa.
    this.rooms.length -= 1;
    this.burst = {};
    this.pickup = false;
    this.genesisUsed = false;
    this.genesisLost = null;
    this.changed = true;
    return true;
  }

  // Se guarda antes de entrar (antes de lo que hace Genesis al llegar a su sala). Lo del Esau del Alma de Jacob y Esaú
  // no pasa de sala.
  rememberRoom(room) {
    if (!this.run) return;
    const { items, floors, deadForm, strawman } = this.run;
    const state = structuredClone({ items: items.filter(i => !i.soul), floors, deadForm, strawman });
    this.rooms.push({ room, frame: this.lastFrame, state });
    if (this.rooms.length > ROOM_HISTORY) this.rooms.shift();
  }

  // Los objetos ya tomados conservan la marca: se tomaron sin verlos.
  liftCurse() {
    const f = this.run && this.run.floors[this.run.floors.length - 1];
    if (f && f.blind) { f.blind = false; this.changed = true; }
  }

  // Con Jacob y Esaú, Esau es el jugador 1; cualquier otro Esau viene del Alma de Jacob y Esaú.
  // Con Tainted Lazarus, el objeto es de la forma activa en ese momento.
  ownerOf(player, who) {
    if (isLazarus(this.run.character) && player === 0) return { owner: this.lazarusOwner() };
    const human = !!(this.run.players && this.run.players[player]);
    if (this.run.strawman && who === 'Keeper' && player > 0 && !human) return { owner: 'strawman', helper: true };
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
    const lazarus = isLazarus(this.run.character) && player === 0;
    // Flip es común a las dos formas de Tainted Lazarus: el juego se lo da a cada una, pero se muestra una vez y sin dueño.
    const owner = lazarus && id === FLIP ? {} : this.ownerOf(player, who);
    // Un activo que vuelve a recogerse sigue en el piso donde se tomó por primera vez, aunque cambie de manos.
    // Las dos formas de Tainted Lazarus llevan cada una el suyo; Flip, sin dueño, se reconoce como el mismo.
    const held = this.isActive(id) && this.run.items.find(i => i.id === id && !i.removed && !i.soul === !owner.soul && (!lazarus || i.owner === owner.owner));
    if (held) { Object.assign(held, { player }, owner); return; }
    const floor = Math.max(0, this.run.floors.length - 1), f = this.run.floors[floor];
    const item = { id, name, floor, blind: !!(f && f.blind), removed: false, player, ...owner };
    this.run.items.push(item);
    return item;
  }

  // Con Tainted Lazarus se quita primero de la forma activa; si no lo lleva, de la otra.
  removeItem(id, player = 0) {
    if (!this.run || this.isActive(id)) return;
    const tests = [i => this.holds(i, player), i => (i.player || 0) === player];
    for (const test of tests) {
      for (let i = this.run.items.length - 1; i >= 0; i--) {
        const item = this.run.items[i];
        if (item.id === id && !item.removed && test(item)) { item.removed = true; return; }
      }
    }
  }

  // Devuelve true si llegaron datos nuevos. El juego vacía log.txt al arrancar: entonces se relee desde el inicio.
  poll() {
    const size = fs.statSync(this.file).size;
    if (size < this.offset) {
      this.offset = 0; this.tail = ''; this.run = null; this.burst = {}; this.resetRewind();
      this.netNames = {}; this.netPending = null; this.deathmatch = false; this.netLayout = []; this.netStarting = false;
      this.onEvent('boot', {});
    }
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
