Formato de salida (JSON válido, UTF-8), un archivo por país:
{
  "country": "CH", "country_name": "Suiza", "checked": "2026-10",
  "programs": [
    { "id": "coop-supercard", "name": "Coop Supercard", "type": "retail|coalition|bank|fintech|airline|hotel|travel|other",
      "how_to_earn": ["Compras en Coop: 1 superpunto por CHF", "..."],
      "transfers": [ { "to": "Miles & More", "to_type": "airline", "ratio": "500 superpuntos = 200 millas", "notes": "mínimo, tasa, tiempo", "source": "https://..." } ],
      "notes": "detalles útiles / sweet spots / limitaciones",
      "sources": ["https://...", "..."], "confidence": "alta|media|baja" } ],
  "cards": [
    { "id": "amex-gold-ch", "name": "American Express Gold Card", "issuer": "Swisscard / American Express", "annual_fee": "CHF 350",
      "earns": "Membership Rewards", "earn_rate": "1 punto por CHF", "welcome_bonus": "si hay, con fecha",
      "transfers": [ { "to": "British Airways Club (Avios)", "ratio": "3:2", "source": "https://..." } ],
      "notes": "", "sources": ["https://..."], "confidence": "alta|media|baja" } ]
}
Reglas: solo datos verificados en fuentes de 2025-2026 (web oficial del programa/banco o blogs serios de millas: reisetopia, Milesopedia, Head for Points, Melhores Destinos, Passageiro de Primeira, Frequent Miler, etc.). Si algo no se puede confirmar, pon "confidence":"baja" y explica en notes; nunca inventes ratios. Cita la URL concreta de donde sale cada ratio.
