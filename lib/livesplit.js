// Cliente del servidor TCP de LiveSplit (clic derecho → Control → Start TCP Server, o «iniciar al abrir» en sus ajustes).
// Las órdenes van una por línea. Solo responden las consultas (get..., ping): una línea cada una, en el orden pedido.
// Comprobado con LiveSplit 1.8.37: getsplitindex, getcurrenttimerphase, getcurrentsplitname, getcurrentgametime, ping.
const net = require('net');

const RETRY_MS = 3000;
const QUERY_TIMEOUT_MS = 1500;

class LiveSplit {
  constructor({ host = '127.0.0.1', port = 16834 } = {}) {
    this.host = host;
    this.port = port;
    this.socket = null;
    this.connected = false;
    this.error = null;
    this.buffer = '';
    this.waiting = [];
    this.retry = null;
    this.stopped = true;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  // Cambia de dirección o puerto (ajustes del panel): se reconecta con los nuevos.
  configure({ host, port }) {
    if (host === this.host && port === this.port) return;
    this.host = host;
    this.port = port;
    if (this.socket) this.socket.destroy();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    if (this.socket) this.socket.destroy();
  }

  connect() {
    if (this.stopped || this.socket) return;
    const socket = net.connect({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    socket.on('connect', () => { this.connected = true; this.error = null; });
    socket.on('data', d => this.receive(d));
    socket.on('error', e => { this.error = e.code || e.message; });
    socket.on('close', () => {
      this.socket = null;
      this.connected = false;
      this.buffer = '';
      for (const w of this.waiting.splice(0)) { clearTimeout(w.timer); w.reject(new Error('closed')); }
      if (!this.stopped) this.retry = setTimeout(() => this.connect(), RETRY_MS);
    });
  }

  receive(data) {
    this.buffer += data;
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).replace(/\r$/, '');
      this.buffer = this.buffer.slice(i + 1);
      const w = this.waiting.shift();
      if (w) { clearTimeout(w.timer); w.resolve(line); }
    }
  }

  // Orden sin respuesta (starttimer, split, skipsplit, pause, resume, setgametime...). Devuelve false si no hay conexión.
  send(command) {
    if (!this.connected) return false;
    this.socket.write(command + '\r\n');
    return true;
  }

  // Consulta con respuesta. Si no llega a tiempo, la conexión se da por perdida: las respuestas irían desfasadas.
  query(command) {
    if (!this.connected) return Promise.reject(new Error('offline'));
    return new Promise((resolve, reject) => {
      const w = { resolve, reject };
      w.timer = setTimeout(() => {
        reject(new Error('timeout'));
        if (this.socket) this.socket.destroy();
      }, QUERY_TIMEOUT_MS);
      this.waiting.push(w);
      this.socket.write(command + '\r\n');
    });
  }
}

// "01:02:03.9024458" o "1.02:03:04.5" (con días) → segundos. "-" o vacío → null.
function parseTime(text) {
  const m = /^(?:(\d+)\.)?(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(text || '').trim());
  return m ? (+(m[1] || 0)) * 86400 + +m[2] * 3600 + +m[3] * 60 + +m[4] : null;
}

// Segundos → "H:MM:SS.ss", lo que entiende setgametime.
function formatTime(seconds) {
  const s = Math.max(0, seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), rest = s - h * 3600 - m * 60;
  return `${h}:${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

module.exports = { LiveSplit, parseTime, formatTime };
