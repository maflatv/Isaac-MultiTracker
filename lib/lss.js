// Archivos .lss de LiveSplit, completos: para pasarse de LiveSplit al tracker y volver sin perder nada.
// Lo que el tracker usa (segmentos, PB, golds, intentos, historial) se interpreta; lo que no usa (iconos, metadatos de
// speedrun.com, ajustes del autosplitter, offset, comparaciones propias) se guarda tal cual para devolverlo al exportar.
// Las condiciones de los splits automáticos van en un bloque <MultiTracker> que LiveSplit no lee (y al guardar quita).
//
// Tiempos en segundos. Cada tiempo es { r, g } (Real Time y Game Time); el que no esté, null.
const { parseTime, lssDate } = require('./timer.js');

const BLOCK_VERSION = 1;
const PB = 'Personal Best';

// ---------- XML mínimo ----------
// Nodos { name, attrs, children, text, start, end }: start y end delimitan el elemento en el texto, para copiar tal cual
// lo que no se interpreta.
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unxml = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (all, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
  return ENTITIES[e.toLowerCase()];
});
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [], text: '', start: 0, end: src.length };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (top.name !== m[2]) throw new Error('xml');
      top.end = re.lastIndex;
      stack.pop();
    } else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unxml(a[2] !== undefined ? a[2] : a[3]);
      const node = { name: m[3], attrs, children: [], text: '', start: m.index, end: re.lastIndex };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += unxml(m[6]);
    else if (m[0][1] !== '!' && m[0][1] !== '?') throw new Error('xml');
  }
  if (stack.length !== 1) throw new Error('xml');
  return root;
}

const child = (n, name) => (n ? n.children.find(c => c.name === name) || null : null);
const kids = (n, name) => (n ? n.children.filter(c => c.name === name) : []);
const textOf = n => (n ? n.text.trim() : '');
// Lo de dentro de un elemento, tal cual estaba en el archivo.
function inner(src, n) {
  if (!n) return '';
  const raw = src.slice(n.start, n.end);
  const open = raw.indexOf('>') + 1;
  return raw.endsWith('/>') && open === raw.length ? '' : raw.slice(open, raw.lastIndexOf('</'));
}

// <RealTime>/<GameTime> dentro de un nodo. Los .lss anteriores a la 1.6 ponen el tiempo como texto: es Real Time.
function timeOf(n) {
  if (!n) return { r: null, g: null };
  const r = child(n, 'RealTime'), g = child(n, 'GameTime');
  if (!r && !g) return { r: parseTime(n.text), g: null };
  return { r: parseTime(textOf(r)), g: parseTime(textOf(g)) };
}
const intAttr = (n, k) => { const v = parseInt(n.attrs[k], 10); return Number.isFinite(v) ? v : null; };

// ---------- Leer ----------
function parseLss(text) {
  const src = String(text || '');
  let doc;
  try { doc = parseXml(src); } catch { throw new Error('err.lss'); }
  const run = child(doc, 'Run');
  const segNodes = kids(child(run, 'Segments'), 'Segment');
  if (!run || !segNodes.length) throw new Error('err.lss');

  const comparisons = [];
  const segments = segNodes.map(s => {
    const splits = {};
    for (const st of kids(child(s, 'SplitTimes'), 'SplitTime')) {
      const name = st.attrs.name || '';
      if (!name) continue;
      if (name !== PB && !comparisons.includes(name)) comparisons.push(name);
      splits[name] = timeOf(st);
    }
    return {
      name: textOf(child(s, 'Name')),
      icon: inner(src, child(s, 'Icon')),
      pb: splits[PB] || { r: null, g: null },
      splits,
      best: timeOf(child(s, 'BestSegmentTime')),
      history: kids(child(s, 'SegmentHistory'), 'Time').map(t => ({ id: intAttr(t, 'id'), ...timeOf(t) })).filter(t => t.id !== null),
    };
  });

  const attempts = kids(child(run, 'AttemptHistory'), 'Attempt').map(a => ({
    id: intAttr(a, 'id'),
    started: a.attrs.started || null, startedSynced: a.attrs.isStartedSynced === 'True',
    ended: a.attrs.ended || null, endedSynced: a.attrs.isEndedSynced === 'True',
    ...timeOf(a), pause: parseTime(textOf(child(a, 'PauseTime'))),
  })).filter(a => a.id !== null);

  let block = null;
  const mt = child(run, 'MultiTracker');
  if (mt) try { block = JSON.parse(mt.text); } catch { block = null; }

  const count = parseInt(textOf(child(run, 'AttemptCount')), 10);
  return {
    version: run.attrs.version || '1.7.0',
    game: textOf(child(run, 'GameName')), category: textOf(child(run, 'CategoryName')),
    offset: textOf(child(run, 'Offset')) || '00:00:00',
    attemptCount: Number.isFinite(count) && count >= 0 ? count : attempts.length,
    attempts, segments, comparisons,
    raw: {
      gameIcon: inner(src, child(run, 'GameIcon')), layoutPath: inner(src, child(run, 'LayoutPath')),
      metadata: child(run, 'Metadata') ? inner(src, child(run, 'Metadata')) : null,
      autoSplitter: inner(src, child(run, 'AutoSplitterSettings')),
    },
    block: block && typeof block === 'object' ? block : null,
  };
}

// Qué método de tiempo es el del PB: Game Time si el PB lo tiene (Dead God se lleva así); si no, Real Time.
const methodOf = run => (run.segments.some(s => s.pb.g !== null) ? 'g' : 'r');

// ---------- Escribir ----------
// Segundos → tiempo de .lss ("01:02:03.4500000", con días "1.02:03:04.5000000").
function lssTime(seconds) {
  const s = Math.max(0, seconds), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(7).padStart(10, '0');
  return `${d ? d + '.' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${rest}`;
}
const timeTags = t => (t ? (t.r !== null && t.r !== undefined ? `<RealTime>${lssTime(t.r)}</RealTime>` : '') + (t.g !== null && t.g !== undefined ? `<GameTime>${lssTime(t.g)}</GameTime>` : '') : '');
const tag = (name, body, attrs = '') => (body ? `<${name}${attrs}>${body}</${name}>` : `<${name}${attrs} />`);

// run: lo mismo que devuelve parseLss (los campos que falten se escriben vacíos).
function buildLss(run) {
  const raw = run.raw || {};
  const segs = run.segments.map(s => {
    const comps = [`        ${tag('SplitTime', timeTags(s.pb), ` name="${PB}"`)}`];
    for (const name of run.comparisons || []) {
      const t = s.splits && s.splits[name];
      comps.push(`        ${tag('SplitTime', timeTags(t), ` name="${xml(name)}"`)}`);
    }
    const hist = (s.history || []).map(h => `        ${tag('Time', timeTags(h), ` id="${h.id}"`)}`);
    return '    <Segment>\n'
      + `      <Name>${xml(s.name)}</Name>\n`
      + `      ${tag('Icon', s.icon || '')}\n`
      + `      <SplitTimes>\n${comps.join('\n')}\n      </SplitTimes>\n`
      + `      ${tag('BestSegmentTime', timeTags(s.best))}\n`
      + (hist.length ? `      <SegmentHistory>\n${hist.join('\n')}\n      </SegmentHistory>\n` : '      <SegmentHistory />\n')
      + '    </Segment>\n';
  });
  const attempts = (run.attempts || []).map(a => {
    const attrs = ` id="${a.id}"` + (a.started ? ` started="${xml(a.started)}" isStartedSynced="${a.startedSynced ? 'True' : 'False'}"` : '')
      + (a.ended ? ` ended="${xml(a.ended)}" isEndedSynced="${a.endedSynced ? 'True' : 'False'}"` : '');
    const body = timeTags(a) + (a.pause !== null && a.pause !== undefined ? `<PauseTime>${lssTime(a.pause)}</PauseTime>` : '');
    return `    ${tag('Attempt', body, attrs)}`;
  });
  const metadata = raw.metadata !== null && raw.metadata !== undefined
    ? raw.metadata
    : '\n    <Run id="" />\n    <Platform usesEmulator="False">\n    </Platform>\n    <Region>\n    </Region>\n    <Variables />\n    <CustomVariables />\n  ';
  // En CDATA, "]]>" cerraría el bloque: dentro del JSON se escribe como > (sigue siendo el mismo JSON).
  const block = run.block ? `  <MultiTracker version="${BLOCK_VERSION}"><![CDATA[${JSON.stringify(run.block).replace(/]]>/g, ']]\\u003e')}]]></MultiTracker>\n` : '';
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<Run version="${xml(run.version || '1.7.0')}">\n`
    + `  ${tag('GameIcon', raw.gameIcon || '')}\n`
    + `  <GameName>${xml(run.game || '')}</GameName>\n  <CategoryName>${xml(run.category || '')}</CategoryName>\n`
    + `  <LayoutPath>${raw.layoutPath || '\n  '}</LayoutPath>\n`
    + `  <Metadata>${metadata}</Metadata>\n`
    + `  <Offset>${xml(run.offset || '00:00:00')}</Offset>\n`
    + `  <AttemptCount>${run.attemptCount || 0}</AttemptCount>\n`
    + (attempts.length ? `  <AttemptHistory>\n${attempts.join('\n')}\n  </AttemptHistory>\n` : '  <AttemptHistory />\n')
    + `  <Segments>\n${segs.join('')}  </Segments>\n`
    + `  ${tag('AutoSplitterSettings', raw.autoSplitter || '')}\n`
    + block
    + '</Run>\n';
}

module.exports = { parseLss, buildLss, methodOf, lssTime, lssDate, parseXml, PB };
