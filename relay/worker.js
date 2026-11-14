// Servicio para ver la partida de otra persona: quien juega sube su partida con su código y su clave; quien la mira la
// recibe al momento por WebSocket (o la pide por HTTP). Cloudflare Workers con un Durable Object por código.
// Rutas (v1):
//   POST   /v1/rooms             crea un código nuevo -> { code, key }. La clave solo la tiene quien comparte.
//   PUT    /v1/rooms/<código>    sube la partida (Authorization: Bearer <clave>) -> { watchers }
//   GET    /v1/rooms/<código>    la última partida -> { v, at, data }; 204 si aún no hay ninguna; 404 si el código no existe
//   GET    /v1/rooms/<código>/ws WebSocket: la última partida al conectar y cada una nueva al llegar
//   DELETE /v1/rooms/<código>    borra el código (con la clave)
// Un código sin partidas nuevas durante ROOM_TTL_MS se borra solo.

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 7;
const CODE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const MAX_BODY = 256 * 1024;
const MIN_PUBLISH_MS = 1000;
const ROOM_TTL_MS = 14 * 24 * 3600 * 1000;

const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
const randomKey = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const bearer = req => (/^Bearer (\w{16,128})$/.exec(req.headers.get('Authorization') || '') || [])[1] || '';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'v1' || parts[1] !== 'rooms') return json(404, { error: 'not found' });
    const room = code => env.ROOMS.get(env.ROOMS.idFromName(code));

    if (parts.length === 2 && req.method === 'POST') {
      const key = randomKey(), keyHash = await sha256(key);
      for (let i = 0; i < 5; i++) {
        const code = randomCode();
        const r = await room(code).fetch('https://room/init', { method: 'POST', body: JSON.stringify({ keyHash }) });
        if (r.status === 201) return json(201, { code, key });
      }
      return json(503, { error: 'try again' });
    }

    const code = (parts[2] || '').toUpperCase();
    if (!CODE.test(code)) return json(404, { error: 'not found' });
    const stub = room(code);
    if (parts.length === 4 && parts[3] === 'ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return json(426, { error: 'websocket expected' });
      return stub.fetch('https://room/ws', req);
    }
    if (parts.length !== 3) return json(404, { error: 'not found' });
    if (req.method === 'GET') return stub.fetch('https://room/latest');
    if (req.method === 'PUT') {
      const len = +req.headers.get('Content-Length') || 0;
      if (len > MAX_BODY) return json(413, { error: 'too large' });
      const body = await req.text();
      if (body.length > MAX_BODY) return json(413, { error: 'too large' });
      return stub.fetch('https://room/publish', { method: 'POST', headers: { Authorization: req.headers.get('Authorization') || '' }, body });
    }
    if (req.method === 'DELETE') return stub.fetch('https://room/delete', { method: 'POST', headers: { Authorization: req.headers.get('Authorization') || '' } });
    return json(405, { error: 'method not allowed' });
  },
};

// Un código: su clave (solo el hash), la última partida y quién la está mirando. Los WebSocket hibernan: mientras no
// llega nada nuevo, el objeto no cuesta nada.
export class Room {
  constructor(ctx) { this.ctx = ctx; }

  async authorized(req) {
    const keyHash = await this.ctx.storage.get('keyHash');
    return keyHash && bearer(req) && keyHash === await sha256(bearer(req));
  }

  async fetch(req) {
    const { pathname } = new URL(req.url);
    const storage = this.ctx.storage;
    if (pathname === '/init') {
      if (await storage.get('keyHash')) return json(409, { error: 'taken' });
      const { keyHash } = await req.json();
      await storage.put('keyHash', keyHash);
      await storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return json(201, {});
    }
    if (!(await storage.get('keyHash'))) return json(404, { error: 'not found' });
    if (pathname === '/latest') {
      const latest = await storage.get('latest');
      return latest ? json(200, latest) : json(204, null);
    }
    if (pathname === '/ws') {
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      const latest = await storage.get('latest');
      if (latest) server.send(JSON.stringify(latest));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!(await this.authorized(req))) return json(403, { error: 'forbidden' });
    if (pathname === '/publish') {
      const prev = await storage.get('latest');
      if (prev && Date.now() - prev.at < MIN_PUBLISH_MS) return json(429, { error: 'too fast' });
      let data;
      try { data = JSON.parse(await req.text()); } catch { return json(400, { error: 'invalid json' }); }
      const latest = { v: (prev ? prev.v : 0) + 1, at: Date.now(), data };
      await storage.put('latest', latest);
      await storage.setAlarm(Date.now() + ROOM_TTL_MS);
      const text = JSON.stringify(latest);
      const sockets = this.ctx.getWebSockets();
      for (const ws of sockets) { try { ws.send(text); } catch { /* ya cerrado */ } }
      return json(200, { watchers: sockets.length });
    }
    if (pathname === '/delete') {
      await this.clear();
      return json(200, {});
    }
    return json(404, { error: 'not found' });
  }

  async alarm() { await this.clear(); }

  async clear() {
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, 'gone'); } catch { /* ya cerrado */ } }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // Quien mira no envía nada; un «ping» recibe su «pong» por si su red cierra las conexiones calladas.
  webSocketMessage(ws, message) { if (message === 'ping') ws.send('pong'); }
  webSocketClose(ws, code) { try { ws.close(code, 'bye'); } catch { /* ya cerrado */ } }
}
