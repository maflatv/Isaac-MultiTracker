// Pruebas de compartir y ver partidas: el cliente (lib/remote.js) contra el servicio real (relay/worker.js), con el
// almacenamiento de Cloudflare simulado en memoria. Sin WebSocket: el cliente pide la partida por HTTP.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { Remote, normalizeCode, isCode } = require('../lib/remote.js');

const RELAY = 'https://relay.test';

// Un Durable Object por código, con su almacenamiento en memoria.
async function fakeRelay() {
  const { default: worker, Room } = await import(pathToFileURL(path.join(__dirname, '..', 'relay', 'worker.js')).href);
  const rooms = new Map();
  const roomFor = name => {
    if (!rooms.has(name)) {
      const data = new Map();
      const storage = {
        get: async k => data.get(k), put: async (k, v) => { data.set(k, structuredClone(v)); },
        setAlarm: async () => {}, deleteAlarm: async () => {}, deleteAll: async () => { data.clear(); },
      };
      rooms.set(name, new Room({ storage, getWebSockets: () => [], acceptWebSocket: () => {} }));
    }
    return rooms.get(name);
  };
  const env = { ROOMS: { idFromName: n => n, get: id => ({ fetch: (url, init) => roomFor(id).fetch(url instanceof Request ? url : new Request(url, init)) }) } };
  return (url, init) => worker.fetch(new Request(url, init), env);
}

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await tick(); }
  assert.fail('no llegó a tiempo');
}

test('los códigos se escriben sin espacios ni guiones y sin 0, O, 1 ni I', () => {
  assert.strictEqual(normalizeCode(' k7m-4qx2 '), 'K7M4QX2');
  assert.ok(isCode('K7M4QX2'));
  assert.ok(!isCode('K7M4QX0'));
  assert.ok(!isCode('K7M4QX'));
});

test('quien comparte sube su partida y quien mira la recibe', async t => {
  const fetchImpl = await fakeRelay();
  const sharer = new Remote({ relayUrl: RELAY, fetchImpl, WebSocketImpl: null });
  const viewer = new Remote({ relayUrl: RELAY, fetchImpl, WebSocketImpl: null });
  t.after(() => { sharer.close(); viewer.close(); });
  const share = await sharer.createShare();
  assert.ok(isCode(share.code));
  assert.strictEqual(viewer.view(share.code).status, 'connecting');
  await until(() => viewer.view(share.code).status === 'waiting');
  sharer.offer(share, { run: { seed: 'ABCD EFGH', items: [{ id: 1 }] } }, 'a');
  await until(() => sharer.shareStatus().status === 'ok');
  // Sin WebSocket se pregunta cada 3 s.
  await until(() => viewer.view(share.code).data, 5000);
  assert.deepStrictEqual(viewer.view(share.code).data.run.items, [{ id: 1 }]);
});

test('con retraso, la partida aparece cuando han pasado esos segundos', async t => {
  const fetchImpl = await fakeRelay();
  let clock = Date.now();
  const sharer = new Remote({ relayUrl: RELAY, fetchImpl, WebSocketImpl: null });
  const viewer = new Remote({ relayUrl: RELAY, fetchImpl, WebSocketImpl: null, now: () => clock });
  t.after(() => { sharer.close(); viewer.close(); });
  const share = await sharer.createShare();
  sharer.offer(share, { run: { seed: 'S1' } }, 'a');
  await until(() => sharer.shareStatus().status === 'ok');
  viewer.view(share.code, 15);
  await until(() => viewer.view(share.code, 15).status === 'delayed');
  assert.strictEqual(viewer.view(share.code, 15).data, null);
  clock += 16000;
  assert.strictEqual(viewer.view(share.code, 15).data.run.seed, 'S1');
});

test('un código que no existe se avisa y sin la clave no se puede subir', async t => {
  const fetchImpl = await fakeRelay();
  const remote = new Remote({ relayUrl: RELAY, fetchImpl, WebSocketImpl: null });
  t.after(() => remote.close());
  remote.view('ZZZZZZZ');
  await until(() => remote.view('ZZZZZZZ').status === 'notFound');
  const share = await remote.createShare();
  remote.offer({ code: share.code, key: 'f'.repeat(48) }, { run: null }, 'a');
  await until(() => remote.shareStatus().status === 'error');
  assert.strictEqual(remote.shareStatus().error, 'lost');
});

test('sin cambios no se vuelve a subir y, tras borrar el código, ya no existe', async t => {
  const calls = [];
  const relay = await fakeRelay();
  const fetchImpl = (url, init) => { calls.push(init && init.method); return relay(url, init); };
  const remote = new Remote({ relayUrl: RELAY, fetchImpl, WebSocketImpl: null });
  t.after(() => remote.close());
  const share = await remote.createShare();
  remote.offer(share, { run: { seed: 'S' } }, 'a');
  await until(() => remote.shareStatus().status === 'ok');
  remote.offer(share, { run: { seed: 'S' } }, 'a');
  await tick(50);
  assert.strictEqual(calls.filter(m => m === 'PUT').length, 1);
  await remote.deleteShare(share);
  remote.view(share.code);
  await until(() => remote.view(share.code).status === 'notFound');
});

test('sin dirección del servicio, no está disponible', () => {
  const remote = new Remote({ relayUrl: '' });
  assert.strictEqual(remote.available, false);
  assert.strictEqual(remote.view('K7M4QX2').status, 'unavailable');
  remote.close();
});
