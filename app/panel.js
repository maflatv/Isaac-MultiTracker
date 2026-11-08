// Panel de configuración: cada cambio se guarda al momento y la vista lo recoge en su siguiente lectura.
// Fuera de la suite el panel está en la raíz: no hay hub al que volver.
if (location.pathname === '/') document.querySelector('a.back').remove();
document.getElementById('about').addEventListener('click', () => document.getElementById('aboutDialog').showModal());

const STATUS_POLL_MS = 3000;
const WINDOW_FEATURES = 'popup,width=900,height=121';
const CUSTOM_SAVE = 'custom';
const BANNER_HEIGHT = 121;
const MIN_AUTO_ICON = 24;
const FLOOR_LABEL_HEIGHT = 14;
const KOFI = 'https://ko-fi.com/maflatv';
const RUN_SHOW = ['character', 'seed', 'floor', 'items', 'description', 'transforms'];
const PROGRESS_SHOW = ['winStreak', 'achievements', 'collection', 'marksHard', 'marksAny', 'challenges'];
// Cada tema parte de la apariencia por defecto y cambia solo lo indicado.
const THEMES = {
  default: {},
  stream: { fontSize: 16, textEffect: 'outline', textColor: '#ffffff', accentColor: '#ffd84d', doneColor: '#7dff7d', iconEffect: 'shadow' },
  minimal: { fontSize: 12, bold: false, textEffect: 'none', iconGap: 0, rowGap: 2, padding: 4 },
  dungeon: { font: 'Georgia', accentColor: '#e0655f', doneColor: '#f0ad4e', iconEffect: 'shadow', background: 'brick', padding: 10 },
  contrast: { textEffect: 'none', textColor: '#ffffff', accentColor: '#ffe600', doneColor: '#00ff66', background: 'solid', color: '#000000', padding: 10 },
};
const $ = id => document.getElementById(id);
const overlayUrl = new URL('overlay.html', location.href).href;
let config = null;
let lang = 'en';
let desktop = false;
let obsUrl = overlayUrl;
let saveFileError = '';
const tr = (key, vars) => I18N.t(lang, key, vars);

function checkbox(parent, label, checked, onChange) {
  const l = document.createElement('label'), c = document.createElement('input');
  c.type = 'checkbox'; c.checked = checked;
  c.addEventListener('change', () => onChange(c.checked));
  l.append(c, ' ' + label);
  parent.append(l);
}

// Devuelve el mensaje de error del servidor, o '' si se guardó.
async function save() {
  const r = await fetch('api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
  const body = await r.json();
  if (!r.ok) return body.error || tr('save.failed');
  config = body;
  syncPreviewSize();
  syncIconControls();
  const preview = $('preview').contentWindow;
  if (preview && preview.refresh) preview.refresh();
  return '';
}

// En modo banner la vista previa tiene el tamaño real de la ventana.
function syncPreviewSize() {
  $('preview').classList.toggle('banner', config.options.layout === 'banner');
}

// El tamaño fijo no se aplica en automático; y unas filas que no caben se avisan en vez de cambiarlas.
function syncIconControls() {
  const o = config.options;
  document.querySelector('[data-option="iconSize"]').disabled = o.iconAuto;
  const size = o.iconAuto ? MIN_AUTO_ICON : o.iconSize;
  const floorRow = o.floorGroups ? FLOOR_LABEL_HEIGHT : 0;
  const needed = o.rows * (size + floorRow) + (o.rows - 1) * o.iconGap + o.padding * 2;
  $('iconNote').textContent = o.layout === 'banner' && o.rows && needed > BANNER_HEIGHT ? tr('look.rowsTooTall', { needed, height: BANNER_HEIGHT }) : '';
}

function toggleInList(list, id, on) {
  const i = list.indexOf(id);
  if (on && i < 0) list.push(id);
  if (!on && i >= 0) list.splice(i, 1);
}

function saveLabel(s) {
  const owner = s.account === 'local' ? tr('save.local') : tr('save.account', { account: s.account });
  const prog = s.deadGod ? 'Dead God' : s.achievements ? tr('save.achievements', s.achievements) : tr('save.noData');
  return `${owner} · ${tr('save.slot', { slot: s.slot })} · ${prog} · ${new Date(s.mtime).toLocaleDateString(lang)}`;
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

function initOptions() {
  for (const e of document.querySelectorAll('[data-option]')) {
    const key = e.dataset.option;
    showOption(e);
    e.addEventListener('input', () => { const out = e.parentElement.querySelector('output'); if (out) out.value = e.value; });
    e.addEventListener('change', async () => {
      config.options[key] = e.type === 'checkbox' ? e.checked : e.type === 'number' || e.type === 'range' ? Number(e.value) : e.value;
      await save();
      // El servidor rechaza los valores no válidos: el control vuelve al valor guardado.
      showOption(e);
    });
  }
}

function initThemes(appearance) {
  const select = $('theme');
  select.add(new Option(tr('look.applyTheme'), ''));
  for (const id of Object.keys(THEMES)) select.add(new Option(tr('theme.' + id), id));
  select.addEventListener('change', async () => {
    if (!select.value) return;
    Object.assign(config.options, appearance, THEMES[select.value]);
    select.value = '';
    await save();
    document.querySelectorAll('[data-option]').forEach(showOption);
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

function syncObs(obs) {
  if (!desktop) return;
  const running = !!(obs && obs.running);
  if (obs && obs.url) obsUrl = obs.url;
  $('link').textContent = obsUrl;
  $('linkRow').hidden = !running;
  $('copyLink').hidden = !running;
  $('obsNote').className = 'note' + (obs && obs.error ? ' error' : '');
  $('obsNote').textContent = obs && obs.error ? tr('obs.portBusy', { port: obs.port }) : tr('obs.serverNote');
}

async function refreshStatus() {
  const s = await fetch('api/state').then(r => r.json());
  const logErr = s.sources.log.error, src = s.sources.save;
  $('logStatus').className = 'note' + (logErr ? ' error' : '');
  $('logStatus').textContent = logErr ? tr('run.logError', { error: logErr })
    : s.run ? tr('run.following', { seed: s.run.seed, slot: s.run.slot })
    : s.sources.log.missing ? tr('run.noLog') : tr('run.none');
  const error = saveFileError || src.error;
  $('saveStatus').className = 'note' + (error ? ' error' : '');
  if (saveFileError) $('saveStatus').textContent = saveFileError;
  else if (src.error) $('saveStatus').textContent = (s.progress ? tr('save.lastValid') : '') + src.error;
  else $('saveStatus').textContent = tr('save.reading', { file: src.file }) + (s.progress && s.progress.complete ? tr('save.complete') : '');
  syncObs(s.obs);
}

async function init() {
  const [state, choices] = await Promise.all([fetch('api/state').then(r => r.json()), fetch('api/choices').then(r => r.json())]);
  config = state.config;
  lang = state.lang;
  desktop = state.desktop;
  document.documentElement.lang = lang;
  I18N.apply(lang, document);

  syncPreviewSize();
  initLanguage(choices.languages);
  initAbout();
  initSavePicker(choices);
  const group = (parent, keys, prefix) => {
    for (const k of keys) checkbox(parent, tr(prefix + k), config.show[k], on => { config.show[k] = on; save(); });
  };
  group($('showRun'), RUN_SHOW, 'run.');
  group($('showProgress'), PROGRESS_SHOW, 'progress.');
  for (const g of choices.goals) checkbox($('goals'), g.name, config.goals.includes(g.id), on => { toggleInList(config.goals, g.id, on); save(); });
  for (const w of choices.watched) checkbox($('watched'), w.name, config.watched.includes(w.id), on => { toggleInList(config.watched, w.id, on); save(); });
  initOptions();
  syncIconControls();
  initThemes(choices.appearance);
  initObs();
  initFonts();

  $('testHighlight').addEventListener('click', () => $('preview').contentWindow.testHighlight());
  $('link').textContent = obsUrl;
  $('copyLink').addEventListener('click', async () => {
    await navigator.clipboard.writeText(obsUrl);
    $('copyLink').textContent = tr('panel.linkCopied');
    setTimeout(() => { $('copyLink').textContent = tr('panel.copyLink'); }, 1500);
  });
  $('openWindow').addEventListener('click', () => window.open(overlayUrl, 'isaac-tracker', WINDOW_FEATURES));

  refreshStatus();
  setInterval(refreshStatus, STATUS_POLL_MS);
}

init();
