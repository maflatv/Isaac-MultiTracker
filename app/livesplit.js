// Página del cronómetro (edición avanzada): cronómetro propio con splits, modo de split, run de Dead God, ruta y su editor.
const POLL_MS = 1000;
const MANY_MARKS = 6;
const $ = id => document.getElementById(id);
let lang = 'en';
let status = null;
let catalog = null;
let editing = -1;
let lastSegments = '';
let timerLink = '';
let resetTimerArmed = null;
const tr = (key, vars) => LS_I18N.t(lang, key, vars);

function applyTexts() {
  for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = tr(e.dataset.i18n);
  for (const e of document.querySelectorAll('[data-i18n-title]')) e.title = tr(e.dataset.i18nTitle);
  for (const e of document.querySelectorAll('[data-i18n-aria]')) e.setAttribute('aria-label', tr(e.dataset.i18nAria));
  for (const e of document.querySelectorAll('[data-i18n-placeholder]')) e.placeholder = tr(e.dataset.i18nPlaceholder);
}

async function post(body) {
  const r = await fetch('api/livesplit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const res = await r.json();
  if (!r.ok) throw new Error(tr(res.error || 'err.action'));
  return res;
}

const fmt = s => {
  const t = Math.max(0, Math.floor(s || 0)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

// ---------- Condiciones en texto ----------
const achName = id => (catalog && (catalog.achievements.find(a => a.id === id) || {}).name) || `#${id}`;
const charName = row => (catalog && (catalog.characters.find(c => c.row === row) || {}).name) || `#${row}`;
const bossName = col => tr('boss.' + (catalog ? catalog.bosses[col] : col));
function markLevel(c) {
  if (catalog && catalog.bosses[c.col] === 'greed') return tr(c.min >= 2 ? 'cond.greedier' : 'cond.greed');
  return tr(c.min >= 2 ? 'cond.hard' : 'cond.normal');
}
function counterName(id) {
  if (catalog && id === catalog.counters.momsHeartKills) return tr('cond.momsHeart');
  if (catalog && id === catalog.counters.deaths) return tr('cond.deaths');
  return `#${id}`;
}
function condText(c) {
  switch (c.t) {
    case 'ach': return achName(c.id);
    case 'challenge': return tr('cond.challengeN', { n: c.id });
    case 'mark': return `${charName(c.row)} · ${bossName(c.col)} (${markLevel(c)})`;
    case 'counter': return `${counterName(c.id)} ≥ ${c.min}`;
    case 'achCount': return tr('cond.achN', { n: c.min });
    case 'collection': return tr('cond.collection');
    default: return '?';
  }
}
// Resumen de un segmento: las marcas de un mismo personaje van juntas; muchas, solo con su número.
function summary(conds) {
  const parts = [], byRow = new Map();
  for (const c of conds) {
    if (c.t === 'mark') { if (!byRow.has(c.row)) byRow.set(c.row, []); byRow.get(c.row).push(c); } else parts.push(condText(c));
  }
  for (const [row, marks] of byRow) {
    const hard = marks.every(m => m.min >= 2);
    const isGreed = m => catalog && catalog.bosses[m.col] === 'greed';
    const list = marks.length >= MANY_MARKS ? `${marks.length} ${tr('cond.mark').toLowerCase()}s` : marks.map(m => (isGreed(m) ? markLevel(m) : bossName(m.col))).join(', ');
    parts.push(`${charName(row)}: ${list}${hard ? ` (${tr('cond.hard')})` : ''}`);
  }
  if (conds.length > 30) return `${conds.length} × ${parts.slice(0, 3).join(' · ')}…`;
  return parts.join(' · ');
}

// ---------- Pintar ----------
const family = () => (status.deadGodModes.includes(status.settings.mode) ? 'deadgod' : 'single');

function renderSettings() {
  const st = status.settings;
  for (const e of document.querySelectorAll('[data-setting]')) {
    if (document.activeElement === e) continue;
    const v = st[e.dataset.setting];
    if (e.type === 'checkbox') e.checked = !!v; else e.value = v;
  }
  for (const e of document.querySelectorAll('[data-for-mode]')) e.hidden = e.dataset.forMode !== st.mode;
  for (const e of document.querySelectorAll('[data-for-family]')) e.hidden = e.dataset.forFamily !== family();
  $('modeAbout').textContent = tr('about.' + st.mode);
  $('autoStartLabel').textContent = tr(family() === 'deadgod' ? 'opt.autoStartDG' : 'opt.autoStart');
}

function renderTimer() {
  const t = status.timer, st = status.settings;
  $('timerClock').textContent = fmt(t.time) + '.' + Math.floor(((t.time || 0) * 10) % 10);
  let text = st.enabled ? tr('phase.' + t.phase) + '.' : tr('timer.off');
  if (t.phase === 'Running' || t.phase === 'Paused') text += ' ' + tr('timer.current', { n: t.index + 1, name: t.name || status.segments[t.index]?.name || '' });
  if (t.problem) text += ' ' + tr(t.problem);
  $('timerStatus').textContent = text;
  const running = t.phase === 'Running', paused = t.phase === 'Paused', idle = t.phase === 'NotRunning';
  const can = { start: idle, split: running, skip: running, undo: !idle && t.index > 0, pause: running || paused, reset: !idle };
  for (const b of $('timerButtons').querySelectorAll('button')) b.disabled = !can[b.dataset.op];
  $('timerPause').textContent = tr(paused ? 'timer.resume' : 'timer.pause');
  $('timerLink').textContent = timerLink;
}

function renderSession() {
  const s = status.session, save = status.save;
  $('sessionTime').textContent = s.finished ? tr('session.finished', { time: fmt(s.base) }) : s.base > 0 ? tr('session.time', { time: fmt(s.base) }) : tr('session.none');
  $('sessionSave').textContent = save.achievements === null ? tr('session.noSave') : tr('session.save', { done: save.achievements, total: save.total });
}

function renderRoute() {
  const r = status.route;
  const review = status.settings.mode === 'route' ? status.segments.filter(s => !s.sure || !s.conds.length).length : 0;
  $('routeSummary').textContent = r ? tr('route.summary', { name: r.name || r.category || '—', count: status.settings.mode === 'route' ? status.segments.length : '…', review }) : tr('route.none');
  $('exportLss').disabled = !status.segments.length;
  $('undoImport').hidden = !status.canUndoImport;
}

function renderSegments() {
  const segs = status.segments, t = status.timer;
  const current = t.phase === 'Running' || t.phase === 'Paused' ? t.index : -1;
  const key = JSON.stringify([segs, current, status.settings.mode, lang, !!catalog]);
  $('segEmpty').hidden = segs.length > 0;
  if (key === lastSegments) return;
  lastSegments = key;
  const list = $('segments');
  list.textContent = '';
  const editable = status.settings.mode === 'route';
  const byLog = status.settings.mode === 'runs';
  segs.forEach((s, i) => {
    const li = document.createElement('li');
    if (s.done) li.classList.add('done');
    if (i === current) li.classList.add('current');
    const name = document.createElement('span');
    name.className = 'seg-name';
    name.textContent = s.name;
    const conds = document.createElement('span');
    conds.className = 'seg-conds';
    conds.textContent = byLog && !s.conds.length ? tr('seg.byLog') : summary(s.conds);
    name.append(conds);
    const tags = document.createElement('span');
    tags.className = 'seg-tags';
    const tag = (cls, text) => { const t = document.createElement('span'); t.className = 'tag ' + cls; t.textContent = text; tags.append(t); };
    if (s.done) tag('done', tr('seg.done'));
    if (!s.conds.length && !byLog) tag('manual', tr('seg.manual'));
    else if (!s.sure) tag('review', tr('seg.review'));
    if (editable) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = tr('seg.edit');
      b.addEventListener('click', () => openEditor(i));
      tags.append(b);
    }
    li.append(name, tags);
    list.append(li);
  });
  const cur = list.querySelector('li.current');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function renderActions() {
  const ul = $('actions');
  ul.textContent = '';
  if (!status.actions.length) { const li = document.createElement('li'); li.textContent = tr('log.none'); ul.append(li); return; }
  for (const a of status.actions) {
    const li = document.createElement('li'), t = document.createElement('time');
    t.textContent = new Date(a.at).toLocaleTimeString();
    li.append(t, tr(a.key, a.vars));
    ul.append(li);
  }
}

function render() {
  renderSettings();
  renderTimer();
  renderSession();
  renderRoute();
  renderSegments();
  renderActions();
  if (editing >= 0) renderEditor();
}

// ---------- Ajustes ----------
for (const e of document.querySelectorAll('[data-setting]')) {
  e.addEventListener('change', async () => {
    const k = e.dataset.setting;
    const v = e.type === 'checkbox' ? e.checked : e.type === 'number' ? Number(e.value) : e.value;
    status = await post({ action: 'settings', settings: { [k]: v } });
    render();
  });
}

// Botones del cronómetro. Reiniciar pide confirmación (se pierde el intento).
for (const b of $('timerButtons').querySelectorAll('button')) {
  b.addEventListener('click', async () => {
    let op = b.dataset.op;
    if (op === 'pause' && status.timer.phase === 'Paused') op = 'resume';
    if (op === 'reset') {
      if (!resetTimerArmed) {
        b.textContent = tr('timer.resetConfirm');
        resetTimerArmed = setTimeout(() => { resetTimerArmed = null; b.textContent = tr('timer.reset'); }, 4000);
        return;
      }
      clearTimeout(resetTimerArmed);
      resetTimerArmed = null;
      b.textContent = tr('timer.reset');
    }
    try { status = await post({ action: 'timer', op }); render(); } catch { /* se verá en el siguiente refresco */ }
  });
}
$('timerCopy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(timerLink);
  $('timerCopy').textContent = tr('timer.copied');
  setTimeout(() => { $('timerCopy').textContent = tr('timer.copy'); }, 1500);
});

let resetArmed = null;
$('sessionReset').addEventListener('click', async () => {
  if (!resetArmed) {
    $('sessionReset').textContent = tr('session.resetConfirm');
    resetArmed = setTimeout(() => { resetArmed = null; $('sessionReset').textContent = tr('session.reset'); }, 4000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  $('sessionReset').textContent = tr('session.reset');
  status = await post({ action: 'newSession' });
  render();
});

// ---------- Ruta: importar y exportar ----------
$('importLss').addEventListener('click', () => $('lssFile').click());
$('lssFile').addEventListener('change', async () => {
  const f = $('lssFile').files[0];
  $('lssFile').value = '';
  if (!f) return;
  $('routeError').textContent = '';
  try {
    showPreview(await post({ action: 'previewLss', text: await f.text(), fileName: f.name }), f.name);
  } catch (e) { $('routeError').textContent = e.message; }
});

// Vista previa de la importación: qué trae el .lss, qué segmentos quedan a mano y qué se reemplaza.
let previewToken = null;
function showPreview(p, fileName) {
  previewToken = p.token;
  $('impFile').textContent = tr('imp.file', { file: fileName, game: p.game || '—', category: p.category || '—' });
  const list = (id, items) => {
    const ul = $(id);
    ul.textContent = '';
    for (const text of items) { const li = document.createElement('li'); li.textContent = text; ul.append(li); }
  };
  const manual = p.segments.filter(s => !s.sure || !s.conds).length;
  const brings = [
    tr('imp.segments', { count: p.segments.length }),
    p.pb !== null ? tr('imp.pb', { time: fmt(p.pb), method: tr('imp.method.' + p.method) }) : tr('imp.noPb'),
    tr('imp.golds', { count: p.golds }),
    tr('imp.attempts', { count: p.attemptCount, history: p.history }),
  ];
  if (p.otherMethod) brings.push(tr('imp.otherMethod'));
  if (p.comparisons.length) brings.push(tr('imp.comparisons', { names: p.comparisons.join(', ') }));
  if (p.icons) brings.push(tr('imp.icons', { count: p.icons }));
  if (p.autoSplitter) brings.push(tr('imp.autoSplitter'));
  if (p.fromBlock) brings.push(tr('imp.fromBlock'));
  list('impBrings', brings);
  $('impManual').textContent = manual ? tr('imp.manual', { count: manual, names: p.segments.filter(s => !s.sure || !s.conds).slice(0, 5).map(s => s.name).join(', ') + (manual > 5 ? '…' : '') }) : tr('imp.allSure');
  const replaces = [];
  if (p.current.name !== null) replaces.push(tr('imp.currentRoute', { name: p.current.name || '—', count: p.current.segments }));
  if (p.current.mode !== 'route') replaces.push(tr('imp.modeChange', { mode: tr('mode.' + p.current.mode) }));
  if (p.replaces) replaces.push(tr('imp.sameName', { pb: p.replaces.pb !== null ? fmt(p.replaces.pb) : '—', attempts: p.replaces.attempts, history: p.replaces.history }));
  if (p.running) replaces.push(tr('imp.running'));
  if (!replaces.length) replaces.push(tr('imp.nothing'));
  list('impReplaces', replaces);
  $('importDialog').showModal();
}
$('impConfirm').addEventListener('click', async () => {
  try {
    status = await post({ action: 'importLss', token: previewToken });
    render();
  } catch (e) { $('routeError').textContent = e.message; }
  previewToken = null;
  $('importDialog').close();
});
$('impCancel').addEventListener('click', () => $('importDialog').close());
// Cerrar con Esc o el botón: la importación pendiente se descarta.
$('importDialog').addEventListener('close', () => { if (previewToken) post({ action: 'cancelImport' }).catch(() => {}); previewToken = null; });
$('undoImport').addEventListener('click', async () => {
  $('routeError').textContent = '';
  try {
    status = await post({ action: 'undoImport' });
    render();
  } catch (e) { $('routeError').textContent = e.message; }
});
$('exportLss').addEventListener('click', async () => {
  $('routeError').textContent = '';
  try {
    const r = await post({ action: 'exportLss' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.text], { type: 'application/xml' }));
    a.download = r.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { $('routeError').textContent = e.message; }
});

// ---------- Editor de condiciones ----------
function routeBody(change) {
  const segments = status.segments.map(s => ({ name: s.name, conds: s.conds, sure: s.sure }));
  change(segments);
  return { action: 'route', route: { ...status.route, segments } };
}
async function saveRoute(change) {
  status = await post(routeBody(change));
  render();
}

function fillEditorChoices() {
  const opt = (sel, value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; sel.append(o); };
  $('achList').textContent = '';
  for (const a of catalog.achievements) { const o = document.createElement('option'); o.value = `${a.id} · ${a.name}`; $('achList').append(o); }
  $('markRow').textContent = '';
  for (const c of catalog.characters) opt($('markRow'), c.row, c.name);
  $('markCol').textContent = '';
  catalog.bosses.forEach((b, i) => opt($('markCol'), i, tr('boss.' + b)));
  $('markMin').textContent = '';
  opt($('markMin'), 1, tr('cond.normal') + ' / ' + tr('cond.greed'));
  opt($('markMin'), 2, tr('cond.hard') + ' / ' + tr('cond.greedier'));
  $('counterId').textContent = '';
  opt($('counterId'), catalog.counters.momsHeartKills, tr('cond.momsHeart'));
  opt($('counterId'), catalog.counters.deaths, tr('cond.deaths'));
}

function openEditor(i) {
  editing = i;
  renderEditor();
  syncCondType();
  if (!$('editor').open) $('editor').showModal();
}

function renderEditor() {
  const s = status.segments[editing];
  if (!s) { $('editor').close(); return; }
  $('editorTitle').textContent = tr('edit.title', { name: s.name });
  const list = $('condList');
  list.textContent = '';
  s.conds.forEach((c, k) => {
    const li = document.createElement('li'), b = document.createElement('button');
    li.textContent = condText(c);
    b.type = 'button';
    b.textContent = '×';
    b.addEventListener('click', () => saveRoute(segs => { segs[editing].conds.splice(k, 1); }));
    li.append(b);
    list.append(li);
  });
  $('condNone').hidden = s.conds.length > 0;
  $('markSure').hidden = s.sure;
}

function syncCondType() {
  for (const e of document.querySelectorAll('[data-cond]')) e.hidden = e.dataset.cond !== $('condType').value;
}
$('condType').addEventListener('change', syncCondType);

function newCondition() {
  const t = $('condType').value;
  if (t === 'ach') {
    const m = /^(\d+)/.exec($('achSearch').value.trim());
    return m ? { t, id: +m[1] } : null;
  }
  if (t === 'mark') return { t, row: +$('markRow').value, col: +$('markCol').value, min: +$('markMin').value };
  if (t === 'challenge') return { t, id: +$('challengeId').value };
  if (t === 'counter') return { t, id: +$('counterId').value, min: +$('counterMin').value };
  if (t === 'achCount') return { t, min: +$('achCountMin').value };
  return { t: 'collection' };
}
$('condAdd').addEventListener('click', async () => {
  const c = newCondition();
  if (!c) { $('achSearch').focus(); return; }
  await saveRoute(segs => { segs[editing].conds.push(c); segs[editing].sure = true; });
  $('achSearch').value = '';
});
$('markSure').addEventListener('click', () => saveRoute(segs => { segs[editing].sure = true; }));
$('editorClose').addEventListener('click', () => $('editor').close());
$('editor').addEventListener('close', () => { editing = -1; });

// ---------- Arranque ----------
async function refresh() {
  try {
    status = await fetch('api/livesplit').then(r => r.json());
    render();
  } catch { /* se reintenta en el siguiente */ }
}

(async () => {
  const s = await fetch('api/state').then(r => r.json());
  lang = s.lang;
  // Fuente de OBS del cronómetro: la del servidor de OBS si está activo; con el perfil elegido para OBS.
  const base = (s.obs && s.obs.url) || new URL('overlay.html', location.href).href;
  const prof = s.config && s.config.obsProfile;
  timerLink = base + '?part=timer' + (prof && prof !== 'main' ? '&profile=' + encodeURIComponent(prof) : '');
  document.documentElement.lang = lang;
  applyTexts();
  status = await fetch('api/livesplit').then(r => r.json());
  const mode = $('mode');
  for (const m of status.modes) { const o = document.createElement('option'); o.value = m; o.textContent = tr('mode.' + m); mode.append(o); }
  catalog = await post({ action: 'catalog' });
  fillEditorChoices();
  render();
  setInterval(refresh, POLL_MS);
})();
