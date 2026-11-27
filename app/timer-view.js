// Edición avanzada: fuente de OBS del cronómetro con splits (overlay.html?part=timer).
// La carga overlay.js, que aplica el tema del perfil (letra, colores, fondo) y llama a TimerView.render en cada lectura.
// Los tiempos se piden a api/timer cada POLL_MS; entre lecturas, el reloj corre aquí para verse fluido.
(() => {
  const POLL_MS = 250;
  const DRAW_MS = 50;
  // Segmentos ya hechos que se ven por encima del actual cuando no caben todos.
  const PAST_ROWS = 2;
  // ?rows=N en la dirección: filas de esta fuente (p. ej. una vertical más baja); sin él, las del perfil.
  const URL_ROWS = Math.max(0, Math.min(40, parseInt(new URLSearchParams(location.search).get('rows'), 10) || 0));
  let data = null, got = 0, host = null, rowsKey = '', lastDraw = 0;
  let clockEl = null, segEl = null, rowEls = [], footEl = null;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // 1:02:03 o 2:03 (sin horas si no hay).
  function clockParts(sec) {
    const s = Math.max(0, sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.floor(s % 60);
    const main = h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
    return [main, '.' + Math.floor((s * 10) % 10)];
  }
  const fmtTime = sec => (sec === null || sec === undefined ? '-' : clockParts(sec)[0]);
  // Diferencia con el PB: +12.3 por debajo del minuto; si no, +1:23 o +1:02:03.
  function fmtDelta(d) {
    if (d === null || d === undefined) return '';
    const sign = d < 0 ? '−' : '+', a = Math.abs(d);
    if (a < 60) return sign + a.toFixed(1);
    return sign + clockParts(a)[0];
  }
  const deltaClass = (d, gold) => (gold ? 'gold' : d === null ? '' : d < 0 ? 'ahead' : d > 0 ? 'behind' : '');

  // Etiqueta del tiempo del segmento, en el idioma de la vista (overlay.js lo pone en <html lang>).
  const segLabel = () => (document.documentElement.lang === 'es' ? 'Segmento' : document.documentElement.lang === 'pt' ? 'Segmento' : 'Segment');

  const now = () => (data ? data.time + (data.running ? (performance.now() - got) / 1000 : 0) : 0);

  // Qué segmentos se ven: los últimos hechos, el actual y los siguientes, con el último siempre al final.
  function visible(rows, index, max) {
    const n = rows.length;
    if (n <= max) return rows.map((_, i) => i);
    const room = max - 1;
    const start = Math.max(0, Math.min((index < 0 ? 0 : index) - PAST_ROWS, n - 1 - room));
    const list = [];
    for (let i = start; i < start + room; i++) list.push(i);
    if (list[list.length - 1] !== n - 1) list.push(n - 1);
    else list.unshift(start - 1);
    return list.filter(i => i >= 0);
  }

  function build() {
    const d = data;
    const box = el('div', 'tv');
    // Tamaños del panel del cronómetro, en % sobre la letra del tema.
    box.style.setProperty('--tv-text', (d.textSize || 100) / 100);
    box.style.setProperty('--tv-clock', (d.clockSize || 100) / 100);
    if (d.title) box.append(el('div', 'tv-title', d.title));
    // Con tiempos antiguos (PB), van en su columna, a la izquierda y separados del tiempo de este intento.
    const hasPb = d.rows.some(r => r.pb !== null);
    const list = el('ol', 'tv-rows' + (hasPb ? ' with-pb' : ''));
    rowEls = [];
    for (const i of visible(d.rows, d.index, URL_ROWS || d.visible || 10)) {
      const r = d.rows[i];
      const li = el('li', 'tv-row');
      if (i < d.index) li.classList.add(r.skipped ? 'skipped' : 'done');
      if (i === d.index && d.phase !== 'NotRunning' && d.phase !== 'Ended') li.classList.add('current');
      const delta = el('span', 'tv-delta ' + deltaClass(r.delta, r.gold), fmtDelta(r.delta));
      // Tiempo de este intento: vacío si aún no se ha llegado, «-» si se saltó.
      const time = el('span', 'tv-time', r.time !== null || r.skipped ? fmtTime(r.time) : '');
      li.append(el('span', 'tv-name', r.name || '…'), delta);
      if (hasPb) li.append(el('span', 'tv-old', r.pb !== null ? fmtTime(r.pb) : ''));
      li.append(time);
      li.dataset.i = i;
      list.append(li);
      rowEls.push({ i, li, delta });
    }
    // Separador antes del último segmento si no va justo después de los demás.
    const items = [...list.children];
    for (let k = 1; k < items.length; k++) if (+items[k].dataset.i !== +items[k - 1].dataset.i + 1) items[k].classList.add('gap');
    if (d.rows.length) box.append(list);
    clockEl = el('div', 'tv-clock');
    box.append(clockEl);
    segEl = d.showSegment !== false && d.rows.length ? el('div', 'tv-seg') : null;
    if (segEl) box.append(segEl);
    footEl = el('div', 'tv-foot');
    if (d.showPb && d.pb !== null) footEl.append(el('span', '', 'PB ' + fmtTime(d.pb)));
    if (d.showSob && d.sumOfBest !== null) footEl.append(el('span', '', 'SoB ' + fmtTime(d.sumOfBest)));
    if (footEl.childNodes.length) box.append(footEl);
    host.replaceChildren(box);
  }

  // El reloj y la diferencia del segmento actual cambian a cada momento; el resto, solo con datos nuevos.
  function tick() {
    if (!data || !clockEl) return;
    const t = now(), d = data, cur = d.rows[d.index];
    const [main, tenth] = clockParts(t);
    clockEl.replaceChildren(main, el('small', '', tenth));
    let state = '';
    const live = cur && cur.pb !== null && d.phase !== 'NotRunning' && d.phase !== 'Ended' ? t - cur.pb : null;
    if (live !== null && live > 0) state = 'behind';
    else {
      // La última diferencia conocida dice si se va por delante o por detrás del PB.
      for (let i = Math.min(d.index, d.rows.length) - 1; i >= 0; i--) if (d.rows[i] && d.rows[i].delta !== null) { state = d.rows[i].delta < 0 ? 'ahead' : 'behind'; break; }
    }
    clockEl.className = 'tv-clock ' + state + (d.phase === 'Paused' ? ' paused' : '') + (d.phase === 'Ended' ? ' ended' : '') + (d.phase === 'NotRunning' ? ' idle' : '');
    // Tiempo del segmento actual: desde el último split con tiempo (los saltados no cuentan como inicio).
    if (segEl) {
      let from = 0;
      for (let i = Math.min(d.index, d.rows.length) - 1; i >= 0; i--) if (d.rows[i] && d.rows[i].time !== null) { from = d.rows[i].time; break; }
      const seg = d.phase === 'NotRunning' ? 0 : d.phase === 'Ended' ? (d.rows.length ? d.rows[d.rows.length - 1].segment : null) : t - from;
      const [sm, st] = clockParts(seg === null || seg === undefined ? 0 : seg);
      segEl.replaceChildren(el('span', 'tv-seg-label', segLabel()), el('span', '', sm), el('small', '', st));
      segEl.classList.toggle('idle', d.phase === 'NotRunning' || d.phase === 'Paused');
    }
    // Por detrás del PB en el segmento actual: la diferencia se ve mientras corre, como en LiveSplit.
    const row = rowEls.find(r => r.i === d.index);
    if (row && cur && cur.time === null) {
      row.delta.textContent = live !== null && live > 0 ? fmtDelta(live) : '';
      row.delta.className = 'tv-delta' + (live > 0 ? ' behind' : '');
    }
  }

  function loop() {
    const t = performance.now();
    if (t - lastDraw >= DRAW_MS) { lastDraw = t; tick(); }
    requestAnimationFrame(loop);
  }

  async function poll() {
    try {
      const r = await fetch('api/timer');
      if (r.ok) {
        data = await r.json();
        got = performance.now();
        // Se redibuja la lista solo si cambia algo más que el reloj.
        const key = JSON.stringify([data.rows, data.index, data.phase, data.title, data.visible, data.pb, data.sumOfBest, data.showPb, data.showSob, data.showSegment, data.textSize, data.clockSize]);
        if (key !== rowsKey && host) { rowsKey = key; build(); }
        tick();
      }
    } catch { /* servidor parado: se reintenta */ }
    setTimeout(poll, POLL_MS);
  }

  window.TimerView = {
    // overlay.js llama a esto con cada lectura del estado (el tema ya está aplicado).
    render(view) {
      if (host !== view) { host = view; rowsKey = ''; }
      view.className = 'timer';
      if (data && !view.querySelector('.tv')) build();
    },
  };
  poll();
  requestAnimationFrame(loop);
})();
