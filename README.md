# SimTag Dienstplan

Dienstplan, Lagekarte und Check-in für den SimTag der Notfallsanitäter-Ausbildung (StIWL), erstmals für den **SimTag 2027 am 26.06.2027 auf dem LAFP in Schloß Holte-Stukenbrock**.

> **Dieses Repository ist öffentlich.** Es enthält nur Code und erfundene Beispieldaten. Echte Namen, Codes und Kennzeichen liegen ausschließlich in `daten/state.json` auf dem Server und gehören nie ins Repository.

## Was die App kann

| Ansicht | Für wen | Inhalt |
|---|---|---|
| **Mein Plan** | alle Teilnehmenden | Persönlicher Ablauf über einen 6-stelligen Code. 3. LJ: Fahrzeug, Funkrufname, Kennzeichen, Rolle, Alarmzeit, Team. 2. LJ: Station, Schminken, Treffen. 1. LJ: Beobachtungsstation (Reserve). |
| **Check-in** | Teilnehmende am Eingang | QR-Code am Eingang → Code eingeben → „Ich bin da“. |
| **Lagekarte** | alle | Gelände mit Stationen, Bereitstellungsraum und Fahrzeugen, die zur Alarmzeit losfahren. Lageplan als Bild hochladbar. |
| **Stationen** | Stationsleitungen | Alarmierungsliste je Station und Durchgang (Uhrzeit, Fahrzeug, Kennzeichen, Träger), Mimen- und Beobachtungsgruppe. |
| **Ankunft** | Orga-Team an der Einfahrt (Handy) | Kennzeichen mit der Kamera erfassen. Steht das Fahrzeug in der Vorplanung, ist es sofort als „ist da“ markiert und die Kennung (z. B. `3-RTW-4`) wird groß angezeigt. Unbekanntes Kennzeichen: Typ und Träger antippen, die App gibt den vorgeplanten Platz des Trägers. Schickt ein Träger mehr als zugesagt: **zusätzlich einplanen**, **als Reserve bereitstellen** oder **Platz eines fehlenden Fahrzeugs übernehmen**, mit Empfehlung je nach freien Sitzplätzen. |
| **Zettel** | Orga-Team | Kennungs-Zettel zum Ausdrucken (A4 quer oder 2 × A5), farbig je Wache, wahlweise leer zum Ausfüllen. |
| **Orga** | Orga-Team (Passwort) | Vorplanung je Träger (zugesagte RTW/KTW/NEF bekommen schon vorab ihre Kennung), Fahrzeugübersicht mit Suche, Teilnehmende importieren, krank melden, einchecken, Plan erstellen und am Tag **ab dem nächsten Durchgang neu planen**, Gerechtigkeit prüfen, Einstellungen. |

## So wird verteilt

- Das 3. LJ wird auf so viele **Wachen** verteilt, wie es Stationen gibt. Jede Wache bekommt anteilig zu ihren Sitzplätzen Leute. Fahrzeuge werden gleichmäßig nach Typ auf die Wachen verteilt und bekommen Funkrufnamen wie `3-RTW-2`.
- Jede Wache rotiert pro Durchgang zur nächsten Station. Die Alarmfolge der Fahrzeuge rotiert ebenfalls, NEF kommt an fester Stelle.
- Pro Durchgang fahren zuerst die, die bisher am wenigsten gefahren sind. Die Plätze der **ersten Welle** (einstellbar, Standard: die ersten 3 Fahrzeuge je Station) bekommen die, die am seltensten vorne waren. NEF-Plätze bekommen die, die noch nie NEF hatten. Fahrer:in wird möglichst jemand vom Träger des Fahrzeugs.
- Besatzung: RTW/KTW mindestens 2, höchstens 3; NEF 1 bis 2 (einstellbar). Reichen die Leute nicht, bleiben die letzten Fahrzeuge der Alarmfolge leer.
- **Am Tag:** Fällt ein Fahrzeug aus oder ist jemand krank, zeigt die Orga-Ansicht „Plan passt nicht mehr“. „Ab Durchgang N neu planen“ lässt alle begonnenen Durchgänge unverändert, gleicht die Wachen mit möglichst wenigen Verschiebungen aus und plant den Rest neu.

## Lokal ausprobieren

```bash
python3 build.py                     # baut dist/public/index.html und die Demo-Datei
DEMO=1 ORGA_PASSWORT=bitte-aendern-123 PORT=8090 DATEN=./daten node server/server.js
# → http://127.0.0.1:8090
npm test                             # prüft die Planungslogik
```

Öffnet man `dist/public/index.html` direkt als Datei, läuft die App im Demo-Modus komplett im Browser (Demo-Passwort `simtag2027`).

## Kennzeichenerkennung

Die Texterkennung läuft komplett im Browser mit [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0, Dateien in `src/vendor/ocr/`, vom eigenen Server ausgeliefert). Fotos verlassen das Handy nicht. Leichte Lesefehler (8/B, 0/O, fehlender Bindestrich) gleicht die App mit den Kennzeichen der Vorplanung ab. Die Live-Kamera braucht HTTPS; ohne sie geht „Foto“ (öffnet die Handykamera) oder Eintippen.

## Aufbau

- `src/core.js` – Planungslogik, läuft im Browser und auf dem Server
- `src/app.js`, `src/style.css` – Oberfläche
- `src/demo.js` – erfundene Beispieldaten
- `server/server.js` – Node-Server ohne Abhängigkeiten: statische Dateien, API, Live-Aktualisierung per Server-Sent Events, Speicherung in `daten/state.json` mit Sicherungen alle 5 Minuten
- `deploy/` – systemd-Unit und nginx-Beispiel, Anleitung in [DEPLOY.md](DEPLOY.md)

## Datenschutz

- Ohne Code oder Orga-Passwort liefert der Server keine Namen, nur Funkrufnamen, Kennzeichen, Träger und Besatzungsstärken.
- Mit einem Code sieht man nur den eigenen Plan und die Namen der eigenen Fahrzeugbesatzung.
- Codes und Passwort sind gegen Durchprobieren gebremst (30 bzw. 10 Versuche pro Minute und IP).
- Nach dem SimTag `daten/` löschen.
