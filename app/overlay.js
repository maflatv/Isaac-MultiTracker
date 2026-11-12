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
// Con más páginas que esto, el indicador de la estantería pasa de puntos a «2/9».
const MAX_DOTS = 6;
// Antes de ocultar objetos se prueban iconos más pequeños.
// Quién lleva el objeto: su cabeza, sacada de los recursos del juego, o una letra si no están. La letra es la del
// nombre en inglés, como en el juego (D de Dead Lazarus). Los nombres de personajes no se traducen.
const OWNERS = {
  jacob: { key: 'view.jacob', letter: 'J' }, esau: { key: 'view.esau', letter: 'E' },
  lazarus: { key: 'view.lazarus', letter: 'L' }, lazarus_dead: { key: 'view.lazarusDead', letter: 'D' },
  strawman: { key: 'view.strawman', letter: 'S', parts: ['head'] },
};
const ownerParts = owner => OWNERS[owner].parts || ['head', 'hair'];
// owner -> 'loading' | 'ok' | 'fail'. Se comprueba una vez si están todas sus hojas; al cargarse se vuelve a dibujar.
const ownerArt = {};
function hasOwnerArt(owner) {
  if (!(owner in ownerArt)) {
    ownerArt[owner] = 'loading';
    let left = ownerParts(owner).length;
    for (const part of ownerParts(owner)) {
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
  for (const part of ownerParts(owner)) {
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

// Perfil de esta vista (?profile= en la dirección): la ventana del tracker, la fuente de OBS o la vista previa del panel.
const PROFILE = new URLSearchParams(location.search).get('profile');
const STATE_URL = 'api/state' + (PROFILE ? '?profile=' + encodeURIComponent(PROFILE) : '');
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
let sideWidthBoth = 0;
// Páginas de la estantería (cada una, la lista de sus iconos) cuando no caben todos los objetos y se pasan páginas.
let shelfPages = [];
let shelfPage = 0;

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

// Con «Ambos», el progreso alterna entre iconos y texto cada progressSwapSeconds, con un fundido de progressFadeMs.
let progressMode = 'icons';
const progressStyle = o => (o.progressStyle === 'both' ? progressMode : o.progressStyle);

// Un guardado al 100% no tiene nada pendiente: no se muestra su progreso.
// Todo lo que devuelve lleva la clase «prog»: es lo único que se desvanece al alternar iconos y texto.
function progressBlocks(s) {
  const [meters, tags] = progressContent(s);
  for (const node of [meters, tags, ...meters.children]) node.classList.add('prog');
  return [meters, tags];
}

function progressContent(s) {
  const p = s.progress;
  const meters = el('div', 'meters'), tags = el('div', 'tags');
  if (!p || p.complete) return [meters, tags];
  const { show, goals, watched, options } = s.config;
  if (progressStyle(options) === 'icons') return [meters, iconGrid(p, show, goals, watched, options)];
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
  const side = el('div', 'side' + (progressStyle(s.config.options) === 'icons' ? ' icons' : ''));
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
  // Ancho fijo con todo visible: al rotar las páginas, los objetos no deben moverse. Con «Ambos», el mayor de los
  // anchos de iconos y de texto, para que la estantería tampoco se mueva al alternarlos.
  const side = view.querySelector('.side');
  const both = current && current.config.options.progressStyle === 'both';
  sideWidthBoth = both ? Math.max(sideWidthBoth, side.offsetWidth) : 0;
  side.style.width = (both ? sideWidthBoth : side.offsetWidth) + 'px';
  // El texto tiene un máximo más estrecho que los iconos (overlay.css): se iguala al ancho recordado.
  if (both) side.style.maxWidth = sideWidthBoth + 'px';
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

// La columna lateral y la estantería pasan página a la vez, cada pageSeconds. Mientras se destaca un objeto,
// la estantería se queda en su página para que se vea dónde cae.
// Se comprueba a menudo para aplicar enseguida un cambio de los segundos y no depender de cuándo llega la configuración.
let lastTurn = Date.now();
setInterval(() => {
  const seconds = (current && current.config.options.pageSeconds) || 5;
  if (Date.now() - lastTurn < seconds * 1000) return;
  lastTurn = Date.now();
  if (sidePages.length > 1) { sidePage = (sidePage + 1) % sidePages.length; showSidePage(); }
  if (shelfPages.length > 1 && !heroActive) { shelfPage = (shelfPage + 1) % shelfPages.length; showShelfPage(true); }
}, 250);
// La pasarela vuelve a moverse al terminar de destacar un objeto.
setInterval(() => {
  if (marquee && !heroActive && marquee.playState === 'paused') marquee.play();
}, 250);

// «Ambos»: cada progressSwapSeconds el progreso se desvanece, cambia de iconos a texto (o al revés) y vuelve a aparecer.
// La vista se redibuja entera, así que la columna lateral vuelve a repartir sus páginas para lo que se ve ahora.
let lastSwap = Date.now();
let swapping = false;
setInterval(() => {
  const o = current && current.config.options;
  if (!o || o.progressStyle !== 'both' || swapping) { lastSwap = Date.now(); return; }
  if (Date.now() - lastSwap < (o.progressSwapSeconds || 8) * 1000) return;
  if (!current.progress || current.progress.complete) return;
  swapping = true;
  const fade = reducedMotion() ? 0 : o.progressFadeMs || 600;
  document.documentElement.style.setProperty('--prog-fade', fade + 'ms');
  document.body.classList.add('prog-out');
  setTimeout(() => {
    progressMode = progressMode === 'icons' ? 'text' : 'icons';
    sidePage = 0;
    render(current);
    // Lo nuevo nace transparente; se fuerza el cálculo antes de quitar la clase para que aparezca con el fundido.
    void view.offsetWidth;
    document.body.classList.remove('prog-out');
    lastSwap = Date.now();
    swapping = false;
  }, fade);
}, 250);

// Texto del objeto: nombre, descripción, piso y maldición del ciego.
const itemInfo = i => `${i.desc ? ' — ' + i.desc : ''}${i.floorLabel ? ' (' + i.floorLabel + ')' : ''}${i.blind ? ' — ' + tr('view.blind') : ''}`;

// idx: posición del objeto en la partida, para encontrar su icono (estilos «vuelo», «foco» y «pulso»).
function itemTile(i, latest, hoverDesc, idx) {
  const t = el('div', 'item' + (i.removed ? ' removed' : '') + (i.blind ? ' blind' : '') + (latest ? ' latest' : ''));
  t.dataset.idx = idx;
  // La vista se redibuja con cada lectura: el pulso sigue en el icono nuevo mientras dure.
  if (pulse && pulse.idx === idx && Date.now() < pulse.until) t.classList.add('pulse');
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
  const index = new Map(items.map((x, n) => [x, n]));
  if (options.removed === 'hide') items = items.filter(i => !i.removed);
  if (options.maxItems) items = items.slice(-options.maxItems);
  // Si la maldición del ciego se quita a mitad de piso (Black Candle, Genesis), el piso se parte en dos tramos:
  // lo tomado con ella ("D2 ?") y lo tomado después ("D2").
  const groupOf = i => i.floor + (i.blind && options.blindMark !== 'none' ? '?' : '');
  let group = null;
  for (const i of items) {
    const tile = itemTile(i, i === latest, options.hoverDesc, index.get(i));
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
  // Solo los de la página que se ve, si la estantería pasa páginas.
  const tiles = [...shelf.querySelectorAll(':scope > .item[data-floor]:not(.off)')];
  if (!tiles.length) return;
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

// Imagen de fondo. Su posición es la de su centro, en % del recuadro (0 y 100 son los bordes; se puede sacar de ellos),
// y la escala multiplica el tamaño de cada modo. Para colocarla en píxeles hace falta su tamaño original.
const bgNatural = { key: '', width: 0, height: 0 };
const bar = document.getElementById('bar');
let bgOptions = null;

// Tamaño dibujado de la imagen en un recuadro de bw × bh, o null si aún no se conoce el original.
function bgRect(o, bw, bh) {
  const { width: nw, height: nh } = bgNatural, k = o.bgImageScale / 100;
  if (!nw || !nh) return null;
  if (o.bgImageFit === 'cover' || o.bgImageFit === 'contain') {
    const f = (o.bgImageFit === 'cover' ? Math.max : Math.min)(bw / nw, bh / nh) * k;
    return { w: nw * f, h: nh * f };
  }
  return { w: nw * k, h: nh * k };
}

// Coloca la imagen según el tamaño actual del recuadro: se repite al cargarla y cada vez que el recuadro cambia.
function placeBg() {
  const o = bgOptions;
  if (!o || !o.bgImage) return;
  const css = document.documentElement.style;
  if (o.bgImageFit === 'stretch') { css.setProperty('--bg-size', '100% 100%'); css.setProperty('--bg-pos', '0 0'); return; }
  const bw = bar.clientWidth, bh = bar.clientHeight, r = bgRect(o, bw, bh);
  if (!r) { css.setProperty('--bg-size', o.bgImageFit === 'tile' || o.bgImageFit === 'scale' ? 'auto' : o.bgImageFit); css.setProperty('--bg-pos', '50% 50%'); return; }
  css.setProperty('--bg-size', `${Math.round(r.w)}px ${Math.round(r.h)}px`);
  css.setProperty('--bg-pos', `${Math.round(o.bgImageX / 100 * bw - r.w / 2)}px ${Math.round(o.bgImageY / 100 * bh - r.h / 2)}px`);
}
new ResizeObserver(placeBg).observe(bar);

function bgImageVars(o) {
  bgOptions = o;
  if (!o.bgImage) return { '--bg-image': 'none' };
  const url = new URL('background?v=' + encodeURIComponent(o.bgImage), location.href).href;
  if (bgNatural.key !== o.bgImage) {
    Object.assign(bgNatural, { key: o.bgImage, width: 0, height: 0 });
    const img = new Image();
    img.onload = () => {
      if (bgNatural.key !== o.bgImage) return;
      Object.assign(bgNatural, { width: img.naturalWidth, height: img.naturalHeight });
      placeBg();
    };
    img.src = url;
  }
  return {
    '--bg-image': `url("${url}")`,
    '--bg-repeat': o.bgImageFit === 'tile' ? 'repeat' : 'no-repeat', '--bg-image-opacity': o.bgImageOpacity / 100,
  };
}

// En la vista previa del panel la imagen se arrastra con el ratón; el panel recibe la posición y la guarda al soltar.
const dragHost = window.parent !== window && (() => { try { return typeof window.parent.moveBgImage === 'function' ? window.parent : null; } catch { return null; } })();
const canDragBg = () => dragHost && bgOptions && bgOptions.bgImage && bgOptions.bgImageFit !== 'stretch';
if (dragHost) {
  let drag = null;
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !canDragBg()) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, bx: bgOptions.bgImageX, by: bgOptions.bgImageY, bw: bar.clientWidth || 1, bh: bar.clientHeight || 1 };
    document.documentElement.setPointerCapture(e.pointerId);
    document.body.classList.add('bg-dragging');
  });
  const at = e => [drag.bx + (e.clientX - drag.x) / drag.bw * 100, drag.by + (e.clientY - drag.y) / drag.bh * 100];
  document.addEventListener('pointermove', e => {
    document.body.classList.toggle('bg-draggable', !!canDragBg());
    if (drag) dragHost.moveBgImage(...at(e), false);
  });
  const end = e => {
    if (!drag) return;
    dragHost.moveBgImage(...at(e), true);
    drag = null;
    document.body.classList.remove('bg-dragging');
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
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

// Tamaño de la insignia de dueño respecto al icono del objeto.
const BADGE_SCALE = { small: 0.3, medium: 0.45, large: 0.6 };

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
    '--badge-scale': BADGE_SCALE[o.ownerBadgeSize] || BADGE_SCALE.medium,
    // Columna lateral del banner: sin valor, el ancho automático de overlay.css.
    '--side-w': o.sideAuto ? '' : o.sideWidth + 'px',
    ...bgImageVars(o),
  };
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  placeBg();
}

function render(s) {
  const { show, options } = s.config;
  applyStyle(options);
  document.body.classList.toggle('mark-latest', options.markItem === 'latest');
  document.body.classList.toggle('mark-hover', options.markItem === 'hover');
  document.body.classList.toggle('who-highlight', options.whoOutline !== 'none');
  document.body.classList.toggle('owner-bg', !!options.ownerBadgeBg);
  document.body.dataset.badgeCorner = options.ownerBadgeCorner || 'bl';
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

// Elige el mayor tamaño de icono en el que caben todos los objetos. Si no caben:
// - «Pasar páginas» (overflow 'pages'): los iconos no bajan de pageMinIcon (o del tamaño fijo) y los objetos se
//   reparten en páginas que van rotando.
// - «Pasarela» ('marquee'): lo mismo, pero todos los objetos van en una sola fila que se desliza sin parar.
// - «Encoger y superponer» ('shrink'): en el tamaño más pequeño los superpone lo justo para que se vea la lista entera,
//   dejando visible al menos SHOW_MIN de cada icono. Solo si ni así caben, conserva los más recientes con un contador
//   de los que no se ven.
// Unas filas elegidas a mano se respetan aunque no quepan en la ventana.
const SHOW_MIN = 0.35;
function fitShelf({ padding, iconAuto, iconSize, layout, rows, overflow, pageMinIcon, pageDirection, marqueeSpeed }) {
  setOverlap(0);
  const wasPaged = shelfPages.length > 1;
  shelfPages = [];
  // La pasarela sigue por donde iba aunque la vista se redibuje.
  const marqueeAt = marquee ? marquee.currentTime || 0 : 0;
  if (marquee) { marquee.cancel(); marquee = null; }
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
  if (overflow === 'pages' || overflow === 'marquee') {
    // Si ni el mínimo cabe en la ventana, el mayor tamaño que sí cabe.
    const allowed = iconAuto ? sizes.filter(size => size >= (pageMinIcon || 0)) : sizes;
    for (const size of allowed.length ? allowed : [sizes[0]]) if (tryLayout(size, 0)) return;
    // Con «reducir movimiento» en Windows, la pasarela pasa a páginas.
    if (overflow === 'marquee' && !reducedMotion()) {
      rollShelf(shelf, sizes, tryLayout, { direction: pageDirection, speed: marqueeSpeed || 40, at: marqueeAt });
      return;
    }
    paginateShelf(shelf, room, rows, wasPaged);
    return;
  }
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

// Pasarela: todos los objetos en una sola fila, con el mayor icono con el que cabe en alto (o el tamaño fijo), que se
// desliza sin parar. Detrás va una copia de la fila para que, al acabar, vuelva a empezar sin saltos.
// direction 'ltr': los objetos avanzan de izquierda a derecha. speed en píxeles por segundo; at, por dónde iba.
let marquee = null;
function rollShelf(shelf, sizes, tryLayout, { direction, speed, at }) {
  const strip = el('div', 'marquee');
  shelf.replaceWith(strip);
  strip.append(shelf);
  shelf.classList.add('rolling');
  for (const size of sizes) if (tryLayout(size, 0)) break;
  const tiles = [...shelf.querySelectorAll(':scope > .item')];
  // En una sola fila sí caben: no hace falta moverla.
  if (!tiles.length || shelf.offsetWidth <= strip.clientWidth) return;
  for (const tile of tiles) {
    const copy = tile.cloneNode(true);
    copy.classList.remove('latest', 'fresh', 'pulse', 'landed');
    delete copy.dataset.idx;
    // Otro piso para los separadores: la copia empieza un tramo nuevo aunque siga el mismo piso.
    if (copy.dataset.floor) copy.dataset.floor = 'copy:' + copy.dataset.floor;
    copy.tipItem = tile.tipItem;
    shelf.append(copy);
  }
  spaceFloorLabels(shelf);
  const cycle = shelf.children[tiles.length].offsetLeft - tiles[0].offsetLeft;
  const away = `translateX(${-cycle}px)`;
  const frames = direction === 'rtl' ? [{ transform: 'none' }, { transform: away }] : [{ transform: away }, { transform: 'none' }];
  const duration = (cycle / speed) * 1000;
  marquee = shelf.animate(frames, { duration, iterations: Infinity });
  marquee.currentTime = at % duration;
  if (heroActive) marquee.pause();
}

// Reparte la estantería en páginas de filas enteras, tal como quedan con todos los objetos: al ocultar filas completas,
// las demás no cambian. Se cuentan desde el final, para que la página de los objetos más recientes vaya llena.
// Con filas elegidas a mano, cada página tiene esas filas aunque no quepan; si no, las que quepan en la ventana.
// wasPaged: ya pasaba páginas y se sigue en la misma; si no, se empieza por la de los objetos más recientes.
function paginateShelf(shelf, room, rows, wasPaged) {
  const lines = [];
  let top = null;
  for (const tile of shelf.querySelectorAll('.item')) {
    if (tile.offsetTop !== top) { lines.push([]); top = tile.offsetTop; }
    lines[lines.length - 1].push(tile);
  }
  const split = per => {
    const pages = [];
    for (let end = lines.length; end > 0; end -= per) pages.unshift(lines.slice(Math.max(0, end - per), end).flat());
    return pages;
  };
  const keep = wasPaged ? shelfPage : Infinity;
  const allFit = () => shelfPages.every((_, n) => { shelfPage = n; showShelfPage(); return view.offsetHeight <= room; });
  // Se empieza por las filas que caben según la altura de cada una, para no medir de más.
  const pitch = lines.length > 1 ? lines[1][0].offsetTop - lines[0][0].offsetTop : 0;
  let per = rows || Math.min(lines.length - 1, pitch ? Math.ceil(room / pitch) : lines.length - 1);
  for (; per >= 1; per--) { shelfPages = split(per); if (rows || allFit()) break; }
  if (per < 1) shelfPages = split(1);
  shelfPage = Math.min(keep, shelfPages.length - 1);
  showShelfPage();
}

// Muestra la página shelfPage. turn: viene del cambio automático de página y se anima con el efecto elegido.
function showShelfPage(turn) {
  const shelf = view.querySelector('.shelf');
  if (!shelf) return;
  const o = current ? current.config.options : {};
  const effect = turn && !reducedMotion() ? o.pageEffect || 'slide' : 'none';
  for (const old of shelf.querySelectorAll('.page-ghost')) old.remove();
  const ghost = effect === 'slide' ? pageGhost(shelf) : null;
  for (const old of shelf.querySelectorAll('.floor-mark.repeat, .page-dots')) old.remove();
  shelfPages.forEach((page, n) => page.forEach(t => t.classList.toggle('off', n !== shelfPage)));
  // Un piso que empieza en la página anterior repite su código al principio de esta.
  const first = (shelfPages[shelfPage] || [])[0];
  if (first && first.dataset.floor && !first.querySelector(':scope > .floor-mark')) {
    let from = first.previousElementSibling;
    while (from && !from.querySelector(':scope > .floor-mark')) from = from.previousElementSibling;
    if (from) {
      const mark = from.querySelector(':scope > .floor-mark').cloneNode(true);
      mark.classList.add('repeat');
      first.prepend(mark);
    }
  }
  spaceFloorLabels(shelf);
  if (shelfPages.length > 1 && o.pageDots) shelf.append(pageDots());
  if (effect !== 'none') animatePage(shelf, ghost, effect, o);
}

// Copia de la página que se va, en su mismo sitio, para que salga deslizándose mientras entra la nueva.
// Sin data-idx ni data-floor: no debe confundirse con los iconos de verdad.
function pageGhost(shelf) {
  const ghost = el('div', 'page-ghost');
  for (const tile of shelf.querySelectorAll(':scope > .item:not(.off)')) {
    const copy = tile.cloneNode(true);
    copy.classList.remove('latest', 'fresh', 'pulse', 'landed');
    delete copy.dataset.idx;
    delete copy.dataset.floor;
    Object.assign(copy.style, { left: tile.offsetLeft + 'px', top: tile.offsetTop + 'px' });
    ghost.append(copy);
  }
  return ghost;
}

// Deslizar: la página sale hacia un lado y la nueva entra por el otro (pageDirection 'ltr': de izquierda a derecha).
// Fundido: la nueva aparece poco a poco. Dura pageAnimMs.
const PAGE_EASING = 'cubic-bezier(.45, 0, .25, 1)';
function animatePage(shelf, ghost, effect, o) {
  const opts = { duration: o.pageAnimMs || 600, easing: PAGE_EASING };
  const tiles = [...shelf.querySelectorAll(':scope > .item:not(.off)')];
  if (effect === 'fade') {
    for (const t of tiles) t.animate([{ opacity: 0 }, { opacity: 1 }], opts);
    return;
  }
  const shift = (o.pageDirection === 'rtl' ? -1 : 1) * shelf.clientWidth;
  shelf.classList.add('sliding');
  shelf.append(ghost);
  ghost.animate([{ transform: 'none' }, { transform: `translateX(${shift}px)` }], opts);
  for (const t of tiles) t.animate([{ transform: `translateX(${-shift}px)` }, { transform: 'none' }], opts);
  setTimeout(() => { ghost.remove(); shelf.classList.remove('sliding'); }, opts.duration);
}

// Indicador de la página: un punto por página o, si son muchas, «2/9».
function pageDots() {
  const box = el('div', 'page-dots');
  if (shelfPages.length > MAX_DOTS) box.textContent = `${shelfPage + 1}/${shelfPages.length}`;
  else shelfPages.forEach((_, n) => box.append(el('i', n === shelfPage ? 'on' : '')));
  return box;
}

// Antes de destacar un objeto se muestra la página donde está, para que se vea dónde cae.
function revealTile(item) {
  if (shelfPages.length < 2 || !Number.isInteger(item.idx)) return;
  const n = shelfPages.findIndex(page => page.some(t => +t.dataset.idx === item.idx));
  // Sin animación: los estilos «vuelo» y «foco» miden enseguida dónde está el icono.
  if (n >= 0 && n !== shelfPage) { shelfPage = n; showShelfPage(); }
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
    const fresh = items.slice(seen.count).filter(i => !i.removed && !i.soul && !i.granted).map(i => ({ ...i, idx: items.indexOf(i) }));
    queue.push(...(fresh.length > MAX_BATCH ? fresh.slice(-1) : fresh));
    playNext();
  }
  seen.count = items.length;
}

// Icono del objeto en la estantería, si se ve (en otra página no cuenta).
// En la pasarela, solo si ahora está dentro de lo que se ve.
function findTile(item) {
  if (!Number.isInteger(item.idx) || item.idx < 0) return null;
  const tile = view.querySelector(`.item:not(.off)[data-idx="${item.idx}"]`);
  const strip = tile && tile.closest('.marquee');
  if (strip) {
    const t = tile.getBoundingClientRect(), s = strip.getBoundingClientRect();
    if (t.left < s.left || t.right > s.right) return null;
  }
  return tile;
}
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Duración del vuelo hasta el hueco del objeto, incluida en los segundos configurados.
const FLY_MS = 750;
// Pulso del estilo «Solo pulso»: { idx, until }.
let pulse = null;

// Tras destacarlo, el icono del objeto late una vez en su sitio.
function landOn(item) {
  const tile = findTile(item) || view.querySelector('.item.latest');
  if (!tile) return;
  tile.classList.remove('landed');
  void tile.offsetWidth;
  tile.classList.add('landed');
}

function heroCaption(item) {
  const text = el('div', 'hero-text');
  text.append(el('small', '', item.floorLabel ? `${tr('view.newItem')} · ${item.floorLabel}` : tr('view.newItem')));
  if (OWNERS[item.owner]) text.firstChild.append(` · ${tr(OWNERS[item.owner].key)}`);
  if (item.blind) text.firstChild.append(el('span', 'hero-blind', ' · ' + tr('view.blind')));
  text.append(el('strong', '', item.name));
  if (item.desc) text.append(el('p', '', item.desc));
  return text;
}

function itemImage(item, className) {
  const img = el('img', className);
  img.src = `icon/item/${item.id}.png`;
  img.alt = '';
  img.onerror = () => { img.style.visibility = 'hidden'; };
  return img;
}

// Hace salir un elemento con su clase «leaving» al final de los segundos y luego llama a end().
function leaveAfter(node, seconds, end) {
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(end, LEAVE_MS);
  }, seconds * 1000 - LEAVE_MS);
}

// seconds es el tiempo total en pantalla: incluye la entrada y la salida.
function buildHero(item, seconds, style) {
  const icon = el('div', 'hero-icon');
  icon.append(el('div', 'hero-rays'), itemImage(item));
  const timer = el('div', 'hero-timer');
  timer.style.animationDelay = INTRO_MS + 'ms';
  timer.style.animationDuration = seconds * 1000 - INTRO_MS - LEAVE_MS + 'ms';
  hero.className = style;
  hero.replaceChildren(icon, heroCaption(item), timer);
  hero.hidden = false;
}

// Cada estilo muestra el objeto durante seconds y llama a done() al terminar.
const HIGHLIGHT = {
  // Toda la vista: el objeto con sus rayos, su nombre y su descripción.
  full(item, seconds, done) {
    buildHero(item, seconds, 'full');
    document.body.classList.add('highlighting');
    leaveAfter(hero, seconds, () => {
      hero.hidden = true;
      if (!queue.length) {
        document.body.classList.remove('highlighting');
        const tile = view.querySelector('.item.latest');
        if (tile) tile.classList.add('fresh');
      }
      done();
    });
  },
  // Un aviso compacto en una esquina: el resto de la vista sigue a la vista.
  toast(item, seconds, done) {
    buildHero(item, seconds, 'toast');
    leaveAfter(hero, seconds, () => { hero.hidden = true; landOn(item); done(); });
  },
  // Una cinta cruza la parte de abajo con el icono, el nombre y la descripción.
  ticker(item, seconds, done) {
    const track = el('div', 'ticker-track');
    const text = heroCaption(item);
    track.append(itemImage(item), ...text.childNodes);
    track.style.animationDuration = seconds * 1000 - LEAVE_MS + 'ms';
    hero.className = 'ticker';
    hero.replaceChildren(track);
    hero.hidden = false;
    leaveAfter(hero, seconds, () => { hero.hidden = true; landOn(item); done(); });
  },
  // Solo late su icono en la estantería.
  pulse(item, seconds, done) {
    pulse = { idx: item.idx, until: Date.now() + seconds * 1000 };
    const tile = findTile(item);
    if (tile) tile.classList.add('pulse');
    setTimeout(() => {
      pulse = null;
      for (const t of view.querySelectorAll('.item.pulse')) t.classList.remove('pulse');
      done();
    }, seconds * 1000);
  },
  // Se oscurece todo menos el objeto, que se agranda en su sitio con su nombre al lado.
  spotlight(item, seconds, done) {
    const r = findTile(item).getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    const size = Math.max(r.width, Math.min(r.width * 2, H * 0.8, 160));
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const left = Math.min(Math.max(cx - size / 2, 0), W - size), top = Math.min(Math.max(cy - size / 2, 0), H - size);
    const spot = el('div', 'spot');
    spot.style.setProperty('--sx', cx + 'px');
    spot.style.setProperty('--sy', cy + 'px');
    spot.style.setProperty('--sr', size * 0.62 + 'px');
    const img = itemImage(item, 'spot-icon');
    Object.assign(img.style, { left: left + 'px', top: top + 'px', width: size + 'px', height: size + 'px' });
    const text = heroCaption(item);
    text.className = 'spot-text';
    // El texto va al lado con más sitio, centrado en vertical con el objeto.
    if (cx < W * 0.6) text.style.left = left + size + 10 + 'px';
    else { text.style.right = W - left + 10 + 'px'; text.style.textAlign = 'right'; }
    text.style.top = top + size / 2 + 'px';
    spot.append(img, text);
    document.getElementById('bar').append(spot);
    leaveAfter(spot, seconds, () => { spot.remove(); landOn(item); done(); });
  },
  // El objeto aparece grande en el centro con su nombre y después vuela hasta su hueco en la estantería.
  fly(item, seconds, done) {
    const layer = el('div', 'fly');
    const W = window.innerWidth, H = window.innerHeight;
    const size = Math.min(H * 0.7, 128);
    const img = itemImage(item, 'fly-icon');
    const text = heroCaption(item);
    text.className = 'fly-text';
    const row = el('div', 'fly-row');
    row.append(img, text);
    img.style.width = img.style.height = size + 'px';
    layer.append(row);
    document.getElementById('bar').append(layer);
    document.body.classList.add('flying');
    setTimeout(() => {
      const tile = findTile(item);
      layer.classList.add('leaving');
      document.body.classList.remove('flying');
      if (!tile) return setTimeout(() => { layer.remove(); done(); }, LEAVE_MS);
      const to = tile.getBoundingClientRect(), from = img.getBoundingClientRect();
      const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const flight = img.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${to.width / from.width})` }],
        { duration: FLY_MS, easing: 'cubic-bezier(.55, 0, .45, 1)', fill: 'forwards' });
      flight.onfinish = () => { layer.remove(); landOn(item); done(); };
    }, Math.max(1000, seconds * 1000 - FLY_MS));
  },
};
// Estilos que necesitan ver el icono del objeto en la estantería: sin él, se usa el aviso.
const NEEDS_TILE = ['spotlight', 'fly', 'pulse'];
// Con «reducir movimiento» en Windows, nada vuela ni se desplaza.
const MOVING = ['fly', 'ticker'];

function playNext() {
  if (heroActive || !queue.length) return;
  const item = queue.shift();
  revealTile(item);
  // La pasarela se para mientras se destaca un objeto, para que no se mueva el icono al que va.
  if (marquee) marquee.pause();
  const o = current ? current.config.options : {};
  const configured = o.highlightSeconds || 5;
  const seconds = queue.length ? Math.min(QUEUED_SECONDS, configured) : configured;
  let style = HIGHLIGHT[o.highlightStyle] ? o.highlightStyle : 'full';
  if ((NEEDS_TILE.includes(style) && !findTile(item)) || (MOVING.includes(style) && reducedMotion())) style = 'toast';
  heroActive = true;
  HIGHLIGHT[style](item, seconds, () => {
    heroActive = false;
    playNext();
  });
}

// Para el panel: muestra unos ajustes aún sin guardar, mientras se arrastra un deslizador o se elige un color.
// La siguiente lectura con cambios (el guardado al soltar) los sustituye por los guardados.
function previewConfig(config) {
  if (current) render({ ...current, config });
}

// Para el botón de prueba del panel.
function testHighlight() {
  const items = current && current.run ? current.run.items : [];
  let idx = items.length - 1;
  while (idx >= 0 && items[idx].removed) idx--;
  const item = idx >= 0 ? { ...items[idx], idx } : { id: 1, name: 'The Sad Onion', desc: 'Tears +0.7', floorLabel: '', idx: -1 };
  queue.push(item);
  playNext();
}

// También lo llama el panel, para que la vista previa responda sin esperar a la siguiente lectura.
async function refresh() {
  const text = await fetch(STATE_URL).then(r => r.text());
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
// Una fuente que llega después del primer dibujo cambia el ancho de los textos (el lateral, los códigos de piso) y,
// con él, cuántos objetos caben por fila: lo calculado antes ya no sirve y la estantería se saldría de la ventana.
document.fonts.addEventListener('loadingdone', () => { if (current) render(current); });

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
