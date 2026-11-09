// Vista del tracker: la misma página sirve para OBS, para una ventana y para la vista previa del panel.
const POLL_MS = 1000;
// Duración de la entrada del objeto, incluida en los segundos configurados. Coincide con overlay.css.
const INTRO_MS = 900;
const LEAVE_MS = 350;
// Si hay más objetos esperando, cada uno se destaca menos tiempo.
const QUEUED_SECONDS = 3;
// Más objetos de golpe no son recogidas normales (Esau Jr., Genesis...): solo se destaca el último.
const MAX_BATCH = 3;
// Los objetos iniciales de una partida nueva pueden llegar en lecturas posteriores a la seed.
const NEW_RUN_GRACE_MS = 2000;
// Tiempo de cada página cuando el progreso no cabe en el lateral del banner.
const PAGE_MS = 5000;
// Antes de ocultar objetos se prueban iconos más pequeños.
// Quién lleva el objeto: su cabeza, sacada de los recursos del juego, o una letra si no están. La letra es la del
// nombre en inglés, como en el juego (D de Dead para el Lázaro muerto); el nombre completo sale traducido.
const OWNERS = {
  jacob: { key: 'view.jacob', letter: 'J' }, esau: { key: 'view.esau', letter: 'E' },
  lazarus: { key: 'view.lazarus', letter: 'L' }, lazarus_dead: { key: 'view.lazarusDead', letter: 'D' },
};
// owner -> 'loading' | 'ok' | 'fail'. Se comprueba una vez si están las dos hojas; al cargarse se vuelve a dibujar.
const ownerArt = {};
function hasOwnerArt(owner) {
  if (!(owner in ownerArt)) {
    ownerArt[owner] = 'loading';
    let left = 2;
    for (const part of ['head', 'hair']) {
      const img = new Image();
      img.onload = () => { if (--left === 0 && ownerArt[owner] === 'loading') { ownerArt[owner] = 'ok'; if (current) render(current); } };
      img.onerror = () => { ownerArt[owner] = 'fail'; };
      img.src = `icon/owner/${owner}/${part}.png`;
    }
  }
  return ownerArt[owner] === 'ok';
}
function ownerBadge(owner) {
  if (!hasOwnerArt(owner)) return el('span', 'owner-badge ' + owner, OWNERS[owner].letter);
  const b = el('span', 'owner-badge art ' + owner);
  for (const part of ['head', 'hair']) {
    const layer = el('i', part);
    layer.style.backgroundImage = `url(icon/owner/${owner}/${part}.png)`;
    b.append(layer);
  }
  return b;
}
const LABEL_ROOM = 6; // separación mínima entre el código de un piso y el del siguiente
const FIT_ICON_SIZES = [32, 28, 24];
// Solo si con 24 px y superpuestos no caben todos los objetos.
const TINY_ICON_SIZES = [20, 16];
// El banner usa el mayor tamaño que quepa, para aprovechar todo el espacio.
const BANNER_ICON_SIZES = [96, 80, 64, 56, 48, 40, ...FIT_ICON_SIZES];

const view = document.getElementById('view');
const hero = document.getElementById('hero');
let names = { goals: {}, watched: {} };
let lang = 'en';
let namesLang = null;
const tr = (key, vars) => I18N.t(lang, key, vars);
let lastState = '';
let current = null;
const seen = { seed: null, count: 0, since: 0 };
const queue = [];
let heroActive = false;
let sidePages = [];
let sidePage = 0;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function meter(label, done, total) {
  const m = el('div', 'meter' + (done >= total ? ' done' : ''));
  const head = el('div', 'meter-head');
  head.append(el('span', '', label), el('b', '', `${done}/${total}`));
  const track = el('div', 'meter-track'), fill = el('i');
  fill.style.width = Math.min(100, (done / total) * 100) + '%';
  track.append(fill);
  m.append(head, track);
  return m;
}

function tag(label, done) {
  return el('span', 'tag' + (done ? ' done' : ''), label);
}

function pips(label, count, goal) {
  const p = el('span', 'pips' + (count >= goal ? ' done' : ''), label + ' ');
  for (let i = 0; i < goal; i++) p.append(el('i', i < count ? 'on' : ''));
  return p;
}

// La racha es del guardado, no de la partida: se muestra también sin partida y en guardados al 100%.
function streakTag(p) {
  const tagEl = el('span', 'streak', tr('view.streak'));
  tagEl.append(el('b', '', String(p.winStreak)));
  tagEl.title = tr('view.bestStreak', { best: p.bestStreak });
  return tagEl;
}

// Tiempo jugado en el archivo elegido, desde que se registra. Como la racha, no depende de la partida.
function playtimeTag(seconds) {
  const tagEl = el('span', 'streak', tr('view.playtime'));
  tagEl.append(el('b', '', I18N.duration(lang, seconds)));
  tagEl.title = tr('progress.playtime');
  return tagEl;
}

function whoBlock(s) {
  const w = el('div', 'who'), { show } = s.config, r = s.run;
  if (r && show.character && r.character) w.append(el('strong', '', r.character));
  if (r && show.floor && r.floor) w.append(el('span', '', r.floor));
  // Se actualiza con cada cambio de sala, que es cuando el juego escribe el contador en el log.
  if (r && show.runTime && r.seconds) { const t = el('span', '', I18N.duration(lang, r.seconds)); t.title = tr('run.runTime'); w.append(t); }
  if (r && show.seed) w.append(el('code', '', r.seed));
  if (show.winStreak && s.progress) w.append(streakTag(s.progress));
  if (show.playtime && s.playtime !== null && s.playtime !== undefined) w.append(playtimeTag(s.playtime));
  return w;
}

// Icono de cada total: el logro de Steam que lo representa o, para la colección, Breakfast del propio juego.
const TOTAL_ICONS = {
  achievements: 'icon/achievement/637.jpg', items: 'icon/item/25.png', marksHard: 'icon/achievement/636.jpg',
  marksAny: 'icon/achievement/636.jpg', challenges: 'icon/achievement/280.jpg',
};
// "c64" o "s23" -> icono del logro 64 o 23.
const achievementIcon = id => `icon/achievement/${String(id).replace(/^\D+/, '')}.jpg`;

// Logro como icono, igual que en Steam. Sin icono (sin internet, por ejemplo) se muestra la versión en texto.
function achTile(src, title, done, value, fallback) {
  const t = el('span', 'ach' + (done ? ' done' : ''));
  t.title = title;
  const img = el('img');
  img.src = src;
  img.alt = '';
  img.onerror = () => t.replaceWith(fallback());
  t.append(img);
  if (value) t.append(el('b', '', value));
  return t;
}

// Un guardado al 100% no tiene nada pendiente: no se muestra su progreso.
function progressBlocks(s) {
  const p = s.progress;
  const meters = el('div', 'meters'), tags = el('div', 'tags');
  if (!p || p.complete) return [meters, tags];
  const { show, goals, watched, options } = s.config;
  if (options.progressStyle === 'icons') return [meters, iconGrid(p, show, goals, watched, options)];
  const add = (on, label, x) => { if (on && !(options.hideDone && x.done >= x.total)) meters.append(meter(label, x.done, x.total)); };
  add(show.achievements, tr('view.achievements'), p.achievements);
  add(show.collection, tr('view.items'), p.items);
  add(show.marksHard, tr('view.marksHard'), p.marksHard);
  add(show.marksAny, tr('view.marks'), p.marksAny);
  add(show.challenges, tr('view.challenges'), p.challenges);
  for (const g of p.goals) {
    if (!goals.includes(g.id) || (options.hideDone && g.done)) continue;
    const name = names.goals[g.id] || g.id;
    if (g.done) tags.append(tag(name, true));
    else meters.append(meter(name, g.value, g.goal));
  }
  for (const w of p.watched) {
    if (watched.includes(w.id) && !(options.hideDone && w.done)) tags.append(tag(names.watched[w.id] || w.id, w.done));
  }
  return [meters, tags];
}

// Como el Deadgod Tracker: totales y contadores con su cifra al lado; los logros vigilados, solo el icono.
function iconGrid(p, show, goals, watched, options) {
  const grid = el('div', 'achs' + (options.pendingLook === 'gray' ? ' gray' : ''));
  const total = (on, key, label, x) => {
    const done = x.done >= x.total;
    if (!on || (options.hideDone && done)) return;
    const value = `${x.done}/${x.total}`;
    grid.append(achTile(TOTAL_ICONS[key], `${label} ${value}`, done, value, () => meter(label, x.done, x.total)));
  };
  total(show.achievements, 'achievements', tr('view.achievements'), p.achievements);
  total(show.collection, 'items', tr('view.items'), p.items);
  total(show.marksHard, 'marksHard', tr('view.marksHard'), p.marksHard);
  total(show.marksAny, 'marksAny', tr('view.marks'), p.marksAny);
  total(show.challenges, 'challenges', tr('view.challenges'), p.challenges);
  for (const g of p.goals) {
    if (!goals.includes(g.id) || (options.hideDone && g.done)) continue;
    const name = names.goals[g.id] || g.id;
    const value = g.done ? '' : `${g.value}/${g.goal}`;
    grid.append(achTile(achievementIcon(g.id), value ? `${name} ${value}` : name, g.done, value, () => (g.done ? tag(name, true) : meter(name, g.value, g.goal))));
  }
  for (const w of p.watched) {
    if (!watched.includes(w.id) || (options.hideDone && w.done)) continue;
    const name = names.watched[w.id] || w.id;
    grid.append(achTile(achievementIcon(w.id), name, w.done, '', () => tag(name, w.done)));
  }
  return grid;
}

function transformBlock(s) {
  const row = el('div', 'tags');
  if (!s.config.show.transforms || !s.run) return row;
  const { hideDone, transformsClose } = s.config.options;
  for (const t of s.run.transforms) {
    const done = t.count >= t.goal;
    if (hideDone && done) continue;
    if (transformsClose && t.count < t.goal - 1) continue;
    row.append(pips(t.name, t.count, t.goal));
  }
  return row;
}

function stripRow(s) {
  const row = el('div', 'strip');
  row.append(...[whoBlock(s), ...progressBlocks(s), transformBlock(s)].filter(b => b.childNodes.length));
  return row;
}

function sideColumn(s) {
  const side = el('div', 'side' + (s.config.options.progressStyle === 'icons' ? ' icons' : ''));
  const who = whoBlock(s);
  const [meters, tags] = progressBlocks(s);
  const pages = el('div', 'pages');
  pages.append(...meters.childNodes, ...[tags, transformBlock(s)].filter(b => b.childNodes.length));
  side.append(...[who, pages].filter(b => b.childNodes.length));
  return side;
}

// Reparte el progreso en páginas si no cabe a la vez: rotar es mejor que cortarlo o saturar el banner.
function paginateSide(padding) {
  sidePages = [];
  const pages = view.querySelector('.pages');
  if (!pages) return;
  const who = view.querySelector('.side .who');
  const room = window.innerHeight - padding * 2 - (who ? who.offsetHeight + 4 : 0);
  splitTallBlocks(pages, room);
  // Ancho fijo con todo visible: al rotar las páginas, los objetos no deben moverse.
  const side = view.querySelector('.side');
  side.style.width = side.offsetWidth + 'px';
  let page = [], used = 0;
  for (const unit of pages.children) {
    const h = unit.offsetHeight + 4;
    if (page.length && used + h > room) { sidePages.push(page); page = []; used = 0; }
    page.push(unit);
    used += h;
  }
  if (page.length) sidePages.push(page);
  sidePage = sidePages.length ? sidePage % sidePages.length : 0;
  showSidePage();
}

// Un bloque de etiquetas más alto que el espacio se reparte en varios, que ya caben en una página.
function splitTallBlocks(pages, room) {
  for (const block of [...pages.querySelectorAll(':scope > .tags, :scope > .achs')]) {
    let current = block;
    while (current.offsetHeight > room && current.children.length > 1) {
      const rest = el('div', block.className);
      current.after(rest);
      while (current.offsetHeight > room && current.children.length > 1) rest.prepend(current.lastElementChild);
      current = rest;
    }
  }
}

function showSidePage() {
  sidePages.forEach((page, i) => page.forEach(unit => { unit.hidden = i !== sidePage; }));
}

setInterval(() => {
  if (sidePages.length < 2) return;
  sidePage = (sidePage + 1) % sidePages.length;
  showSidePage();
}, PAGE_MS);

// Texto del objeto: nombre, descripción, piso y maldición del ciego.
const itemInfo = i => `${i.desc ? ' — ' + i.desc : ''}${i.floorLabel ? ' (' + i.floorLabel + ')' : ''}${i.blind ? ' — ' + tr('view.blind') : ''}`;

function itemTile(i, latest, hoverDesc) {
  const t = el('div', 'item' + (i.removed ? ' removed' : '') + (i.blind ? ' blind' : '') + (latest ? ' latest' : ''));
  // Con la descripción al pasar el puntero, el recuadro del navegador la repetiría con retraso.
  if (hoverDesc) t.tipItem = i;
  else t.title = i.name + itemInfo(i);
  const img = el('img');
  img.src = `icon/item/${i.id}.png`;
  img.alt = i.name;
  // Los objetos de mods no tienen icono en los recursos del juego: se muestra su nombre.
  img.onerror = () => img.replaceWith(el('span', 'item-name', i.name));
  t.append(img);
  const owner = OWNERS[i.owner];
  if (owner) {
    if (t.title) t.title += ' — ' + tr(owner.key);
    t.append(ownerBadge(i.owner));
  }
  return t;
}

function floorMark(i) {
  const mark = el('span', 'floor-mark' + (i.blind ? ' blind' : ''));
  const label = el('span', 'floor-label', i.floorLabel);
  if (i.blind) label.append(el('span', 'blind-q', ' ?'));
  mark.append(label);
  return mark;
}

// Los objetos del Esau del Alma no los ha tomado el personaje: se van con él al salir de la sala.
function lastTaken(items) {
  return [...items].reverse().find(i => !i.removed && !i.soul);
}

function shelfRow(s) {
  const { options } = s.config, wrap = el('div', 'shelf' + (options.floorGroups ? ' floors' : ''));
  let items = s.run.items;
  const latest = lastTaken(items);
  if (options.removed === 'hide') items = items.filter(i => !i.removed);
  if (options.maxItems) items = items.slice(-options.maxItems);
  // Si la maldición del ciego se quita a mitad de piso (Black Candle, Genesis), el piso se parte en dos tramos:
  // lo tomado con ella ("D2 ?") y lo tomado después ("D2").
  const groupOf = i => i.floor + (i.blind && options.blindMark !== 'none' ? '?' : '');
  let group = null;
  for (const i of items) {
    const tile = itemTile(i, i === latest, options.hoverDesc);
    if (options.floorGroups) {
      tile.dataset.floor = groupOf(i);
      if (groupOf(i) !== group) tile.prepend(floorMark(i));
    }
    group = groupOf(i);
    wrap.append(tile);
  }
  return wrap;
}

// Píxeles que cada icono se mete bajo el siguiente cuando no caben todos (0 = sin superponer).
let overlap = 0;
function setOverlap(px) {
  overlap = Math.round(px);
  document.documentElement.style.setProperty('--overlap', overlap + 'px');
}

// El código del piso no ocupa ancho propio: solo se aparta el piso siguiente si el código no cabe sobre sus objetos.
// Cada objeto lleva un margen derecho de -overlap; el último del piso lo amplía si hace falta sitio para el código.
function spaceFloorLabels(shelf) {
  const tiles = [...shelf.querySelectorAll('.item[data-floor]')];
  const pitch = () => tiles[0].offsetWidth + parseFloat(getComputedStyle(shelf).columnGap) - overlap;
  let count = 0;
  const tight = shelf.classList.contains('tight');
  tiles.forEach((tile, n) => {
    tile.style.marginRight = '';
    if (tight) return;
    count++;
    if (tiles[n + 1] && tiles[n + 1].dataset.floor === tile.dataset.floor) return;
    const label = tiles[n - count + 1].querySelector('.floor-label');
    const extra = Math.max(0, label.offsetWidth + LABEL_ROOM - count * pitch());
    if (extra) tile.style.marginRight = extra - overlap + 'px';
    count = 0;
  });
}

function descRow(s) {
  const last = lastTaken(s.run.items);
  const row = el('div', 'desc');
  if (last) { row.append(el('strong', '', last.name)); if (last.desc) row.append(' — ' + last.desc); }
  return row;
}

const OUTLINE = '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000';
const TEXT_EFFECTS = { none: 'none', shadow: '0 1px 2px #000', outline: OUTLINE };
const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' };

// Una fuente pixelada solo es nítida a ciertos tamaños: el texto secundario no se puede escalar con fracciones.
const TEXT_SCALE = {
  regular: { '--small': '.85em', '--large': '1.15em', '--label': '12px', '--floor-h': '14px', '--hero-title': 'clamp(1.3em, 14vh, 2.4em)', '--hero-desc': '1em' },
  pixel: { '--small': '15px', '--large': '1em', '--label': '15px', '--floor-h': '14px', '--hero-title': '30px', '--hero-desc': '15px' },
};
// Upheaval vale tanto incluida en app/ ("Upheaval") como instalada en Windows ("Upheaval TT (BRK)").
const PIXEL_FONTS = /^Upheaval\b/i;

// Imagen de fondo: en mosaico y en escala propia el tamaño parte del original, que se conoce al cargarla.
const bgNatural = { key: '', width: 0, height: 0 };
function bgSize(o) {
  if (o.bgImageFit === 'cover' || o.bgImageFit === 'contain') return o.bgImageFit;
  if (o.bgImageFit === 'stretch') return '100% 100%';
  if (!bgNatural.width) return 'auto';
  const k = o.bgImageScale / 100;
  return `${Math.round(bgNatural.width * k)}px ${Math.round(bgNatural.height * k)}px`;
}
function bgImageVars(o) {
  if (!o.bgImage) return { '--bg-image': 'none' };
  const url = new URL('background?v=' + encodeURIComponent(o.bgImage), location.href).href;
  if (bgNatural.key !== o.bgImage) {
    Object.assign(bgNatural, { key: o.bgImage, width: 0, height: 0 });
    const img = new Image();
    img.onload = () => {
      if (bgNatural.key !== o.bgImage) return;
      Object.assign(bgNatural, { width: img.naturalWidth, height: img.naturalHeight });
      document.documentElement.style.setProperty('--bg-size', bgSize(o));
    };
    img.src = url;
  }
  return {
    '--bg-image': `url("${url}")`, '--bg-size': bgSize(o), '--bg-pos': `${o.bgImageX}% ${o.bgImageY}%`,
    '--bg-repeat': o.bgImageFit === 'tile' ? 'repeat' : 'no-repeat', '--bg-image-opacity': o.bgImageOpacity / 100,
  };
}

// Contorno de píxeles enteros alrededor de cada letra, como el texto del juego: una sombra por cada punto del anillo.
function outlineShadow(color, size) {
  const parts = [];
  for (let x = -size; x <= size; x++) for (let y = -size; y <= size; y++) {
    if ((x || y) && x * x + y * y <= size * size + size) parts.push(`${x}px ${y}px 0 ${color}`);
  }
  return parts.join(', ');
}
const WHO_SHADOW = {
  none: () => 'var(--text-shadow)',
  outline: o => outlineShadow(o.whoOutlineColor, o.whoOutlineSize),
  glow: o => `0 0 ${o.whoOutlineSize}px ${o.whoOutlineColor}, 0 0 ${o.whoOutlineSize * 3}px ${o.whoOutlineColor}`,
};

function applyStyle(o) {
  const icon = { none: 'none', glow: `drop-shadow(0 0 3px ${o.accentColor})`, shadow: 'drop-shadow(1px 2px 1px #000)' };
  const vars = {
    ...TEXT_SCALE[PIXEL_FONTS.test(o.font) ? 'pixel' : 'regular'],
    '--font': `"${o.font}", system-ui, sans-serif`, '--size': o.fontSize + 'px', '--weight': o.bold ? 600 : 400,
    '--text': o.textColor, '--accent': o.accentColor, '--done': o.doneColor, '--text-shadow': TEXT_EFFECTS[o.textEffect], '--blind': o.blindColor,
    // Iconos de logros proporcionales al texto: 28 px con el tamaño por defecto (20).
    '--ach': Math.round(o.fontSize * 1.4) + 'px',
    '--icon': o.iconSize + 'px', '--icon-gap': o.iconGap + 'px', '--icon-filter': icon[o.iconEffect],
    '--row-gap': o.rowGap + 'px', '--padding': o.padding + 'px', '--radius': o.radius + 'px',
    '--align': o.align, '--justify': JUSTIFY[o.align],
    '--bg': o.background === 'solid' ? o.color : o.background === 'brick' ? 'url(ladrillo.png)' : 'transparent',
    '--bg-opacity': o.backgroundOpacity / 100,
    '--who-shadow': (WHO_SHADOW[o.whoOutline] || WHO_SHADOW.none)(o),
    ...bgImageVars(o),
  };
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
}

function render(s) {
  const { show, options } = s.config;
  applyStyle(options);
  document.body.classList.toggle('mark-latest', options.markItem === 'latest');
  document.body.classList.toggle('mark-hover', options.markItem === 'hover');
  document.body.classList.toggle('who-highlight', options.whoOutline !== 'none');
  // Maldición del ciego: por defecto solo en el separador del piso. Sin separadores, se marca cada objeto para no perder el dato.
  const blind = options.blindMark === 'floor' && !options.floorGroups ? 'items' : options.blindMark;
  document.body.classList.toggle('blind-items', blind === 'items');
  document.body.classList.toggle('blind-none', blind === 'none');
  if (!options.hoverDesc) hideTip();
  const banner = options.layout === 'banner';
  view.className = banner ? 'banner' : 'wide';
  const head = banner ? sideColumn(s) : stripRow(s);
  const shelf = s.run && show.items ? [shelfRow(s)] : [];
  const desc = s.run && show.description ? [descRow(s)] : [];
  const parts = options.itemsPosition === 'above' ? [...shelf, head] : [head, ...shelf];
  const body = parts.filter(p => p.childNodes.length);
  if (banner) {
    // La descripción va con los objetos para no quitarle anchura al lateral.
    const main = el('div', 'main');
    const shelfEl = body.find(p => p.classList.contains('shelf'));
    if (shelfEl) { body[body.indexOf(shelfEl)] = main; main.append(shelfEl); }
    else if (desc.length) body.push(main);
    main.append(...desc.filter(p => p.childNodes.length));
  } else body.push(...desc.filter(p => p.childNodes.length));
  if (!s.run) body.push(el('div', 'waiting', tr('view.waiting')));
  view.replaceChildren(...body);
  paginateSide(options.padding);
  fitShelf(options);
}

// Elige el mayor tamaño de icono en el que caben todos los objetos. Si no caben ni en el más pequeño, los superpone
// lo justo para que se vea la lista entera en la misma ventana, dejando visible al menos SHOW_MIN de cada icono.
// Solo si ni así caben, conserva los más recientes con un contador de los que no se ven.
// Unas filas elegidas a mano se respetan aunque no quepan en la ventana.
const SHOW_MIN = 0.35;
function fitShelf({ padding, iconAuto, iconSize, layout, rows }) {
  setOverlap(0);
  const shelf = view.querySelector('.shelf');
  if (!shelf) return;
  const room = window.innerHeight - padding * 2;
  const rowCount = () => new Set([...shelf.children].map(c => c.offsetTop)).size;
  const fits = () => view.offsetHeight <= room && (!rows || rowCount() <= rows);
  const tryLayout = (size, share) => {
    document.documentElement.style.setProperty('--icon', size + 'px');
    setOverlap(size * share);
    spaceFloorLabels(shelf);
    return fits();
  };
  let sizes = [iconSize];
  if (iconAuto) sizes = layout === 'banner' ? BANNER_ICON_SIZES.filter(size => size <= room) : [iconSize, ...FIT_ICON_SIZES.filter(size => size < iconSize)];
  if (!sizes.length) sizes = [FIT_ICON_SIZES[FIT_ICON_SIZES.length - 1]];
  for (const size of sizes) if (tryLayout(size, 0)) return;
  // En el tamaño más pequeño: la menor superposición que haga caber todo.
  const smallest = sizes[sizes.length - 1];
  const gap = parseFloat(getComputedStyle(shelf).columnGap) || 0;
  const most = Math.floor(smallest * (1 - SHOW_MIN) + gap);
  for (let px = 1; px <= most; px++) if (tryLayout(smallest, px / smallest)) return;
  // Sin los códigos de piso, que obligan a separar los pisos, caben muchos más.
  if (shelf.querySelector('.floor-label')) {
    shelf.classList.add('tight');
    for (let px = 0; px <= most; px++) if (tryLayout(smallest, px / smallest)) return;
  }
  // Iconos aún más pequeños (16 px es el tamaño original del sprite) dejan sitio para otra fila.
  if (iconAuto) {
    for (const size of TINY_ICON_SIZES.filter(s => s < smallest)) {
      const limit = Math.floor(size * (1 - SHOW_MIN) + gap);
      for (let px = 0; px <= limit; px++) if (tryLayout(size, px / size)) return;
    }
  }
  // Si ni una fila cabe entera, se deja una: vaciar la estantería no arreglaría nada.
  const tooMany = () => (rows ? rowCount() > rows : view.offsetHeight > room && rowCount() > 1);
  if (!tooMany()) return;
  const tiles = [...shelf.querySelectorAll('.item')];
  const more = el('div', 'item more');
  shelf.prepend(more);
  let hidden = 0;
  while (hidden < tiles.length - 1 && tooMany()) {
    const tile = tiles[hidden++], mark = tile.querySelector('.floor-mark'), next = tile.nextElementSibling;
    tile.remove();
    // El separador pasa al siguiente objeto visible del piso; si no queda ninguno, desaparece con él.
    if (mark && next.dataset.floor === tile.dataset.floor) next.prepend(mark);
    spaceFloorLabels(shelf);
    more.textContent = '+' + hidden;
  }
}

// ---------- Objeto recién tomado ----------
function detectPickups(s) {
  if (!s.run) { seen.seed = null; seen.count = 0; return; }
  const { seed, items } = s.run;
  if (seed !== seen.seed) {
    // Al abrir la vista o empezar otra partida no hay nada que destacar.
    seen.seed = seed;
    seen.since = Date.now();
  } else if (items.length > seen.count && s.config.options.highlight && Date.now() - seen.since > NEW_RUN_GRACE_MS) {
    const fresh = items.slice(seen.count).filter(i => !i.removed && !i.soul && !i.granted);
    queue.push(...(fresh.length > MAX_BATCH ? fresh.slice(-1) : fresh));
    playNext();
  }
  seen.count = items.length;
}

// seconds es el tiempo total en pantalla: incluye la entrada y la salida.
function buildHero(item, seconds) {
  const icon = el('div', 'hero-icon'), img = el('img');
  img.src = `icon/item/${item.id}.png`;
  img.alt = '';
  img.onerror = () => img.remove();
  icon.append(el('div', 'hero-rays'), img);
  const text = el('div', 'hero-text');
  text.append(el('small', '', item.floorLabel ? `${tr('view.newItem')} · ${item.floorLabel}` : tr('view.newItem')));
  if (OWNERS[item.owner]) text.firstChild.append(` · ${tr(OWNERS[item.owner].key)}`);
  if (item.blind) text.firstChild.append(el('span', 'hero-blind', ' · ' + tr('view.blind')));
  text.append(el('strong', '', item.name));
  if (item.desc) text.append(el('p', '', item.desc));
  const timer = el('div', 'hero-timer');
  timer.style.animationDelay = INTRO_MS + 'ms';
  timer.style.animationDuration = seconds * 1000 - INTRO_MS - LEAVE_MS + 'ms';
  hero.replaceChildren(icon, text, timer);
}

function playNext() {
  if (heroActive || !queue.length) return;
  const item = queue.shift();
  const configured = current ? current.config.options.highlightSeconds : 5;
  const seconds = queue.length ? Math.min(QUEUED_SECONDS, configured) : configured;
  heroActive = true;
  buildHero(item, seconds);
  hero.classList.remove('leaving');
  hero.hidden = false;
  document.body.classList.add('highlighting');
  setTimeout(() => {
    hero.classList.add('leaving');
    setTimeout(() => {
      hero.hidden = true;
      heroActive = false;
      if (queue.length) return playNext();
      document.body.classList.remove('highlighting');
      const tile = view.querySelector('.item.latest');
      if (tile) tile.classList.add('fresh');
    }, LEAVE_MS);
  }, seconds * 1000 - LEAVE_MS);
}

// Para el botón de prueba del panel.
function testHighlight() {
  const items = current && current.run ? current.run.items.filter(i => !i.removed) : [];
  const item = items[items.length - 1] || { id: 1, name: 'The Sad Onion', desc: 'Tears +0.7', floorLabel: '' };
  queue.push(item);
  playNext();
}

// También lo llama el panel, para que la vista previa responda sin esperar a la siguiente lectura.
async function refresh() {
  const text = await fetch('api/state').then(r => r.text());
  if (text === lastState) return;
  lastState = text;
  current = JSON.parse(text);
  lang = current.lang;
  document.documentElement.lang = lang;
  if (lang !== namesLang) {
    namesLang = lang;
    try { await loadNames(); } catch { namesLang = null; }
  }
  render(current);
  detectPickups(current);
}

async function tick() {
  try { await refresh(); } catch { /* servidor parado: se conserva lo último y se reintenta */ }
  setTimeout(tick, POLL_MS);
}

window.addEventListener('resize', () => { if (current) render(current); });

// ---------- Descripción del objeto bajo el puntero ----------
// La vista se redibuja con cada lectura: la franja se actualiza con el objeto que haya ahora bajo el puntero.
const tip = document.getElementById('tip');
function hideTip() { tip.hidden = true; }
function showTip(tile) {
  const i = tile.tipItem;
  tip.replaceChildren(el('strong', '', i.name), itemInfo(i));
  if (OWNERS[i.owner]) tip.append(' — ' + tr(OWNERS[i.owner].key));
  tip.classList.remove('top');
  tip.hidden = false;
  // Abajo, salvo que tape el propio objeto: entonces va arriba.
  if (tile.getBoundingClientRect().bottom > window.innerHeight - tip.offsetHeight) tip.classList.add('top');
}
view.addEventListener('mouseover', e => {
  const tile = e.target.closest('.item');
  if (tile && tile.tipItem) showTip(tile); else hideTip();
});
view.addEventListener('mouseleave', hideTip);

// Los nombres de contadores y logros dependen del idioma: se vuelven a pedir cuando cambia.
async function loadNames() {
  const c = await fetch('api/choices').then(r => r.json());
  names = {
    goals: Object.fromEntries(c.goals.map(g => [g.id, g.name])),
    watched: Object.fromEntries(c.watched.map(w => [w.id, w.name])),
  };
}

tick();
