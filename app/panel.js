// Panel de configuración: cada cambio se guarda al momento y la vista lo recoge en su siguiente lectura.
// Fuera de la suite el panel está en la raíz: no hay hub al que volver.
if (location.pathname === '/') document.querySelector('a.back').remove();

const STATUS_POLL_MS = 3000;
const WINDOW_FEATURES = 'popup,width=900,height=121';
const CUSTOM_SAVE = 'custom';
const BANNER_HEIGHT = 121;
const MIN_AUTO_ICON = 24;
const FLOOR_LABEL_HEIGHT = 14;
const RUN_SHOW = { character: 'Personaje', seed: 'Seed', floor: 'Piso', items: 'Objetos', description: 'Descripción del último objeto', transforms: 'Transformaciones' };
const PROGRESS_SHOW = { winStreak: 'Racha (Win Streak)', achievements: 'Logros', collection: 'Objetos de la colección', marksHard: 'Marcas en difícil', marksAny: 'Marcas (cualquiera)', challenges: 'Retos' };
// Cada tema parte de la apariencia por defecto y cambia solo lo indicado.
const THEMES = {
  'Por defecto': {},
  'Stream legible': { fontSize: 16, textEffect: 'outline', textColor: '#ffffff', accentColor: '#ffd84d', doneColor: '#7dff7d', iconEffect: 'shadow' },
  'Minimalista': { fontSize: 12, bold: false, textEffect: 'none', iconGap: 0, rowGap: 2, padding: 4 },
  'Mazmorra': { font: 'Georgia', accentColor: '#e0655f', doneColor: '#f0ad4e', iconEffect: 'shadow', background: 'brick', padding: 10 },
  'Alto contraste': { textEffect: 'none', textColor: '#ffffff', accentColor: '#ffe600', doneColor: '#00ff66', background: 'solid', color: '#000000', padding: 10 },
};
const $ = id => document.getElementById(id);
const overlayUrl = new URL('overlay.html', location.href).href;
let config = null;
let saveFileError = '';

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
  if (!r.ok) return body.error || 'No se pudo guardar';
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
  $('iconNote').textContent = o.layout === 'banner' && o.rows && needed > BANNER_HEIGHT
    ? `Esas filas necesitan ${needed} px de alto: en el banner de ${BANNER_HEIGHT} px se cortarán. Reduce las filas o el tamaño, o agranda la ventana.`
    : '';
}

function toggleInList(list, id, on) {
  const i = list.indexOf(id);
  if (on && i < 0) list.push(id);
  if (!on && i >= 0) list.splice(i, 1);
}

function saveLabel(s) {
  const owner = s.account === 'local' ? 'Local' : `Cuenta ${s.account}`;
  const prog = s.deadGod ? 'Dead God' : s.achievements ? `${s.achievements.done}/${s.achievements.total} logros` : 'sin datos';
  return `${owner} · ranura ${s.slot} · ${prog} · ${new Date(s.mtime).toLocaleDateString()}`;
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

function initSavePicker(state, choices) {
  const select = $('saveId');
  for (const s of choices.saves) select.add(new Option(saveLabel(s), s.id));
  select.add(new Option('Otro archivo…', CUSTOM_SAVE));
  if (!config.saveId) select.add(new Option('Elige un guardado…', ''), 0);
  // Si el guardado elegido ya no existe, se indica en vez de mostrar otro en su lugar.
  if (config.saveId && config.saveId !== CUSTOM_SAVE && !choices.saves.some(s => s.id === config.saveId)) {
    select.add(new Option(`${config.saveId} (no encontrado)`, config.saveId), 0);
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
  select.add(new Option('Aplicar un tema…', ''));
  for (const name of Object.keys(THEMES)) select.add(new Option(name, name));
  select.addEventListener('change', async () => {
    if (!select.value) return;
    Object.assign(config.options, appearance, THEMES[select.value]);
    select.value = '';
    await save();
    document.querySelectorAll('[data-option]').forEach(showOption);
  });
}

async function refreshStatus() {
  const s = await fetch('api/state').then(r => r.json());
  const logErr = s.sources.log.error, src = s.sources.save;
  $('logStatus').className = 'note' + (logErr ? ' error' : '');
  $('logStatus').textContent = logErr ? 'No se puede leer log.txt: ' + logErr : s.run ? `Siguiendo la partida ${s.run.seed} (ranura ${s.run.slot}).` : 'Sin partida en el log.';
  const error = saveFileError || src.error;
  $('saveStatus').className = 'note' + (error ? ' error' : '');
  if (saveFileError) $('saveStatus').textContent = saveFileError;
  else if (src.error) $('saveStatus').textContent = (s.progress ? 'Mostrando la última lectura válida. ' : '') + src.error;
  else $('saveStatus').textContent = `Leyendo ${src.file}${s.progress && s.progress.complete ? '. Está al 100%: el progreso no se muestra.' : ''}`;
}

async function init() {
  const [state, choices] = await Promise.all([fetch('api/state').then(r => r.json()), fetch('api/choices').then(r => r.json())]);
  config = state.config;

  syncPreviewSize();
  initSavePicker(state, choices);
  const group = (parent, labels) => {
    for (const [k, label] of Object.entries(labels)) checkbox(parent, label, config.show[k], on => { config.show[k] = on; save(); });
  };
  group($('showRun'), RUN_SHOW);
  group($('showProgress'), PROGRESS_SHOW);
  for (const g of choices.goals) checkbox($('goals'), g.name, config.goals.includes(g.id), on => { toggleInList(config.goals, g.id, on); save(); });
  for (const w of choices.watched) checkbox($('watched'), w.name, config.watched.includes(w.id), on => { toggleInList(config.watched, w.id, on); save(); });
  initOptions();
  syncIconControls();
  initThemes(choices.appearance);

  $('testHighlight').addEventListener('click', () => $('preview').contentWindow.testHighlight());
  $('link').textContent = overlayUrl;
  $('copyLink').addEventListener('click', async () => {
    await navigator.clipboard.writeText(overlayUrl);
    $('copyLink').textContent = 'Enlace copiado';
    setTimeout(() => { $('copyLink').textContent = 'Copiar enlace para OBS'; }, 1500);
  });
  $('openWindow').addEventListener('click', () => window.open(overlayUrl, 'isaac-tracker', WINDOW_FEATURES));

  refreshStatus();
  setInterval(refreshStatus, STATUS_POLL_MS);
}

init();
