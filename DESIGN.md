# Radar de Millas · plan de diseño «carta aeronáutica»

Tema: buscador personal de asientos de premio (millas + tasas) para un usuario en Zúrich.
Trabajo principal: decir en segundos «cuál es la opción más barata y desde dónde».

## Color (papel de carta, tinta, ruta)
- papel     #E8EEF1  fondo, como el papel azulado de una carta OACI
- superficie #F8FAFB
- tinta     #13263B  texto y botón principal (no magenta)
- ruta      #B0167C  magenta de carta: SOLO la ruta, el ganador y el día elegido
- vfr       #2A5F8F  enlaces y elementos secundarios
- tierra    #AFC0CC  puntos del mapa base (cada aeropuerto del mundo es un punto)
- ahorro    #1D7650 · aviso #9A6200 · error #B3261E
Modo oscuro = carta nocturna (#0D1720 / #14212C / #E2EAF0, magenta #E26BB5).

## Tipografía
Una familia: Archivo (variable, eje de anchura 62–125).
- Códigos IATA y titulares: Archivo condensado (wdth 62–75), 700. El ancho es el recurso expresivo.
- Texto y datos: Archivo normal, cifras tabulares. Sin monoespaciada, sin MAYÚSCULAS en etiquetas.
Escala: 13 / 15 / 18 / 24 / 40 / 72.

## Layout
```
┌ ◎ Radar de Millas   Buscar · Socios · Ganar puntos        Ajustes ┐
├──────────────────────────── carta ────────────────────────────────┤
│ ZRH ━━━━━━━━━━━━━━ (círculo máximo magenta) ━━━━━━━━━━━━━━▶ TYO    │
│   ·GVA 498  ★HEL 420   ·MAD 458      (mapa de puntos + retícula)   │
│ [Origen ⇄ Destino | Ida | Vuelta | Cabina | Pax |  Buscar ]        │
├─────────────────────────── respuesta ─────────────────────────────┤
│ ▌Mejor desde ZRH   │ LifeMiles │ 45.000 │ CHF 11 │ ≈ CHF 551 │ Ver │  ← fichas de progreso de vuelo
│ ▌Desde otro aerop. │ Finnair   │ 30.000 │ CHF 60 │ ≈ CHF 420 │ Ver │
├───────────────────────────────────────────────────────────────────┤
│ Opciones · Calendario · Otros aeropuertos · Efectivo · Tablas      │
│ (vista activa)                                                     │
└───────────────────────────────────────────────────────────────────┘
Ajustes = panel lateral: conexión, programas y orden, monedero.
```
Alineación a la izquierda; datos numéricos alineados a la derecha.

## Principios
1. Lo memorable es la carta: el mapa base hecho con los 3.244 aeropuertos, la retícula y la ruta magenta. Todo lo demás, sobrio.
2. Magenta = ruta / ganador. Nunca decoración ni muros de botones.
3. Resultados como fichas de progreso de vuelo de control aéreo (compartimentos con filetes verticales), no tarjetas con sombra.
4. Una búsqueda, una respuesta arriba; el detalle en vistas.

## Revisión contra lo genérico
- Descartado: paleta «reservas» azul + naranja que propone ui-ux-pro-max (genérica de cualquier agencia).
- Descartado: modo oscuro con un acento chillón (tópico).
- Cambiado: Barlow Condensed + IBM Plex Mono → una sola familia variable (Archivo), sin mono en etiquetas.
- Cambiado: etiquetas en mayúsculas espaciadas → frase normal.
- Cambiado: 9 paneles blancos iguales → un mapa protagonista + fichas + vistas.
