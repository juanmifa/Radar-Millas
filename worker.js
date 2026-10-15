// Radar de Millas · servidor intermedio para la API de Seats.aero (uso personal)
// Despliegue: Cloudflare Workers. Secretos necesarios (Settings → Variables and Secrets):
//   SEATS_KEY  = tu clave de Seats.aero Pro (pestaña API en seats.aero/settings)
//   APP_TOKEN  = una contraseña larga que inventes tú; la app la envía en cada petición
// Rutas que acepta:
//   GET /search?...        → Cached Search   (https://seats.aero/partnerapi/search)
//   GET /trips/{id}        → Get Trips       (https://seats.aero/partnerapi/trips/{id})
//   GET /availability?...  → Bulk Availability (https://seats.aero/partnerapi/availability)
//   GET /routes?source=..  → Get Routes      (https://seats.aero/partnerapi/routes)

const UPSTREAM = 'https://seats.aero/partnerapi';
const CACHE_SECONDS = 600; // 10 min: ahorra cuota (1.000 llamadas/día)

const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'X-App-Token, Content-Type',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',
});

const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'GET') return json({ error: 'Solo GET' }, 405, origin);

    const url = new URL(request.url);
    if (url.pathname === '/' ) return json({ ok: true, service: 'radar-de-millas' }, 200, origin);

    // Tipos de cambio para pasar tasas a CHF (público, sin datos personales)
    if (url.pathname === '/fx') {
      const cache = caches.default; const key = new Request('https://fx.radar/chf');
      let hit = await cache.match(key);
      if (!hit) {
        const srcs = ['https://open.er-api.com/v6/latest/CHF', 'https://api.frankfurter.dev/v1/latest?base=CHF', 'https://api.frankfurter.app/latest?from=CHF'];
        let rates = null;
        for (const s of srcs) { try { const r = await fetch(s); if (r.ok) { const j = await r.json(); rates = j.rates || null; if (rates) break; } } catch (e) {} }
        if (!rates) return json({ error: 'Sin tipos de cambio' }, 502, origin);
        const toCHF = { CHF: 1 }; for (const [c, v] of Object.entries(rates)) if (v) toCHF[c] = 1 / v;
        hit = new Response(JSON.stringify({ toCHF }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=43200' } });
        ctx.waitUntil(cache.put(key, hit.clone()));
      }
      const o = new Response(hit.body, hit); Object.entries(cors(origin)).forEach(([k, v]) => o.headers.set(k, v)); return o;
    }

    // Autenticación de la app
    const token = request.headers.get('X-App-Token') || '';
    if (!env.APP_TOKEN || token !== env.APP_TOKEN) return json({ error: 'Token de la app incorrecto' }, 401, origin);
    if (!env.SEATS_KEY) return json({ error: 'Falta el secreto SEATS_KEY en el Worker' }, 500, origin);

    // Solo rutas permitidas
    let path;
    if (url.pathname === '/search') path = '/search';
    else if (url.pathname === '/availability') path = '/availability';
    else if (url.pathname === '/routes') path = '/routes';
    else if (/^\/trips\/[A-Za-z0-9]+$/.test(url.pathname)) path = url.pathname;
    else return json({ error: 'Ruta no permitida' }, 404, origin);

    const target = UPSTREAM + path + url.search;

    // Caché de Cloudflare por URL (la clave nunca forma parte de la URL)
    const cache = caches.default;
    const cacheKey = new Request(target, { method: 'GET' });
    let res = await cache.match(cacheKey);
    let hit = true;
    if (!res) {
      hit = false;
      const up = await fetch(target, { headers: { 'Partner-Authorization': env.SEATS_KEY, 'Accept': 'application/json' } });
      const body = await up.text();
      res = new Response(body, { status: up.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` } });
      if (up.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    const out = new Response(res.body, res);
    Object.entries(cors(origin)).forEach(([k, v]) => out.headers.set(k, v));
    out.headers.set('X-Radar-Cache', hit ? 'HIT' : 'MISS');
    return out;
  },
};
