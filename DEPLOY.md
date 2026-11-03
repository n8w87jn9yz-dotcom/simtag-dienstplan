# Betrieb auf dem Szenarioheld-Server

Die App läuft auf dem vorhandenen IONOS-Server (nginx + Node 18+) als eigener Dienst, getrennt von den anderen Szenarioheld-Diensten.

**Adresse:** `https://stiwl.szenarioheld.de/simtag/` (Unterordner im bestehenden stiwl-Server-Block, SiMon stiwl bleibt unverändert).
Alternative mit eigener Subdomain: `deploy/nginx-stiwl.szenarioheld.de.conf` als Vorlage für einen eigenen Server-Block (DNS-A-Record + Zertifikat nötig).

**Port:** 8096 (auf dem Server belegt sind u. a. 3000, 8080, 8081, 8082, 8085, 8090, 8095 – vorher mit `ss -ltnp` prüfen).

1. **Sichern:** `/etc/nginx` nach `/root/nginx-sicherung-DATUM.tar.gz`.
2. **Benutzer und Ordner**
   ```bash
   sudo useradd --system --home /opt/simtag-dienstplan --shell /usr/sbin/nologin simtag
   sudo git clone https://github.com/n8w87jn9yz-dotcom/simtag-dienstplan /opt/simtag-dienstplan
   sudo mkdir -p /var/lib/simtag-dienstplan && sudo chown simtag: /var/lib/simtag-dienstplan
   ```
3. **Passwort** in `/etc/simtag-dienstplan.env` (root, Rechte 600), Kopie für Simon in `/root/simtag-dienstplan-zugang.txt` (600):
   ```
   ORGA_PASSWORT=<zufällig, mind. 16 Zeichen, z. B. openssl rand -base64 18>
   PORT=8096
   DEMO=1
   ```
   `DEMO=1` nur für den Testlauf: legt beim ersten Start erfundene Daten an. Für den Echtbetrieb `DEMO` entfernen, `/var/lib/simtag-dienstplan/state.json` löschen und neu starten.
4. **Dienst:** `deploy/simtag-dienstplan.service` nach `/etc/systemd/system/`, dann `systemctl daemon-reload && systemctl enable --now simtag-dienstplan`. Prüfen: `curl -s 127.0.0.1:8096/api/info` liefert `{"simtag":true,…}`.
5. **nginx:** Inhalt von `deploy/nginx-stiwl-simtag-location.conf` in den 443-Server-Block von `sites-available/szenarioheld-stiwl` einfügen, `nginx -t`, `systemctl reload nginx`.
6. **Prüfen:** `https://stiwl.szenarioheld.de/simtag/api/info` liefert `{"simtag":true,…}`; `https://stiwl.szenarioheld.de/` fragt weiter nach den SiMon-Zugangsdaten (401). Im Browser: Orga-Login, Teilnahme-Link aus Orga → Lage, Namenssuche auf dem Handy im Mobilfunk, Fahrzeug-Anmeldung, Einfahrt.
7. **Aktualisieren:** `cd /opt/simtag-dienstplan && git pull && systemctl restart simtag-dienstplan`. Die Daten in `/var/lib/simtag-dienstplan` bleiben erhalten (Sicherungen alle 5 Minuten im Unterordner `sicherung/`).
8. **Rückweg:** Location-Blöcke aus `szenarioheld-stiwl` entfernen (oder Sicherung zurückspielen), `nginx -t`, reload; `systemctl disable --now simtag-dienstplan`.
