# Korrekturen vom User (während Build läuft)

## sitemap.xml Filter
- **quentara IST ein echter User** — NICHT rausfiltern. In sitemap behalten.
- Alle anderen Filter-Regeln (e2e/test/user_<hex>/bomb/grace) bleiben.
- swschilke: prüf nochmal manuell, ggf. auch echt. Im Zweifel drinlassen.

## Allgemein
- Im Zweifel: User drinlassen. False-Negativ (Test-User in sitemap) ist weniger schlimm als False-Positiv (echten User rausnehmen).
