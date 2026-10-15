# Radar de Millas

Buscador personal de asientos de premio (datos de Seats.aero) con tasas en CHF, calendario,
comparación de aeropuertos de salida y guía de programas, socios y tarjetas por país.

- `src.html` — la app (HTML, CSS y JS en un archivo; diseño en `DESIGN.md`)
- `loader.html` — carga la lista de aeropuertos en el navegador
- `worker.js` — servidor intermedio: guarda la clave de Seats.aero, caché de 10 min, tipos de cambio en `/fx`
- `data/` — programas de puntos, tarjetas y transferencias por país; socios por aerolínea
- `build.py` — genera `dist/worker.js` (servidor + app en un solo archivo)

## Publicar

```
python3 build.py      # regenera dist/worker.js
git commit -am "..." && git push
```
Cloudflare (Workers Builds, conectado a este repo) despliega `dist/worker.js` con `npx wrangler deploy`
en cada push a `main`. Los secretos `SEATS_KEY` y `APP_TOKEN` viven en Cloudflare, nunca en el repo.
