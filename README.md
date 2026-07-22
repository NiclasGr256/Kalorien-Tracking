# Kalorien Tracker

Mobile Web-App zum Tracken deiner täglichen Kalorien — optimiert für iPhone, gehostet auf GitHub Pages.

## Features

- Mahlzeiten eintragen (Frühstück, Mittag, Abend, Snack)
- Tagesübersicht mit Gesamtkalorien und Eintragsanzahl
- Übersichtsseite mit Tabelle der letzten Tage
- Burger-Menü zur Navigation
- Vorherige Tage ansehen und Daten sammeln
- Daten werden lokal im Browser gespeichert (localStorage)
- Als App auf dem Home-Screen installierbar

## GitHub Pages aktivieren

1. Repository auf GitHub pushen
2. **Settings → Pages**
3. **Source:** Deploy from a branch
4. **Branch:** `main` / `/ (root)`
5. Speichern — nach 1–2 Minuten erreichbar unter:

   `https://niclasgr256.github.io/Kalorien-Tracking/`

## Auf dem iPhone installieren

1. Seite in Safari öffnen
2. Teilen-Button → **Zum Home-Bildschirm**
3. Die App startet dann im Vollbildmodus

## Lokal testen

```bash
# Mit Python
python -m http.server 8080

# Oder mit npx
npx serve .
```

Dann im Browser: `http://localhost:8080`

## Technik

- Reines HTML, CSS, JavaScript (kein Build-Schritt nötig)
- localStorage für Persistenz
- Kein Backend, keine Anmeldung
