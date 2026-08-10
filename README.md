# Kalorien Tracker PWA

Ein leistungsstarker, minimalistischer Kalorien- und Makronährstoff-Tracker, optimiert für die mobile Nutzung. Die App ermöglicht das Protokollieren von Mahlzeiten, das Setzen von Zielen und bietet eine KI-Integration zur automatischen Analyse von Mahlzeiten (auch per Foto).

## 🚀 Features

*   **Tägliches Tracking:** Erfasse Kalorien, Protein, Kohlenhydrate, Fett und Ballaststoffe.
*   **Mahlzeiten-Management:** Unterteilung in verschiedene Tageszeiten (Frühstück, Mittagessen, etc.).
*   **KI-Assistent:** Integrierter Chatbot (OpenAI), der Einträge erstellt, Daten analysiert oder Mahlzeiten anhand von Fotos erkennt.
*   **Eigene Gerichte:** Speichere häufig verzehrte Lebensmittel als Vorlagen.
*   **Detaillierte Statistiken:** Visualisierung deiner Fortschritte über 7, 14 oder 30 Tage mittels Diagrammen.
*   **Individuelle Ziele:** Setze tägliche Makronährstoff-Ziele und passe die farbliche Kennzeichnung (Schwellenwerte) deiner Fortschrittsbalken an.
*   **Historie:** Komplette Übersicht über vergangene Tage.
*   **PWA-Support:** Kann als App auf dem Homescreen installiert werden und funktioniert auch offline (Caching).

## 🛠 Tech-Stack

*   **Frontend:** Vanilla JavaScript (ES Modules), HTML5, CSS3.
*   **Datenbank:** [Supabase](https://supabase.com/) (PostgreSQL) für Echtzeit-Synchronisation.
*   **Diagramme:** Chart.js.
*   **KI:** OpenAI API Integration.
*   **Icons/UI:** Custom CSS mit Fokus auf mobile User Experience.

## 📋 Installation & Einrichtung

### 1. Datenbank (Supabase) vorbereiten
Die App benötigt ein Supabase-Projekt.
1. Erstelle ein neues Projekt auf [Supabase](https://app.supabase.com/).
2. Führe das SQL-Skript aus der Datei `supabase-schema.sql` im SQL-Editor deines Supabase-Dashboards aus. Dies erstellt die Tabellen `entries`, `custom_foods` und `settings`.
3. Aktiviere (falls noch nicht geschehen) die "Anon" Keys für den Zugriff.

### 2. Konfiguration
Trage deine Supabase-Zugangsdaten in der `index.html` ein:
```javascript
window.SUPABASE_CONFIG = {
  url: 'DEINE_SUPABASE_URL',
  anonKey: 'DEIN_ANON_KEY'
};
```

### 3. KI-Chat aktivieren (optional)
Um den KI-Assistenten zu nutzen:
1. Öffne die App.
2. Navigiere zum **KI Chat**.
3. Hinterlege deinen OpenAI API-Key in den Einstellungen oder direkt im Chat-Interface (der Key wird in der `settings`-Tabelle deiner Datenbank gespeichert).

## 📖 Nutzungshinweise

### Mahlzeit hinzufügen
*   Klicke auf das **"+" Symbol (FAB)** unten rechts.
*   Wähle die Mahlzeit aus und gib den Namen sowie die Nährwerte ein.
*   **Pro-Tipp:** Nutze die Suchfunktion, um bereits gespeicherte Gerichte schnell zu finden.

### KI-Assistent nutzen
*   Du kannst dem Bot schreiben: *"Ich habe gerade einen Apfel und 200g Magerquark gegessen."*
*   Du kannst ein **Foto deiner Mahlzeit** hochladen, und die KI schätzt die Nährwerte automatisch für dich.

### Ziele definieren
*   Im Menü unter **"Ziele"** kannst du deine täglichen Zielwerte für kcal und Makros festlegen.
*   Hier lassen sich auch die Farben der Fortschrittsbalken anpassen (z. B. Grün, wenn das Ziel zu 90-105% erreicht ist).

### Statistiken
*   Der Bereich **"Statistiken"** zeigt dir den Durchschnitt deiner Kalorien- und Proteinaufnahme und hilft dir, Trends zu erkennen.

## 📱 Mobile Nutzung (PWA)
Um die App wie eine native App zu nutzen:
*   **iOS (Safari):** Teilen-Button -> "Zum Home-Bildschirm hinzufügen".
*   **Android (Chrome):** Menü-Button -> "App installieren".

---
*Entwickelt für eine effiziente und schnelle Dokumentation der täglichen Ernährung.*

