// Página de LiveSplit (edición avanzada): conexión, modo de split, run de Dead God, ruta y su editor.
const POLL_MS = 1000;
const MANY_MARKS = 6;
const $ = id => document.getElementById(id);
let lang = 'en';
let status = null;
let catalog = null;
let editing = -1;
let lastSegments = '';
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

function renderConnection() {
  const c = status.connection, st = status.settings;
  let text;
  if (!st.enabled) text = tr('conn.off');
  else if (!c.connected) text = tr('conn.waiting', { port: st.port });
  else {
    text = tr('conn.ok') + (c.phase ? ' ' + tr('phase.' + c.phase) + '.' : '');
    if (c.phase === 'Running' || c.phase === 'Paused') text += ' ' + tr('conn.split', { n: c.index + 1, name: c.name || status.segments[c.index]?.name || '' });
  }
  $('connStatus').textContent = text;
  $('connHelp').hidden = !st.enabled || c.connected;
  const want = status.segments[c.index];
  $('mismatch').hidden = !c.mismatch;
  if (c.mismatch) $('mismatch').textContent = tr('conn.mismatch', { name: c.name, want: want ? want.name : '' });
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
}

function renderSegments() {
  const segs = status.segments, c = status.connection;
  const current = c.connected && (c.phase === 'Running' || c.phase === 'Paused') ? c.index : -1;
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
  renderConnection();
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
    status = await post({ action: 'importLss', text: await f.text(), fileName: f.name });
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
