// Vista de carrera: una franja por cada código de la carrera (como mucho 4). Cada franja es la vista normal del tracker
// con ?race=N, así que se dibuja igual que una partida propia. Solo se rehacen las franjas si cambia cuáles hay o cómo
// se reparten; lo demás (nombres, códigos, retraso, aspecto) lo recoge cada franja en su siguiente lectura.
const POLL_MS = 2000;
const box = document.getElementById('race');
let shown = '';

async function refresh() {
  const race = await fetch('api/race').then(r => r.json());
  // El número de cada franja es su hueco en el panel (1 a 4): los huecos vacíos no se muestran.
  const slots = race.slots.map((s, i) => (s.code ? i + 1 : 0)).filter(Boolean);
  const key = race.layout + ':' + slots.join(',');
  if (key === shown) return;
  shown = key;
  box.className = race.layout;
  box.replaceChildren(...slots.map(n => {
    const frame = document.createElement('iframe');
    frame.src = 'overlay.html?race=' + n;
    frame.title = 'MultiTracker ' + n;
    return frame;
  }));
}

async function tick() {
  try { await refresh(); } catch { /* servidor parado: se reintenta */ }
  setTimeout(tick, POLL_MS);
}
tick();
