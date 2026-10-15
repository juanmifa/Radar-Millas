import json, glob, html, os
D = os.path.dirname(os.path.abspath(__file__))
def rd(p): return open(os.path.join(D, p), encoding='utf-8').read()
def wr(p, s): open(os.path.join(D, p), 'w', encoding='utf-8').write(s)
def js(obj): return json.dumps(obj, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

earn = {}
for f in sorted(glob.glob(os.path.join(D, 'data', '*.json'))):
    if f.endswith('AIRLINE_PARTNERS.json'): continue
    d = json.load(open(f, encoding='utf-8'))
    earn[d['country']] = d
partners = json.load(open(os.path.join(D, 'data', 'AIRLINE_PARTNERS.json'), encoding='utf-8'))

src = rd('src.html').replace('__EARN__', js(earn)).replace('__PARTNERS__', js(partners))

# (a) artifact: aeropuertos incrustados
wr('radar-de-millas.html', src.replace('__AIRPORTS__', rd('airports.json')))

# (b) web en el Worker: misma origen, aeropuertos cargados en el navegador
head, rest = src.split('<script>', 1)
main, tail = rest.split('</script>', 1)
R = [
 ("const AIRPORTS = __AIRPORTS__;", "const AIRPORTS = window.__AIRPORTS;"),
 ("function wk(){return {url:(store.get('wkUrl','')||'').replace(/\\/+$/,''),tok:store.get('wkTok','')}}", "function wk(){return {url:(/^radar-millas\\./.test(location.hostname)||location.protocol==='file:')?'':'https://radar-millas.juanmyf.workers.dev',tok:store.get('wkTok','')}}"),
 ("const {url,tok}=wk(); if(!url||!tok) throw", "const {url,tok}=wk(); if(!tok) throw"),
 ("document.getElementById('f').addEventListener('submit',()=>{const {url,tok}=wk();if(url&&tok)runAll();else renderSummary()});", "document.getElementById('f').addEventListener('submit',()=>{if(wk().tok)runAll();else renderSummary()});"),
 ("const r=await fetch(url+'/'); const j=await r.json(); if(!j.ok)", "const r=await fetch('/health'); const j=await r.json(); if(!j.ok)"),
 ("(function(){const {url,tok}=wk(); if(!url||!tok){", "(function(){const {tok}=wk(); if(!tok){"),
 ("store.set('wkUrl',document.getElementById('wkUrl').value.trim()); ", ""),
 ("document.getElementById('wkUrl').value=wk().url; ", ""),
 ("Conecta tu Worker de Cloudflare para ver vuelos reales", "Escribe tu token de la app (APP_TOKEN) en «Conexión» para ver vuelos reales"),
]
for a, b in R:
    assert a in main, a[:60]
    main = main.replace(a, b)
head = head.replace('<div class="field"><label class="label" for="wkUrl">Dirección del Worker</label><input id="wkUrl" placeholder="https://radar-millas.tuusuario.workers.dev" spellcheck="false"></div>', '')
head = head.replace("Tu clave de Seats.aero vive en el Worker, no aquí.", "Tu clave de Seats.aero vive en el servidor, no aquí.")
loader = rd('loader.html')
page = head + loader + '<script type="text/plain" id="main-src">' + main.replace('</script', '<\\/script') + '</script>' + tail
wr('app-worker.html', page)
handler = rd('worker.js')
handler = handler[handler.index('const UPSTREAM'):]
handler = handler.replace("if (url.pathname === '/' ) return json({ ok: true, service: 'radar-de-millas' }, 200, origin);",
 "if (url.pathname === '/' || url.pathname === '/index.html') return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });\n    if (url.pathname === '/health') return json({ ok: true, service: 'radar-de-millas' }, 200, origin);")
doc = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Radar de Millas</title><style>[hidden]{display:none!important}body{margin:0}img{max-width:100%}</style></head><body>' + page + '</body></html>'
full = "// Radar de Millas · web + servidor intermedio para Seats.aero (uso personal)\n// Secretos: SEATS_KEY (clave Seats.aero Pro) y APP_TOKEN (contraseña de la app)\n" + handler + "\nconst HTML = " + json.dumps(doc, ensure_ascii=False) + ";\n"
wr('worker-full.js', full)
os.makedirs(os.path.join(D,'dist'),exist_ok=True); wr('dist/worker.js', full)
if not os.path.exists(os.path.join(D,'codigo-servidor.html')):
    print('worker', len(full.encode())); raise SystemExit
c = rd('codigo-servidor.html')
a = c.index('readonly spellcheck="false">') + len('readonly spellcheck="false">'); b = c.index('</textarea>')
wr('codigo-servidor.html', c[:a] + html.escape(full) + c[b:])
print('artifact', len(rd('radar-de-millas.html')), 'worker', len(full.encode()))
