/**
 * HopLite Map Relay — posiciones compartidas entre jugadores
 * Uso:  node server.js
 * Puerto: PORT (por defecto 8787)
 *
 * API:
 *   GET  /                      -> info
 *   GET  /health                -> { ok: true }
 *   GET  /room/:room            -> { players: [...] }
 *   PUT  /room/:room/player     -> body JSON { id, name, x, y, z, yaw, world, color }
 *   DELETE /room/:room/player/:id
 */
const http = require('http');
const PORT = Number(process.env.PORT) || 8787;
const TTL_MS = 15000;

/** @type {Map<string, Map<string, object>>} */
const rooms = new Map();

function cleanRoom(room) {
  const now = Date.now();
  const m = rooms.get(room);
  if (!m) return;
  for (const [id, p] of m) {
    if (now - p.ts > TTL_MS) m.delete(id);
  }
  if (m.size === 0) rooms.delete(room);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 8192) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  cors(res);
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function normPath(p) {
  // quita query, colapsa //, quita barra final (excepto raíz)
  let s = (p || '/').split('?')[0];
  s = s.replace(/\/+/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = normPath(req.url || '/');

  if (req.method === 'GET' && (path === '/' || path === '/health')) {
    return send(res, 200, {
      ok: true,
      service: 'HopLite Map Relay',
      rooms: rooms.size,
      usage: {
        list: 'GET /room/TU_SALA',
        publish: 'PUT /room/TU_SALA/player',
        leave: 'DELETE /room/TU_SALA/player/ID'
      },
      example: 'Abre en el mapa: URL del relay = esta dirección (sin /room/...)'
    });
  }

  // GET /room/:room
  let m = path.match(/^\/room\/([a-z0-9_-]{1,32})$/i);
  if (req.method === 'GET' && m) {
    const room = m[1].toLowerCase();
    cleanRoom(room);
    const map = rooms.get(room) || new Map();
    const players = [...map.values()].map(p => ({
      id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, yaw: p.yaw, world: p.world, color: p.color, ts: p.ts
    }));
    return send(res, 200, { room, players });
  }

  // PUT /room/:room/player
  m = path.match(/^\/room\/([a-z0-9_-]{1,32})\/player$/i);
  if (req.method === 'PUT' && m) {
    const room = m[1].toLowerCase();
    let body;
    try { body = await readBody(req); } catch (e) { return send(res, 400, { error: 'invalid json' }); }
    const id = String(body.id || '').slice(0, 64);
    if (!id) return send(res, 400, { error: 'id required' });
    const name = String(body.name || 'Jugador').slice(0, 24);
    const x = Number(body.x), z = Number(body.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return send(res, 400, { error: 'x,z required' });
    const y = Number.isFinite(Number(body.y)) ? Number(body.y) : null;
    const yaw = Number.isFinite(Number(body.yaw)) ? Number(body.yaw) : null;
    const world = String(body.world || 'minecraft:overworld').slice(0, 64);
    const color = String(body.color || '').slice(0, 20) || null;
    if (!rooms.has(room)) rooms.set(room, new Map());
    const map = rooms.get(room);
    if (map.size >= 64 && !map.has(id)) return send(res, 429, { error: 'room full' });
    map.set(id, { id, name, x, y, z, yaw, world, color, ts: Date.now() });
    cleanRoom(room);
    return send(res, 200, { ok: true });
  }

  // DELETE /room/:room/player/:id
  m = path.match(/^\/room\/([a-z0-9_-]{1,32})\/player\/([^/]+)$/i);
  if (req.method === 'DELETE' && m) {
    const room = m[1].toLowerCase();
    const id = decodeURIComponent(m[2]);
    const map = rooms.get(room);
    if (map) map.delete(id);
    cleanRoom(room);
    return send(res, 200, { ok: true });
  }

  send(res, 404, {
    error: 'not found',
    path,
    method: req.method,
    hint: 'GET /room/:room | PUT /room/:room/player | DELETE /room/:room/player/:id',
    tip: 'En el mapa, la URL del relay debe ser solo la base (ej. https://xxx.onrender.com), SIN /room/...'
  });
});

setInterval(() => {
  for (const room of [...rooms.keys()]) cleanRoom(room);
}, 5000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HopLite Map Relay on http://0.0.0.0:${PORT}`);
});
