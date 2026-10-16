// Radar de Millas · servidor intermedio para la API de Seats.aero (uso personal)
// Despliegue: Cloudflare Workers (Workers Builds desde GitHub). Secretos en Cloudflare:
//   SEATS_KEY  = clave de Seats.aero Pro
//   APP_TOKEN  = contraseña de la app; la web la envía en cada petición
// Almacén KV (binding ALERTS): alertas, configuración de avisos, últimas lecturas e historial.
// Tarea programada (cron en wrangler.toml): revisa las alertas y avisa por WhatsApp (CallMeBot) y email (Resend).
// Rutas:
//   GET  /search /trips/{id} /availability /routes  → proxy de Seats.aero (caché 10 min)
//   GET  /fx                                          → tipos de cambio a CHF (público)
//   GET  /alerts            POST /alerts             → listar / crear o editar
//   DELETE /alerts/{id}     POST /alerts/{id}/run    → borrar / revisar ahora
//   POST /notify/config     POST /notify/test        → canales de aviso / mensaje de prueba
//   GET  /cash              POST /cash/config        → precio real en efectivo de Google Flights (vía SerpApi)

const UPSTREAM = 'https://seats.aero/partnerapi';
const CACHE_SECONDS = 600; // 10 min: ahorra cuota (1.000 llamadas/día)
const APP_URL = 'https://radar-millas.juanmyf.workers.dev';
const MAX_ALERTS = 15;
const LOG_MAX = 40;
const CASH_TTL = 6 * 3600;   // 6 h: los precios en efectivo cambian poco y la cuota gratis es de 250/mes
const CASH_FREE = 250;
const FXFB = { CHF: 1, USD: 0.84, EUR: 0.93, GBP: 1.07, CAD: 0.6, AUD: 0.55, JPY: 0.0056, BRL: 0.15, SGD: 0.64, AED: 0.23, QAR: 0.23, SEK: 0.08, NOK: 0.08, DKK: 0.125, MXN: 0.046 };
const NAMES = { eurobonus: 'SAS EuroBonus', virginatlantic: 'Virgin Atlantic', aeromexico: 'Aeroméxico', american: 'American AAdvantage', delta: 'Delta SkyMiles', etihad: 'Etihad Guest', united: 'United MileagePlus', emirates: 'Emirates Skywards', aeroplan: 'Aeroplan', alaska: 'Alaska', velocity: 'Velocity', qantas: 'Qantas', connectmiles: 'ConnectMiles', azul: 'Azul', smiles: 'Smiles', flyingblue: 'Flying Blue', jetblue: 'JetBlue', qatar: 'Qatar Privilege Club', turkish: 'Turkish Miles&Smiles', singapore: 'KrisFlyer', ethiopian: 'ShebaMiles', saudia: 'AlFursan', finnair: 'Finnair Plus', lufthansa: 'Miles & More', lifemiles: 'LifeMiles', british: 'British Airways Club', iberia: 'Iberia Club', aerlingus: 'AerClub' };
// Días de antelación con que cada programa abre el canje (para el aviso de apertura)
const RELEASE = { iberia: 360, british: 355, qatar: 361, lufthansa: 360, flyingblue: 359 };
const CAB = { Y: 'Turista', W: 'Premium', J: 'Business', F: 'Primera' };

const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'X-App-Token, Content-Type',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',
});

const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });

const upstream = env => (env.SEATS_UPSTREAM || UPSTREAM);
const todayZ = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmt = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dShort = iso => { const m = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'].at(Number(iso.slice(5, 7)) - 1); return `${Number(iso.slice(8, 10))} ${m}`; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function getFX(ctx) {
  const cache = caches.default; const key = new Request('https://fx.radar/chf');
  const hit = await cache.match(key);
  if (hit) return (await hit.json()).toCHF;
  const srcs = ['https://open.er-api.com/v6/latest/CHF', 'https://api.frankfurter.dev/v1/latest?base=CHF', 'https://api.frankfurter.app/latest?from=CHF'];
  let rates = null;
  for (const s of srcs) { try { const r = await fetch(s); if (r.ok) { const j = await r.json(); rates = j.rates || null; if (rates) break; } } catch (e) {} }
  if (!rates) return null;
  const toCHF = { CHF: 1 }; for (const [c, v] of Object.entries(rates)) if (v) toCHF[c] = 1 / v;
  const res = new Response(JSON.stringify({ toCHF }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=43200' } });
  if (ctx) ctx.waitUntil(cache.put(key, res)); else await cache.put(key, res);
  return toCHF;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const url = new URL(request.url);
    if (url.pathname === '/' ) return json({ ok: true, service: 'radar-de-millas' }, 200, origin);

    // Tipos de cambio para pasar tasas a CHF (público, sin datos personales)
    if (url.pathname === '/fx') {
      const toCHF = await getFX(ctx);
      if (!toCHF) return json({ error: 'Sin tipos de cambio' }, 502, origin);
      return new Response(JSON.stringify({ toCHF }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600', ...cors(origin) } });
    }

    // Autenticación de la app
    const token = request.headers.get('X-App-Token') || '';
    if (!env.APP_TOKEN || token !== env.APP_TOKEN) return json({ error: 'Token de la app incorrecto' }, 401, origin);

    if (url.pathname.startsWith('/alerts') || url.pathname.startsWith('/notify')) {
      try { return await alertsApi(request, env, ctx, url, origin); }
      catch (e) { return json({ error: String(e && e.message || e) }, 500, origin); }
    }

    if (url.pathname === '/cash' || url.pathname === '/cash/config') {
      try { return await cashApi(request, env, url, origin); }
      catch (e) { return json({ error: String(e && e.message || e) }, 500, origin); }
    }

    if (request.method !== 'GET') return json({ error: 'Solo GET' }, 405, origin);
    if (!env.SEATS_KEY) return json({ error: 'Falta el secreto SEATS_KEY en el Worker' }, 500, origin);

    // Solo rutas permitidas
    let path;
    if (url.pathname === '/search') path = '/search';
    else if (url.pathname === '/availability') path = '/availability';
    else if (url.pathname === '/routes') path = '/routes';
    else if (/^\/trips\/[A-Za-z0-9]+$/.test(url.pathname)) path = url.pathname;
    else return json({ error: 'Ruta no permitida' }, 404, origin);

    const target = upstream(env) + path + url.search;

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

  // Tarea programada: revisa todas las alertas activas
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAllAlerts(env, ctx));
  },
};

/* ===================== Alertas ===================== */

async function kvGet(env, k, def) { const v = await env.ALERTS.get(k, 'json'); return v == null ? def : v; }
const kvPut = (env, k, v) => env.ALERTS.put(k, JSON.stringify(v));

function publicCfg(cfg) {
  return { waPhone: cfg.waPhone || '', waKey: !!cfg.waKey, email: cfg.email || '', resendKey: !!cfg.resendKey, serpKey: !!cfg.serpKey };
}

function cleanAlert(b, old) {
  const codes = v => (Array.isArray(v) ? v : String(v || '').split(/[\s,]+/)).map(s => String(s).toUpperCase().trim()).filter(s => /^[A-Z]{3}$/.test(s)).slice(0, 12);
  const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Math.max(0, Number(v)));
  const a = {
    id: old ? old.id : crypto.randomUUID().slice(0, 8),
    name: String(b.name || '').slice(0, 60),
    o: codes(b.o), d: codes(b.d),
    start: date(b.start), end: date(b.end),
    cab: ['Y', 'W', 'J', 'F'].includes(b.cab) ? b.cab : 'Y',
    progs: Array.isArray(b.progs) && b.progs.length ? b.progs.filter(p => /^[a-z]+$/.test(p)).slice(0, 40) : null,
    maxMiles: num(b.maxMiles), maxTax: num(b.maxTax),
    direct: !!b.direct, seats: Math.min(9, Math.max(1, Number(b.seats) || 1)),
    wa: !!b.wa, email: !!b.email, release: !!b.release,
    active: b.active !== false,
    created: old ? old.created : new Date().toISOString(),
    lastRun: old ? old.lastRun : null, lastCount: old ? old.lastCount : null, lastChange: old ? old.lastChange : null,
    best: old ? old.best : null, lastError: null,
  };
  if (!a.o.length || !a.d.length) throw new Error('Pon al menos un aeropuerto de origen y uno de destino (códigos de 3 letras).');
  if (!a.start || !a.end || a.end < a.start) throw new Error('Revisa las fechas: «desde» debe ir antes que «hasta».');
  if (addDays(a.start, 400) < a.end) throw new Error('El rango de fechas no puede pasar de un año.');
  if (!a.name) a.name = `${a.o.join('/')} → ${a.d.join('/')}`;
  return a;
}

async function alertsApi(request, env, ctx, url, origin) {
  if (!env.ALERTS) return json({ error: 'Falta el almacén de alertas (KV) en el servidor.' }, 500, origin);
  const parts = url.pathname.split('/').filter(Boolean); // ['alerts', id?, 'run'?]
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : null;
  let alerts = await kvGet(env, 'alerts', []);
  const cfg = await kvGet(env, 'cfg', {});

  if (parts[0] === 'alerts' && parts.length === 1 && request.method === 'GET') {
    return json({ alerts, cfg: publicCfg(cfg), log: await kvGet(env, 'log', []), max: MAX_ALERTS }, 200, origin);
  }
  if (parts[0] === 'alerts' && parts.length === 1 && request.method === 'POST') {
    const old = body.id ? alerts.find(a => a.id === body.id) : null;
    if (!old && alerts.length >= MAX_ALERTS) return json({ error: `Máximo ${MAX_ALERTS} alertas.` }, 400, origin);
    let a; try { a = cleanAlert(body, old); } catch (e) { return json({ error: e.message }, 400, origin); }
    if (old) {
      // si cambian los criterios, la próxima revisión parte de cero
      const crit = x => JSON.stringify([x.o, x.d, x.start, x.end, x.cab, x.progs, x.maxMiles, x.maxTax, x.direct, x.seats]);
      if (crit(old) !== crit(a)) { await env.ALERTS.delete('snap:' + a.id); a.lastCount = null; a.best = null; }
      alerts = alerts.map(x => (x.id === a.id ? a : x));
    } else alerts.push(a);
    await kvPut(env, 'alerts', alerts);
    return json({ alert: a }, 200, origin);
  }
  if (parts[0] === 'alerts' && parts.length === 2 && request.method === 'DELETE') {
    alerts = alerts.filter(a => a.id !== parts[1]);
    await kvPut(env, 'alerts', alerts); await env.ALERTS.delete('snap:' + parts[1]);
    return json({ ok: true }, 200, origin);
  }
  if (parts[0] === 'alerts' && parts.length === 3 && parts[2] === 'run' && request.method === 'POST') {
    const a = alerts.find(x => x.id === parts[1]);
    if (!a) return json({ error: 'No existe esa alerta.' }, 404, origin);
    const fx = (await getFX(ctx)) || FXFB;
    const r = await runAlert(env, a, fx, cfg, { manual: true });
    alerts = alerts.map(x => (x.id === a.id ? a : x)); await kvPut(env, 'alerts', alerts);
    return json({ alert: a, result: r }, 200, origin);
  }
  if (parts[0] === 'notify' && parts[1] === 'config' && request.method === 'POST') {
    const next = { ...cfg };
    if ('waPhone' in body) next.waPhone = String(body.waPhone || '').replace(/[^\d+]/g, '').slice(0, 20);
    if ('email' in body) next.email = String(body.email || '').trim().slice(0, 120);
    if (body.waKey) next.waKey = String(body.waKey).trim().slice(0, 80);
    if (body.resendKey) next.resendKey = String(body.resendKey).trim().slice(0, 200);
    if (body.clearWaKey) delete next.waKey;
    if (body.clearResendKey) delete next.resendKey;
    await kvPut(env, 'cfg', next);
    return json({ cfg: publicCfg(next) }, 200, origin);
  }
  if (parts[0] === 'notify' && parts[1] === 'test' && request.method === 'POST') {
    const text = '*Radar de Millas*\nMensaje de prueba: los avisos de tus alertas llegarán aquí.\n' + APP_URL;
    const res = await notify(env, cfg, { wa: true, email: true }, 'Radar de Millas · prueba de avisos', text, `<p>Mensaje de prueba: los avisos de tus alertas llegarán aquí.</p><p><a href="${APP_URL}">Abrir Radar de Millas</a></p>`);
    return json({ sent: res }, 200, origin);
  }
  return json({ error: 'Ruta no permitida' }, 404, origin);
}

async function seatsSearch(env, params) {
  const q = new URLSearchParams(params); let all = [], pages = 0, j;
  do {
    const r = await fetch(upstream(env) + '/search?' + q, { headers: { 'Partner-Authorization': env.SEATS_KEY, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('Seats.aero respondió ' + r.status);
    j = await r.json(); all = all.concat(j.data || []); pages++;
    if (j.hasMore && j.cursor) { q.set('cursor', j.cursor); q.set('skip', String(all.length)); }
  } while (j.hasMore && j.cursor && pages < 3);
  return all;
}

const taxCHF = (a, C, fx) => { const t = Number(a[C + 'TotalTaxes']); if (!t) return null; const r = fx[a.TaxesCurrency] || FXFB[a.TaxesCurrency]; return r ? Math.round(t / 100 * r) : null; };

async function runAlert(env, a, fx, cfg, opts = {}) {
  const today = todayZ();
  a.lastRun = new Date().toISOString(); a.lastError = null;
  if (a.end < today) { a.lastError = 'Las fechas ya pasaron.'; return { skipped: true }; }
  const C = a.cab;
  const params = { origin_airport: a.o.join(','), destination_airport: a.d.join(','), start_date: a.start < today ? today : a.start, end_date: a.end, take: '1000' };
  if (a.progs) params.sources = a.progs.join(',');
  let data;
  try { data = await seatsSearch(env, params); } catch (e) { a.lastError = e.message; return { error: e.message }; }
  const cur = {};
  for (const r of data) {
    if (!r[C + 'Available']) continue;
    if (a.progs && !a.progs.includes(r.Source)) continue;
    if (a.direct && !r[C + 'Direct']) continue;
    const m = Number(r[C + 'MileageCost']) || 0; if (!m) continue;
    if (a.maxMiles && m > a.maxMiles) continue;
    const t = taxCHF(r, C, fx);
    if (a.maxTax != null && t != null && t > a.maxTax) continue;
    const s = Number(r[C + 'RemainingSeats']) || 0;
    if (s && s < a.seats) continue;
    const k = `${r.Date}|${r.Route.OriginAirport}-${r.Route.DestinationAirport}|${r.Source}`;
    const v = { m, t, s, dir: !!r[C + 'Direct'], al: String(r[C + 'Airlines'] || '').slice(0, 24) };
    if (!cur[k] || v.m < cur[k].m) cur[k] = v;
  }
  const prev = await env.ALERTS.get('snap:' + a.id, 'json');
  const first = prev == null;
  const neu = [], drop = [], gone = [];
  if (!first) {
    for (const [k, v] of Object.entries(cur)) {
      const p = prev[k];
      if (!p) neu.push([k, v]);
      else if (v.m < p.m || (v.t != null && p.t != null && v.t < p.t - 5)) drop.push([k, v, p]);
    }
    for (const k of Object.keys(prev)) if (!cur[k]) gone.push(k);
  }
  const score = v => v.m * 0.012 + (v.t == null ? 150 : v.t);
  const bestE = Object.entries(cur).sort((x, y) => score(x[1]) - score(y[1]))[0];
  a.lastCount = Object.keys(cur).length;
  a.best = bestE ? { k: bestE[0], ...bestE[1] } : null;
  if (JSON.stringify(cur) !== JSON.stringify(prev || {})) await kvPut(env, 'snap:' + a.id, cur);
  const changed = neu.length || drop.length;
  if (changed) a.lastChange = new Date().toISOString();

  let sent = null;
  if (first || changed || opts.manual) {
    const msg = buildMessage(a, { first, neu, drop, gone, cur, bestE, manual: opts.manual && !first && !changed });
    if ((first || changed) && (a.wa || a.email)) {
      sent = await notify(env, cfg, { wa: a.wa, email: a.email }, msg.subject, msg.text, msg.html);
      await addLog(env, { t: new Date().toISOString(), id: a.id, name: a.name, text: msg.text.slice(0, 400), sent });
    }
    return { first, neu: neu.length, drop: drop.length, gone: gone.length, count: a.lastCount, sent, preview: msg.text };
  }
  return { first, neu: 0, drop: 0, gone: gone.length, count: a.lastCount };
}

function line(k, v, p) {
  const [date, route, src] = k.split('|');
  const was = p ? ` (antes ${fmt(p.m)}${p.t != null ? ' + CHF ' + p.t : ''})` : '';
  return `• ${dShort(date)} ${route} · ${NAMES[src] || src} ${fmt(v.m)}${v.t != null ? ' + CHF ' + v.t : ''}${v.s ? ' · ' + v.s + ' asientos' : ''}${v.dir ? ' · directo' : ''}${was}`;
}

function deepLink(a) {
  const q = new URLSearchParams({ o: a.o[0], d: a.d.length > 1 ? a.d.join(',') : a.d[0], d1: a.best ? a.best.k.slice(0, 10) : a.start, c: a.cab, go: '1' });
  return APP_URL + '/?' + q;
}

function buildMessage(a, x) {
  const head = `*Radar de Millas · ${a.name}* (${CAB[a.cab]}, ${dShort(a.start)}–${dShort(a.end)})`;
  const L = [head];
  if (x.first) L.push(`Alerta activada. ${(n=>n===1?'Ahora mismo hay 1 opción que cumple':`Ahora mismo hay ${n} opciones que cumplen`)(Object.keys(x.cur).length)} tus filtros.`);
  if (x.neu.length) { L.push(`\n*Nuevas plazas (${x.neu.length})*`); x.neu.sort((p, q) => p[1].m - q[1].m).slice(0, 6).forEach(([k, v]) => L.push(line(k, v))); }
  if (x.drop.length) { L.push(`\n*Bajadas de precio (${x.drop.length})*`); x.drop.slice(0, 6).forEach(([k, v, p]) => L.push(line(k, v, p))); }
  if (x.gone.length && !x.first) L.push(`\nYa no aparecen: ${x.gone.length}`);
  if (x.manual) L.push('Sin cambios desde la última revisión.');
  if (x.bestE) L.push(`\n*Mejor ahora:* ${line(x.bestE[0], x.bestE[1]).slice(2)}`);
  L.push(`\nConfírmalo en la web del programa antes de transferir puntos.\n${deepLink(a)}`);
  const text = L.join('\n');
  const html = '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#13263B">' +
    text.split('\n').map(l => l.trim() === '' ? '<br>' : `<div>${esc(l).replace(/\*(.+?)\*/g, '<b>$1</b>').replace(/(https:\/\/\S+)/g, '<a href="$1">Abrir en Radar de Millas</a>')}</div>`).join('') + '</div>';
  const subject = `${a.name}: ` + (x.first ? 'alerta activada' : x.neu.length ? (x.neu.length === 1 ? '1 plaza nueva' : `${x.neu.length} plazas nuevas`) + (x.drop.length ? ' y bajadas de precio' : '') : x.drop.length ? 'bajada de precio' : 'sin cambios');
  return { text, html, subject };
}

async function notify(env, cfg, ch, subject, text, html) {
  const out = {};
  if (ch.wa) {
    if (!cfg.waPhone || !cfg.waKey) out.wa = 'sin configurar';
    else {
      try {
        const u = (env.CALLMEBOT_URL || 'https://api.callmebot.com/whatsapp.php') + '?' + new URLSearchParams({ phone: cfg.waPhone, text: text.slice(0, 1500), apikey: cfg.waKey });
        const r = await fetch(u); out.wa = r.ok ? 'enviado' : 'error ' + r.status;
      } catch (e) { out.wa = 'error'; }
    }
  }
  if (ch.email) {
    if (!cfg.email || !cfg.resendKey) out.email = 'sin configurar';
    else {
      try {
        const r = await fetch(env.RESEND_URL || 'https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + cfg.resendKey, 'Content-Type': 'application/json', 'User-Agent': 'radar-de-millas/1.0' },
          body: JSON.stringify({ from: 'Radar de Millas <onboarding@resend.dev>', to: [cfg.email], subject, text, html }),
        });
        out.email = r.ok ? 'enviado' : 'error ' + r.status;
      } catch (e) { out.email = 'error'; }
    }
  }
  return out;
}

async function addLog(env, entry) {
  const log = await kvGet(env, 'log', []);
  log.unshift(entry); await kvPut(env, 'log', log.slice(0, LOG_MAX));
}

async function runAllAlerts(env, ctx) {
  if (!env.ALERTS || !env.SEATS_KEY) return;
  const alerts = await kvGet(env, 'alerts', []);
  if (!alerts.length) return;
  const cfg = await kvGet(env, 'cfg', {});
  const fx = (await getFX(ctx)) || FXFB;
  const today = todayZ();
  const opens = [];
  for (const a of alerts) {
    if (!a.active) continue;
    await runAlert(env, a, fx, cfg);
    // aviso del día en que se abre una fecha del rango
    if (a.release && (a.wa || a.email)) {
      for (const [prog, days] of Object.entries(RELEASE)) {
        if (a.progs && !a.progs.includes(prog)) continue;
        const target = addDays(today, days);
        if (target < a.start || target > a.end) continue;
        const mk = `rel:${a.id}:${prog}:${target}`;
        if (await env.ALERTS.get(mk)) continue;
        await env.ALERTS.put(mk, '1', { expirationTtl: 60 * 60 * 24 * 3 });
        opens.push({ a, prog, target, days });
      }
    }
  }
  await kvPut(env, 'alerts', alerts);
  if (opens.length) {
    const byAlert = {};
    for (const o of opens) (byAlert[o.a.id] = byAlert[o.a.id] || []).push(o);
    for (const list of Object.values(byAlert)) {
      const a = list[0].a;
      const text = `*Radar de Millas · ${a.name}*\nHoy se abre el canje para:\n` + list.map(o => `• ${dShort(o.target)} con ${NAMES[o.prog] || o.prog} (${o.days} días antes)`).join('\n') + `\nLas mejores plazas salen las primeras horas.\n${APP_URL}/?` + new URLSearchParams({ o: a.o[0], d: a.d[0], d1: list[0].target, c: a.cab, go: '1' });
      const html = '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">' + text.split('\n').map(l => `<div>${esc(l).replace(/\*(.+?)\*/g, '<b>$1</b>')}</div>`).join('') + '</div>';
      const sent = await notify(env, cfg, { wa: a.wa, email: a.email }, `${a.name}: hoy se abre el canje`, text, html);
      await addLog(env, { t: new Date().toISOString(), id: a.id, name: a.name, text: text.slice(0, 400), sent });
    }
  }
}

/* ===================== Precio en efectivo: Google Flights vía SerpApi ===================== */
// No hay API oficial de Google Flights. SerpApi la consulta por nosotros y devuelve JSON.
// Clave: secreto SERPAPI_KEY en Cloudflare o guardada desde la web (solo escritura).
const IATA = /^[A-Z]{3}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
async function cashApi(request, env, url, origin) {
  const cfg = await kvGet(env, 'cfg', {});
  const month = todayZ().slice(0, 7);
  if (url.pathname === '/cash/config') {
    if (request.method !== 'POST') return json({ error: 'Solo POST' }, 405, origin);
    const b = await request.json().catch(() => ({}));
    const next = { ...cfg };
    if (b.serpKey) next.serpKey = String(b.serpKey).trim().slice(0, 120);
    if (b.clearSerpKey) delete next.serpKey;
    await kvPut(env, 'cfg', next);
    return json({ cfg: publicCfg(next), used: await kvGet(env, 'cashcount:' + month, 0), free: CASH_FREE }, 200, origin);
  }
  if (request.method !== 'GET') return json({ error: 'Solo GET' }, 405, origin);
  const key = env.SERPAPI_KEY || cfg.serpKey;
  const used = await kvGet(env, 'cashcount:' + month, 0);
  if (!key) return json({ error: 'Falta la clave de SerpApi', need: 'serpKey', used, free: CASH_FREE }, 412, origin);
  const q = url.searchParams;
  const codes = s => String(s || '').toUpperCase().split(/[,\s]+/).filter(x => IATA.test(x)).slice(0, 7);
  const o = codes(q.get('o')), d = codes(q.get('d'));
  const d1 = q.get('d1') || '', d2 = q.get('d2') || '';
  const cab = { Y: '1', W: '2', J: '3', F: '4' }[q.get('c')] || '1';
  const pax = Math.min(9, Math.max(1, Number(q.get('pax')) || 1));
  if (!o.length || !d.length || !DAY.test(d1) || (d2 && !DAY.test(d2))) return json({ error: 'Faltan origen, destino o fecha' }, 400, origin);
  const ck = `cash:${o.join(',')}|${d.join(',')}|${d1}|${d2}|${cab}|${pax}`;
  if (q.get('fresh') !== '1') {
    const hit = await kvGet(env, ck, null);
    if (hit) return json({ ...hit, cached: true, used, free: CASH_FREE }, 200, origin);
  }
  const p = new URLSearchParams({ engine: 'google_flights', departure_id: o.join(','), arrival_id: d.join(','), outbound_date: d1,
    type: d2 ? '1' : '2', travel_class: cab, adults: String(pax), currency: 'CHF', gl: 'ch', hl: 'es', api_key: key });
  if (d2) p.set('return_date', d2);
  const r = await fetch((env.SERPAPI_URL || 'https://serpapi.com/search.json') + '?' + p, { headers: { Accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  await kvPut(env, 'cashcount:' + month, used + 1);
  if (!r.ok || j.error) {
    const msg = String(j.error || ('SerpApi ' + r.status));
    const nice = /Invalid API key/i.test(msg) ? 'La clave de SerpApi no es válida.' : /run out|limit/i.test(msg) ? 'Se acabaron las búsquedas de SerpApi de este mes.' : /hasn't returned any results/i.test(msg) ? null : msg;
    if (nice) return json({ error: nice, used: used + 1, free: CASH_FREE }, 502, origin);
  }
  const all = [...(j.best_flights || []).map(x => ({ ...x, _best: true })), ...(j.other_flights || [])].filter(x => x.price);
  const flights = all.map(x => {
    const legs = x.flights || [];
    const f0 = legs[0] || {}, fN = legs[legs.length - 1] || {};
    return {
      price: x.price, best: !!x._best, stops: Math.max(0, legs.length - 1), dur: x.total_duration || null,
      airlines: [...new Set(legs.map(l => l.airline).filter(Boolean))], logo: x.airline_logo || f0.airline_logo || '',
      nums: legs.map(l => l.flight_number).filter(Boolean),
      dep: { ap: f0.departure_airport && f0.departure_airport.id, t: f0.departure_airport && f0.departure_airport.time },
      arr: { ap: fN.arrival_airport && fN.arrival_airport.id, t: fN.arrival_airport && fN.arrival_airport.time },
      via: (x.layovers || []).map(l => l.id).filter(Boolean),
    };
  }).sort((a, b) => a.price - b.price).slice(0, 10);
  const pi = j.price_insights || {};
  const out = {
    at: new Date().toISOString(), q: { o, d, d1, d2, cab, pax }, rt: !!d2,
    lowest: flights.length ? flights[0].price : (pi.lowest_price || null),
    level: pi.price_level || null, typical: pi.typical_price_range || null,
    url: (j.search_metadata && j.search_metadata.google_flights_url) || null,
    flights,
  };
  await env.ALERTS.put(ck, JSON.stringify(out), { expirationTtl: CASH_TTL });
  return json({ ...out, cached: false, used: used + 1, free: CASH_FREE }, 200, origin);
}
