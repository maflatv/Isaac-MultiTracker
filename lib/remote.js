// Ver la partida de otra persona y dejar que otros vean la propia, a través del servicio de relay/worker.js.
// Quien comparte tiene un código (público: quien lo tenga puede mirar) y una clave (privada: solo con ella se sube).
// Quien mira recibe cada partida al momento por WebSocket; si no puede, la pide cada POLL_MS.

// Dirección del servicio publicado (relay/LEEME.md), en la cuenta de Cloudflare de MaflaTV. Vacía: la función se
// muestra como no disponible.
const DEFAULT_RELAY = 'https://multitracker-relay.maflatv.workers.dev';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE = new RegExp(`^[${CODE_ALPHABET}]{7}$`);
// Los objetos, pisos y jugadores se suben enseguida; el resto (tiempo, progreso) como mucho cada SLOW_MS.
const FAST_MS = 2000;
const SLOW_MS = 30000;
const POLL_MS = 3000;
const RETRY_MS = [3000, 5000, 10000, 30000];
const NOT_FOUND_RETRY_MS = 30000;
// WebSocket que no llegan a abrirse antes de pasar a preguntar por HTTP.
const WS_ATTEMPTS = 2;
// Un código que ninguna vista ha pedido en este tiempo deja de seguirse.
const IDLE_MS = 60000;
// Se guarda lo recibido en los últimos MAX_DELAY_S segundos, para mostrarlo con retraso.
const MAX_DELAY_S = 120;

// Lo que se escribe a mano: sin espacios ni guiones y en mayúsculas. Los códigos no usan 0, O, 1 ni I, que se confunden.
const normalizeCode = text => String(text || '').toUpperCase().replace(/[\s-]/g, '');
const isCode = c => CODE.test(c);

class Remote {
  // relayUrl: dirección del servicio. fetchImpl y WebSocketImpl se pueden cambiar en las pruebas (null: sin WebSocket).
  constructor({ relayUrl = DEFAULT_RELAY, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket, now = Date.now } = {}) {
    this.relay = String(relayUrl || '').replace(/\/+$/, '');
    this.fetch = fetchImpl;
    this.WebSocket = WebSocketImpl;
    this.now = now;
    this.watchers = new Map();
    this.share = { status: 'off', watchers: 0, error: null, lastSent: null, sentAt: 0, fastKey: null, timer: null, sending: false };
    this.idleTimer = setInterval(() => this.dropIdle(), IDLE_MS / 2);
    if (this.idleTimer.unref) this.idleTimer.unref();
  }

  get available() { return !!this.relay; }

  async request(method, path, { key, body } = {}) {
    const headers = {};
    if (key) headers.Authorization = 'Bearer ' + key;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await this.fetch(this.relay + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* sin cuerpo JSON */ }
    return { status: r.status, data };
  }

  // ---------- Compartir ----------
  async createShare() {
    if (!this.available) throw new Error('unavailable');
    const r = await this.request('POST', '/v1/rooms');
    if (r.status !== 201 || !r.data || !isCode(r.data.code)) throw new Error('relay ' + r.status);
    return { code: r.data.code, key: r.data.key };
  }

  async deleteShare(share) {
    if (!this.available || !share || !share.code) return;
    try { await this.request('DELETE', '/v1/rooms/' + share.code, { key: share.key }); } catch { /* se borrará solo */ }
  }

  // Llamar a menudo con lo que se quiere compartir. Sube enseguida si cambian los objetos, los pisos o los jugadores
  // (fastKey) y, si solo cambia lo demás, como mucho cada SLOW_MS. share: { code, key } o null para dejar de subir.
  offer(share, payload, fastKey) {
    const s = this.share;
    if (!share || !this.available) { s.status = 'off'; s.lastSent = null; s.fastKey = null; return; }
    if (s.status === 'off') s.status = 'connecting';
    s.target = share;
    s.pending = payload;
    s.pendingFast = fastKey;
    this.flushShare();
  }

  flushShare() {
    const s = this.share;
    if (s.sending || s.timer || !s.pending) return;
    const text = JSON.stringify(s.pending);
    if (text === s.lastSent) return;
    const urgent = s.pendingFast !== s.fastKey;
    const wait = Math.max(0, s.sentAt + (urgent ? FAST_MS : SLOW_MS) - this.now());
    if (wait > 0) {
      s.timer = setTimeout(() => { s.timer = null; this.flushShare(); }, wait);
      if (s.timer.unref) s.timer.unref();
      return;
    }
    this.sendShare(text, s.pendingFast);
  }

  async sendShare(text, fastKey) {
    const s = this.share, target = s.target;
    s.sending = true;
    s.sentAt = this.now();
    try {
      const r = await this.fetch(this.relay + '/v1/rooms/' + target.code, { method: 'PUT', headers: { Authorization: 'Bearer ' + target.key, 'Content-Type': 'application/json' }, body: text });
      const data = await r.json().catch(() => null);
      if (r.status === 200) {
        Object.assign(s, { status: 'ok', error: null, watchers: (data && data.watchers) || 0, lastSent: text, fastKey });
      } else if (r.status === 404 || r.status === 403) {
        Object.assign(s, { status: 'error', error: 'lost' });
      } else if (r.status !== 429) {
        Object.assign(s, { status: 'error', error: 'relay' });
      }
    } catch {
      Object.assign(s, { status: 'error', error: 'offline' });
    } finally {
      s.sending = false;
      // Si falló, se reintenta con la siguiente llamada a offer() tras FAST_MS.
      if (s.status === 'ok') this.flushShare();
    }
  }

  shareStatus() {
    const s = this.share;
    return { status: s.status, watchers: s.watchers, error: s.error };
  }

  // ---------- Ver ----------
  // Lo que se ve de un código, con delay segundos de retraso: { status, data, at }.
  // status: 'connecting', 'live', 'waiting' (aún no ha subido nada), 'notFound', 'offline' o 'unavailable'.
  view(code, delay = 0) {
    if (!this.available) return { status: 'unavailable', data: null, at: null };
    let w = this.watchers.get(code);
    if (!w) { w = new Watcher(this, code); this.watchers.set(code, w); w.start(); }
    w.usedAt = this.now();
    return w.pick(delay);
  }

  dropIdle() {
    for (const [code, w] of this.watchers) if (this.now() - w.usedAt > IDLE_MS) { w.stop(); this.watchers.delete(code); }
  }

  close() {
    clearInterval(this.idleTimer);
    if (this.share.timer) clearTimeout(this.share.timer);
    for (const w of this.watchers.values()) w.stop();
    this.watchers.clear();
  }
}

class Watcher {
  constructor(remote, code) {
    this.remote = remote;
    this.code = code;
    this.history = [];
    this.status = 'connecting';
    this.usedAt = remote.now();
    this.failures = 0;
    this.wsFailures = 0;
    this.stopped = false;
    this.ws = null;
    this.timer = null;
  }

  start() {
    if (this.remote.WebSocket) this.connect(); else this.poll();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.ws) { try { this.ws.close(); } catch { /* ya cerrado */ } }
  }

  later(fn, ms) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(fn, ms);
    if (this.timer.unref) this.timer.unref();
  }

  receive(entry) {
    if (!entry || typeof entry.v !== 'number') return;
    const last = this.history[this.history.length - 1];
    if (last && entry.v <= last.v) return;
    this.history.push({ v: entry.v, at: entry.at || this.remote.now(), data: entry.data });
    // Se conserva la última que ya es más antigua que el mayor retraso posible: es la que se ve con ese retraso.
    const cutoff = this.remote.now() - MAX_DELAY_S * 1000;
    while (this.history.length > 1 && this.history[1].at <= cutoff) this.history.shift();
    this.status = 'live';
  }

  connect() {
    const url = this.remote.relay.replace(/^http/, 'ws') + '/v1/rooms/' + this.code + '/ws';
    let opened = false;
    try { this.ws = new this.remote.WebSocket(url); } catch { this.poll(); return; }
    this.ws.onopen = () => { opened = true; this.failures = 0; if (this.status !== 'live') this.status = 'waiting'; };
    this.ws.onmessage = e => { if (e.data !== 'pong') { try { this.receive(JSON.parse(e.data)); } catch { /* mensaje dañado */ } } };
    this.ws.onclose = () => {
      this.ws = null;
      if (this.stopped) return;
      // Sin abrirse: puede que el código no exista, o que la red no deje usar WebSocket. Se pregunta por HTTP y, si
      // tampoco se abre la segunda vez, se sigue preguntando por HTTP.
      if (!opened) {
        if (++this.wsFailures >= WS_ATTEMPTS) { this.poll(); return; }
        this.checkOnce().then(() => this.later(() => this.connect(), this.retryDelay()));
        return;
      }
      this.later(() => this.connect(), this.retryDelay());
    };
  }

  retryDelay() {
    if (this.status === 'notFound') return NOT_FOUND_RETRY_MS;
    return RETRY_MS[Math.min(this.failures++, RETRY_MS.length - 1)];
  }

  async checkOnce() {
    try {
      const r = await this.remote.request('GET', '/v1/rooms/' + this.code);
      if (r.status === 404) this.status = 'notFound';
      else if (r.status === 204) this.status = 'waiting';
      else if (r.status === 200) this.receive(r.data);
      else this.status = 'offline';
    } catch { this.status = 'offline'; }
  }

  async poll() {
    await this.checkOnce();
    this.later(() => this.poll(), this.status === 'notFound' ? NOT_FOUND_RETRY_MS : POLL_MS);
  }

  pick(delay) {
    const cutoff = this.remote.now() - Math.max(0, delay) * 1000;
    let shown = null;
    for (const e of this.history) if (e.at <= cutoff) shown = e;
    const status = this.history.length && !shown ? 'delayed' : this.status;
    return { status, data: shown ? shown.data : null, at: shown ? shown.at : null };
  }
}

module.exports = { Remote, normalizeCode, isCode, DEFAULT_RELAY };
