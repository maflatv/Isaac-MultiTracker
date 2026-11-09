// Panel de configuración: cada cambio se guarda al momento y la vista lo recoge en su siguiente lectura.
// Fuera de la suite el panel está en la raíz: no hay hub al que volver.
if (location.pathname === '/') document.querySelector('a.back').remove();
document.getElementById('about').addEventListener('click', () => document.getElementById('aboutDialog').showModal());

const STATUS_POLL_MS = 3000;
const CUSTOM_SAVE = 'custom';
const MIN_AUTO_ICON = 24;
const FLOOR_LABEL_HEIGHT = 14;
const KOFI = 'https://ko-fi.com/maflatv';
const RUN_SHOW = ['character', 'seed', 'floor', 'runTime', 'items', 'description', 'transforms'];
const PROGRESS_SHOW = ['winStreak', 'playtime', 'achievements', 'collection', 'marksHard', 'marksAny', 'challenges'];
// Cada tema parte de la apariencia por defecto y cambia solo lo indicado.
const THEMES = {
  default: {},
  stream: { fontSize: 16, textEffect: 'outline', textColor: '#ffffff', accentColor: '#ffd84d', doneColor: '#7dff7d', iconEffect: 'shadow' },
  minimal: { fontSize: 12, bold: false, textEffect: 'none', iconGap: 0, rowGap: 2, padding: 4 },
  dungeon: { font: 'Georgia', accentColor: '#e0655f', doneColor: '#f0ad4e', iconEffect: 'shadow', background: 'brick', padding: 10 },
  contrast: { textEffect: 'none', textColor: '#ffffff', accentColor: '#ffe600', doneColor: '#00ff66', background: 'solid', color: '#000000', padding: 10 },
};
// Controles que solo tienen efecto con otra opción: se desactivan para que se vea que ahora no cambian nada.
const ITEMS_SHOWN = c => c.show.items;
const DEPENDS = {
  iconSize: c => !c.options.iconAuto,
  maxItems: ITEMS_SHOWN, removed: ITEMS_SHOWN, markItem: ITEMS_SHOWN, hoverDesc: ITEMS_SHOWN, floorGroups: ITEMS_SHOWN,
  transformsClose: c => c.show.transforms,
  pendingLook: c => c.options.progressStyle === 'icons',
  highlightSeconds: c => c.options.highlight,
  whoOutlineColor: c => c.options.whoOutline !== 'none',
  whoOutlineSize: c => c.options.whoOutline !== 'none',
  blindColor: c => c.options.blindMark !== 'none',
  color: c => c.options.background === 'solid',
  backgroundOpacity: c => c.options.background !== 'transparent',
  radius: c => c.options.background !== 'transparent' || !!c.options.bgImage,
  bgImageOpacity: c => !!c.options.bgImage,
  bgImageFit: c => !!c.options.bgImage,
  bgImageScale: c => !!c.options.bgImage && ['tile', 'scale'].includes(c.options.bgImageFit),
  bgImageX: c => !!c.options.bgImage && c.options.bgImageFit !== 'stretch',
  bgImageY: c => !!c.options.bgImage && c.options.bgImageFit !== 'stretch',
  highlightStyle: c => c.options.highlight,
  sideAuto: c => c.options.layout === 'banner',
  sideWidth: c => c.options.layout === 'banner' && !c.options.sideAuto,
};
const MAIN = 'main';
// Comunes a todos los perfiles: no se exportan ni se importan (la ventana es una sola y la imagen, un archivo).
const GLOBAL_OPTIONS = ['viewWidth', 'viewHeight', 'bgImage'];
// Perfil que edita este panel (?profile= en la dirección). Sus peticiones y su vista previa usan ese perfil.
const PROFILE = new URLSearchParams(location.search).get('profile') || MAIN;
const api = path => path + (PROFILE !== MAIN ? '?profile=' + encodeURIComponent(PROFILE) : '');
const withProfile = (url, id) => url + (id && id !== MAIN ? '?profile=' + encodeURIComponent(id) : '');
const $ = id => document.getElementById(id);
const overlayUrl = new URL('overlay.html', location.href).href;
if (PROFILE !== MAIN) $('preview').src = withProfile('overlay.html', PROFILE);
let config = null;
let defaults = null;
let appearance = {};
let lang = 'en';
let desktop = false;
let obsUrl = overlayUrl;
let saveFileError = '';
const tr = (key, vars) => I18N.t(lang, key, vars);

// data: { show: clave } para lo que se muestra, o { list: 'goals' | 'watched', id } para contadores y logros.
// Así syncChecks() puede volver a marcarlas tras restablecer o deshacer.
function checkbox(parent, label, data, onChange) {
  const l = document.createElement('label'), c = document.createElement('input');
  c.type = 'checkbox';
  Object.assign(c.dataset, data);
  c.addEventListener('change', () => onChange(c.checked));
  l.append(c, ' ' + label);
  parent.append(l);
}

function syncChecks() {
  for (const c of document.querySelectorAll('input[data-show]')) c.checked = !!config.show[c.dataset.show];
  for (const c of document.querySelectorAll('input[data-list]')) c.checked = config[c.dataset.list].includes(c.dataset.id);
  updateListCounts();
}

function syncDependents() {
  for (const e of document.querySelectorAll('[data-option]')) {
    const on = DEPENDS[e.dataset.option];
    if (on) e.disabled = !on(config);
  }
  $('testHighlight').disabled = !config.options.highlight;
  $('highlightNote').textContent = config.options.highlight ? tr('highlight.about.' + config.options.highlightStyle) : '';
}

// Petición POST con JSON. Lanza un error con el mensaje del servidor si no se pudo.
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const res = await r.json();
  if (!r.ok) throw new Error(res.error || tr('save.failed'));
  return res;
}

// Pide un nombre en la fila indicada (el programa de escritorio no admite prompt()). Enter acepta y Esc cancela.
function askName(rowId, initial, onOk) {
  const row = $(rowId), input = row.querySelector('input');
  const close = () => { row.hidden = true; };
  const ok = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    close();
    await onOk(name);
  };
  row.querySelector('.name-ok').onclick = ok;
  row.querySelector('.name-cancel').onclick = close;
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); ok(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  input.value = initial || '';
  row.hidden = false;
  input.focus();
  input.select();
}

// Mientras se arrastra un deslizador o se elige un color, la vista previa cambia sin esperar a guardarlo.
function livePreview() {
  const preview = $('preview').contentWindow;
  if (preview && preview.previewConfig) preview.previewConfig(config);
}

// La ventana del tracker guarda su tamaño al estirarla: el panel solo lo envía si el usuario lo cambia en sus campos,
// para no devolverla al tamaño anterior al cambiar cualquier otra opción.
const SIZE_OPTIONS = ['viewWidth', 'viewHeight'];

// Devuelve el mensaje de error del servidor, o '' si se guardó.
async function save(sizeChanged = false) {
  const payload = { ...config, options: { ...config.options } };
  if (!sizeChanged) for (const k of SIZE_OPTIONS) delete payload.options[k];
  const r = await fetch(api('api/config'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await r.json();
  if (!r.ok) return body.error || tr('save.failed');
  applyConfig(body);
  return '';
}

function applyConfig(next) {
  config = next;
  syncPreviewSize();
  syncIconControls();
  syncBgImage();
  syncDependents();
  const preview = $('preview').contentWindow;
  if (preview && preview.refresh) preview.refresh();
}

// En modo banner la vista previa tiene el tamaño real de la ventana.
function syncPreviewSize() {
  const banner = config.options.layout === 'banner', p = $('preview');
  p.classList.toggle('banner', banner);
  p.style.width = banner ? config.options.viewWidth + 'px' : '';
  p.style.height = banner ? config.options.viewHeight + 'px' : '';
}

// El tamaño fijo no se aplica en automático; y unas filas que no caben se avisan en vez de cambiarlas.
function syncIconControls() {
  const o = config.options;
  const size = o.iconAuto ? MIN_AUTO_ICON : o.iconSize;
  const floorRow = o.floorGroups ? FLOOR_LABEL_HEIGHT : 0;
  const needed = o.rows * (size + floorRow) + (o.rows - 1) * o.iconGap + o.padding * 2;
  $('iconNote').textContent = o.layout === 'banner' && o.rows && needed > o.viewHeight ? tr('look.rowsTooTall', { needed, height: o.viewHeight }) : '';
}

// ---------- Imagen de fondo ----------
const BG_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

function syncBgImage() {
  const o = config.options, has = !!o.bgImage;
  $('bgImageStatus').textContent = tr(has ? 'look.bgImageSet' : 'look.bgImageNone');
  $('bgImageRemove').hidden = !has;
}

async function sendBackground(body) {
  const r = await fetch(api('api/background'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const res = await r.json();
  $('bgImageError').textContent = r.ok ? '' : res.error || tr('save.failed');
  if (r.ok) applyConfig(res);
}

function initBgImage() {
  const input = $('bgImageFile');
  $('bgImageChoose').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    if (f.size > BG_IMAGE_MAX_BYTES) { $('bgImageError').textContent = tr('err.bgImage'); return; }
    const reader = new FileReader();
    reader.onload = () => sendBackground({ data: reader.result });
    reader.readAsDataURL(f);
  });
  $('bgImageRemove').addEventListener('click', () => sendBackground({ remove: true }));
  syncBgImage();
}

function toggleInList(list, id, on) {
  const i = list.indexOf(id);
  if (on && i < 0) list.push(id);
  if (!on && i >= 0) list.splice(i, 1);
}

function saveLabel(s) {
  const owner = s.account === 'local' ? tr('save.local') : tr('save.account', { account: s.account });
  const prog = s.deadGod ? 'Dead God' : s.achievements ? tr('save.achievements', s.achievements) : tr('save.noData');
  const time = s.playtime ? ` · ${I18N.duration(lang, s.playtime)}` : '';
  return `${owner} · ${tr('save.slot', { slot: s.slot })} · ${prog}${time} · ${new Date(s.mtime).toLocaleDateString(lang)}`;
}

async function setSaveFile(file) {
  // "Copiar como ruta" de Windows añade comillas.
  const clean = file.trim().replace(/^"(.*)"$/, '$1');
  const previous = config.saveFile;
  config.saveFile = clean;
  saveFileError = await save();
  if (saveFileError) config.saveFile = previous;
  $('saveFile').value = saveFileError ? clean : config.saveFile;
  refreshStatus();
}

function initSavePicker(choices) {
  const select = $('saveId');
  for (const s of choices.saves) select.add(new Option(saveLabel(s), s.id));
  select.add(new Option(tr('save.other'), CUSTOM_SAVE));
  if (!config.saveId) select.add(new Option(tr('save.choose'), ''), 0);
  // Si el guardado elegido ya no existe, se indica en vez de mostrar otro en su lugar.
  if (config.saveId && config.saveId !== CUSTOM_SAVE && !choices.saves.some(s => s.id === config.saveId)) {
    select.add(new Option(tr('save.notFound', { id: config.saveId }), config.saveId), 0);
  }
  select.value = config.saveId || '';
  $('saveFile').value = config.saveFile;
  $('customSave').hidden = config.saveId !== CUSTOM_SAVE;

  select.addEventListener('change', async () => {
    config.saveId = select.value || null;
    $('customSave').hidden = config.saveId !== CUSTOM_SAVE;
    saveFileError = '';
    await save();
    refreshStatus();
  });
  $('saveFile').addEventListener('change', () => setSaveFile($('saveFile').value));
  $('browseSave').addEventListener('click', async () => {
    $('browseSave').disabled = true;
    try {
      const r = await fetch('api/pick-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json());
      if (r.path) await setSaveFile(r.path);
    } finally { $('browseSave').disabled = false; }
  });
}

function showOption(e) {
  e[e.type === 'checkbox' ? 'checked' : 'value'] = config.options[e.dataset.option];
  const out = e.parentElement.querySelector('output');
  if (out) out.value = e.value;
}

const readOption = e => (e.type === 'checkbox' ? e.checked : e.type === 'number' || e.type === 'range' ? Number(e.value) : e.value);

function initOptions() {
  for (const e of document.querySelectorAll('[data-option]')) {
    const key = e.dataset.option;
    showOption(e);
    e.addEventListener('input', () => {
      const out = e.parentElement.querySelector('output');
      if (out) out.value = e.value;
      // Los números a medio escribir (un ancho de "9") no se muestran: se aplican al confirmar el campo.
      if (e.type === 'number') return;
      config.options[key] = readOption(e);
      syncDependents();
      livePreview();
    });
    e.addEventListener('change', async () => {
      config.options[key] = readOption(e);
      hideToast();
      await save(SIZE_OPTIONS.includes(key));
      // El servidor rechaza los valores no válidos: el control vuelve al valor guardado.
      showOption(e);
    });
  }
}

// ---------- Cambios en bloque: temas y «Restablecer», con «Deshacer» ----------
let toastTimer = null;
const TOAST_MS = 15000;
const snapshot = () => JSON.parse(JSON.stringify({ show: config.show, goals: config.goals, watched: config.watched, options: config.options }));

// La imagen de fondo solo se cambia con sus botones: ni un tema ni deshacer la quitan o la recuperan.
async function restore(state) {
  const sizeChanged = SIZE_OPTIONS.some(k => state.options[k] !== config.options[k]);
  const bgImage = config.options.bgImage;
  Object.assign(config, JSON.parse(JSON.stringify(state)));
  config.options.bgImage = bgImage;
  await save(sizeChanged);
  document.querySelectorAll('[data-option]').forEach(showOption);
  syncChecks();
}

async function bulkChange(message, change) {
  const before = snapshot();
  const after = snapshot();
  change(after);
  await restore(after);
  showToast(message, () => restore(before));
}

// Sin onUndo, el aviso solo informa.
function showToast(message, onUndo) {
  $('toastText').textContent = message;
  $('toastUndo').hidden = !onUndo;
  $('toastUndo').onclick = async () => { hideToast(); await onUndo(); };
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  $('toast').hidden = true;
}

// Cada sección con data-reset lleva su botón: vuelve a los valores por defecto de los controles que contiene.
function initResets() {
  for (const box of document.querySelectorAll('[data-reset]')) {
    const heading = box.querySelector('h2, h3');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reset';
    button.textContent = tr('panel.reset');
    button.title = tr('panel.resetTitle');
    heading.classList.add('with-reset');
    heading.append(button);
    button.addEventListener('click', () => bulkChange(tr('panel.sectionReset', { name: heading.firstChild.textContent }), next => {
      for (const e of box.querySelectorAll('[data-option]')) next.options[e.dataset.option] = defaults.options[e.dataset.option];
      for (const c of box.querySelectorAll('input[data-show]')) next.show[c.dataset.show] = defaults.show[c.dataset.show];
      for (const list of new Set([...box.querySelectorAll('input[data-list]')].map(c => c.dataset.list))) next[list] = [...defaults[list]];
    }));
  }
}

// ---------- Contadores y logros vigilados: búsqueda y recuento ----------
const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function initListTools() {
  for (const box of document.querySelectorAll('.pick-list')) {
    const search = box.querySelector('.list-search');
    search.addEventListener('input', () => {
      const q = fold(search.value.trim());
      let shown = 0;
      for (const label of box.querySelectorAll('.checks label')) {
        const hit = !q || fold(label.textContent).includes(q);
        label.hidden = !hit;
        if (hit) shown++;
      }
      box.querySelector('.list-empty').hidden = shown > 0;
    });
  }
  updateListCounts();
}

function updateListCounts() {
  for (const box of document.querySelectorAll('.pick-list')) {
    const checks = box.querySelectorAll('.checks input');
    const n = [...checks].filter(c => c.checked).length;
    box.querySelector('.list-count').textContent = tr('list.count', { n, total: checks.length });
  }
}

function initThemes() {
  const select = $('theme');
  select.add(new Option(tr('look.applyTheme'), ''));
  for (const id of Object.keys(THEMES)) select.add(new Option(tr('theme.' + id), id));
  select.addEventListener('change', async () => {
    const id = select.value;
    select.value = '';
    if (!id) return;
    await bulkChange(tr('panel.themeApplied', { name: tr('theme.' + id) }), next => Object.assign(next.options, appearance, THEMES[id]));
  });
  $('themeSave').addEventListener('click', () => askName('themeNameRow', '', name => themeRequest({ action: 'save', name, options: config.options },
    () => showToast(tr('theme.saved', { name }), null))));
  renderMyThemes();
}

// ---------- Temas del usuario ----------
async function themeRequest(body, after) {
  $('themeError').textContent = '';
  try {
    config.themes = (await post('api/themes', body)).themes;
    renderMyThemes();
    if (after) await after();
  } catch (e) { $('themeError').textContent = e.message; }
}

function button(text, onClick, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (title) { b.title = title; b.setAttribute('aria-label', title); }
  b.addEventListener('click', onClick);
  return b;
}

function renderMyThemes() {
  const box = $('myThemes');
  box.replaceChildren();
  if (!config.themes.length) return;
  const head = document.createElement('div');
  head.className = 'my-themes-title';
  head.textContent = tr('theme.mine');
  box.append(head);
  for (const t of config.themes) {
    const row = document.createElement('div'), name = document.createElement('span');
    row.className = 'my-theme';
    name.textContent = t.name;
    row.append(name,
      button(tr('theme.apply'), () => bulkChange(tr('panel.themeApplied', { name: t.name }), next => Object.assign(next.options, appearance, t.options))),
      button('✎', () => askName('themeNameRow', t.name, n => themeRequest({ action: 'rename', id: t.id, name: n })), tr('theme.rename')),
      button('×', () => themeRequest({ action: 'delete', id: t.id },
        () => showToast(tr('theme.deleted', { name: t.name }), () => themeRequest({ action: 'save', name: t.name, options: t.options }))), tr('theme.delete')));
    box.append(row);
  }
}

// ---------- Perfiles ----------
const profileName = p => (p.id === MAIN ? tr('profile.main') : p.name);
const gotoProfile = id => { location.href = withProfile(location.pathname, id); };

function fillProfileSelects() {
  for (const [id, value] of [['profileSelect', config.profile], ['windowProfile', config.windowProfile], ['obsProfile', config.obsProfile]]) {
    const select = $(id);
    select.replaceChildren(...config.profileList.map(p => new Option(profileName(p), p.id)));
    select.value = value;
  }
  $('profileRename').disabled = $('profileDelete').disabled = config.profile === MAIN;
}

async function profileRequest(body, after) {
  $('profileError').textContent = '';
  try { await after(await post('api/profiles', body)); } catch (e) { $('profileError').textContent = e.message; }
}

function initProfiles() {
  fillProfileSelects();
  $('profileSelect').addEventListener('change', () => gotoProfile($('profileSelect').value));
  $('profileNew').addEventListener('click', () => askName('profileNameRow', '', name =>
    profileRequest({ action: 'create', name, from: config.profile }, c => gotoProfile(c.profile))));
  $('profileRename').addEventListener('click', () => {
    const current = config.profileList.find(p => p.id === config.profile);
    askName('profileNameRow', current && current.name, name => profileRequest({ action: 'rename', id: config.profile, name }, c => {
      config.profileList = c.profileList;
      fillProfileSelects();
    }));
  });
  $('profileDelete').addEventListener('click', () => {
    const current = config.profileList.find(p => p.id === config.profile);
    if (!confirm(tr('profile.confirmDelete', { name: current ? current.name : '' }))) return;
    profileRequest({ action: 'delete', id: config.profile }, () => gotoProfile(MAIN));
  });
  for (const key of ['windowProfile', 'obsProfile']) {
    $(key).addEventListener('change', async () => {
      config[key] = $(key).value;
      await save();
      fillProfileSelects();
      $('link').textContent = obsLink();
    });
  }
}

// ---------- Exportar e importar ----------
// look: solo la apariencia (lo que cambia un tema). all: también qué se muestra, contadores, logros vigilados y temas.
function exportSettings(scope) {
  const data = { app: 'MultiTracker', kind: 'settings', version: 1, scope };
  if (scope === 'look') data.options = Object.fromEntries(Object.keys(appearance).map(k => [k, config.options[k]]));
  else {
    data.options = Object.fromEntries(Object.entries(config.options).filter(([k]) => !GLOBAL_OPTIONS.includes(k)));
    Object.assign(data, { show: config.show, goals: config.goals, watched: config.watched, themes: config.themes.map(({ name, options }) => ({ name, options })) });
  }
  const current = config.profileList.find(p => p.id === config.profile);
  const slug = fold(profileName(current || { id: MAIN })).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'perfil';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `multitracker-${scope === 'look' ? 'look' : 'settings'}-${slug}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function importSettings(file) {
  $('transferError').textContent = '';
  let data = null;
  try { data = JSON.parse(await file.text()); } catch { /* se avisa abajo */ }
  if (!data || data.app !== 'MultiTracker' || data.kind !== 'settings' || !data.options || typeof data.options !== 'object') {
    $('transferError').textContent = tr('transfer.invalid');
    return;
  }
  // El servidor descarta lo que no conozca; aquí solo se evita tocar lo común a todos los perfiles.
  const options = Object.fromEntries(Object.entries(data.options).filter(([k]) => !GLOBAL_OPTIONS.includes(k) && k in config.options));
  let themes = 0;
  for (const t of Array.isArray(data.themes) ? data.themes : []) {
    try { config.themes = (await post('api/themes', { action: 'save', name: t && t.name, options: t && t.options })).themes; themes++; } catch { /* nombre vacío o demasiados temas */ }
  }
  renderMyThemes();
  const message = tr('transfer.imported', { name: file.name }) + (themes ? ' ' + tr('transfer.themesAdded', { n: themes }) : '');
  await bulkChange(message, next => {
    Object.assign(next.options, options);
    if (data.show && typeof data.show === 'object') Object.assign(next.show, data.show);
    for (const k of ['goals', 'watched']) if (Array.isArray(data[k])) next[k] = data[k].filter(x => typeof x === 'string');
  });
}

function initTransfer() {
  $('exportLook').addEventListener('click', () => exportSettings('look'));
  $('exportAll').addEventListener('click', () => exportSettings('all'));
  $('importButton').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', () => {
    const f = $('importFile').files[0];
    $('importFile').value = '';
    if (f) importSettings(f);
  });
}

// Las fuentes instaladas en el PC se añaden a las sugeridas. Windows tarda un momento en listarlas: no se espera.
async function initFonts() {
  const list = $('fonts');
  const known = new Set([...list.options].map(o => o.value));
  try {
    const { fonts } = await fetch('api/fonts').then(r => r.json());
    for (const name of fonts) if (!known.has(name)) list.append(new Option(name, name));
  } catch { /* se quedan las sugeridas */ }
}

// Cambiar de idioma recarga el panel: así todos los textos, también los que vienen del servidor, salen ya traducidos.
function initLanguage(languages) {
  const select = $('language');
  for (const [id, name] of Object.entries(languages)) select.add(new Option(name, id));
  select.value = lang;
  select.addEventListener('change', async () => {
    config.language = select.value;
    await save();
    location.reload();
  });
}

function initAbout() {
  const [before, after = ''] = tr('about.supportText').split('{link}');
  const a = document.createElement('a');
  a.href = KOFI; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Ko-fi';
  $('supportText').replaceChildren(before, a, after);
}

// En la aplicación de escritorio, el enlace para OBS solo existe si el usuario lo activa.
function initObs() {
  if (!desktop) return;
  $('obsOption').hidden = false;
  $('obsNote').hidden = false;
  $('obsServer').checked = !!config.obsServer;
  $('obsServer').addEventListener('change', async () => {
    config.obsServer = $('obsServer').checked;
    await save();
    refreshStatus();
  });
}

// Enlace para la fuente de navegador de OBS, con el perfil elegido para OBS.
const obsLink = () => withProfile(obsUrl, config.obsProfile);

function syncObs(obs) {
  if (!desktop) return;
  const running = !!(obs && obs.running);
  if (obs && obs.url) obsUrl = obs.url;
  $('link').textContent = obsLink();
  $('linkRow').hidden = !running;
  $('obsProfileRow').hidden = !running;
  $('copyLink').hidden = !running;
  $('obsNote').className = 'note' + (obs && obs.error ? ' error' : '');
  $('obsNote').textContent = obs && obs.error ? tr('obs.portBusy', { port: obs.port }) : tr('obs.serverNote');
}

async function refreshStatus() {
  const s = await fetch(api('api/state')).then(r => r.json());
  // Si se ha estirado la ventana del tracker, el ancho y el alto del panel la siguen (salvo mientras se escriben).
  const o = s.config.options;
  if (SIZE_OPTIONS.some(k => o[k] !== config.options[k])) {
    for (const k of SIZE_OPTIONS) {
      config.options[k] = o[k];
      const input = document.querySelector(`[data-option="${k}"]`);
      if (input !== document.activeElement) showOption(input);
    }
    syncPreviewSize();
    syncIconControls();
  }
  const logErr = s.sources.log.error, src = s.sources.save;
  $('logStatus').className = 'note' + (logErr ? ' error' : '');
  $('logStatus').textContent = logErr ? tr('run.logError', { error: logErr })
    : s.run ? tr('run.following', { seed: s.run.seed, slot: s.run.slot })
    : s.sources.log.missing ? tr('run.noLog') : tr('run.none');
  const error = saveFileError || src.error;
  $('saveStatus').className = 'note' + (error ? ' error' : '');
  if (saveFileError) $('saveStatus').textContent = saveFileError;
  else if (src.error) $('saveStatus').textContent = (s.progress ? tr('save.lastValid') : '') + src.error;
  else {
    const time = s.playtime ? tr('save.playtime', { time: I18N.duration(lang, s.playtime) }) : '';
    $('saveStatus').textContent = tr('save.reading', { file: src.file }) + time + (s.progress && s.progress.complete ? tr('save.complete') : '');
  }
  syncObs(s.obs);
}

async function init() {
  const [state, choices] = await Promise.all([fetch(api('api/state')).then(r => r.json()), fetch('api/choices').then(r => r.json())]);
  appearance = choices.appearance;
  config = state.config;
  lang = state.lang;
  desktop = state.desktop;
  document.documentElement.lang = lang;
  I18N.apply(lang, document);

  syncPreviewSize();
  initLanguage(choices.languages);
  initAbout();
  initSavePicker(choices);
  defaults = choices.defaults;
  const group = (parent, keys, prefix) => {
    for (const k of keys) checkbox(parent, tr(prefix + k), { show: k }, on => { config.show[k] = on; hideToast(); save(); });
  };
  group($('showRun'), RUN_SHOW, 'run.');
  group($('showProgress'), PROGRESS_SHOW, 'progress.');
  const pick = (list, entries) => {
    for (const x of entries) checkbox($(list), x.name, { list, id: x.id }, on => { toggleInList(config[list], x.id, on); hideToast(); updateListCounts(); save(); });
  };
  pick('goals', choices.goals);
  pick('watched', choices.watched);
  syncChecks();
  initOptions();
  initBgImage();
  syncIconControls();
  syncDependents();
  initThemes();
  initProfiles();
  initTransfer();
  initResets();
  initListTools();
  $('toastClose').addEventListener('click', hideToast);
  initObs();
  initFonts();

  $('testHighlight').addEventListener('click', () => $('preview').contentWindow.testHighlight());
  $('link').textContent = obsLink();
  $('copyLink').addEventListener('click', async () => {
    await navigator.clipboard.writeText(obsLink());
    $('copyLink').textContent = tr('panel.linkCopied');
    setTimeout(() => { $('copyLink').textContent = tr('panel.copyLink'); }, 1500);
  });
  $('openWindow').addEventListener('click', () => window.open(withProfile(overlayUrl, config.windowProfile), 'isaac-tracker', `popup,width=${config.options.viewWidth},height=${config.options.viewHeight}`));

  refreshStatus();
  setInterval(refreshStatus, STATUS_POLL_MS);
}

init();
