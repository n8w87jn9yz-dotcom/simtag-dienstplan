# Betrieb auf stiwl.szenarioheld.de

Ziel: Die App läuft unter `https://stiwl.szenarioheld.de` auf dem vorhandenen IONOS-Server (nginx + Node 18+), getrennt von den anderen Szenarioheld-Diensten.

1. **Benutzer und Ordner**
   ```bash
   sudo useradd --system --home /opt/simtag-dienstplan --shell /usr/sbin/nologin simtag
   sudo git clone https://github.com/n8w87jn9yz-dotcom/simtag-dienstplan /opt/simtag-dienstplan
   sudo mkdir -p /var/lib/simtag-dienstplan && sudo chown simtag: /var/lib/simtag-dienstplan
   ```
2. **Passwort** in `/etc/simtag-dienstplan.env` (root, Rechte 600):
   ```
   ORGA_PASSWORT=<zufällig, mind. 16 Zeichen>
   PORT=8090
   DEMO=1
   ```
   `DEMO=1` nur für den Testlauf: legt beim ersten Start erfundene Daten an. Für den Echtbetrieb `DEMO` entfernen und `/var/lib/simtag-dienstplan/state.json` löschen.
3. **Dienst:** `deploy/simtag-dienstplan.service` nach `/etc/systemd/system/` kopieren, dann `sudo systemctl daemon-reload && sudo systemctl enable --now simtag-dienstplan`.
4. **nginx:** Server-Block aus `deploy/nginx-stiwl.szenarioheld.de.conf` übernehmen (Port anpassen, falls 8090 belegt), DNS-Eintrag `stiwl` auf den Server, `sudo certbot --nginx -d stiwl.szenarioheld.de`, `nginx -t`, reload. Die anderen Dienste (Lernwelt, Live-Umfrage, SiMon) nicht anfassen.
5. **Prüfen:** `https://stiwl.szenarioheld.de/api/info` liefert `{"simtag":true,…}`. Orga-Login, Check-in auf dem Handy im Mobilfunk, Lagekarte.
6. **Aktualisieren:** `cd /opt/simtag-dienstplan && sudo git pull && sudo systemctl restart simtag-dienstplan`. Die Daten in `/var/lib/simtag-dienstplan` bleiben erhalten.
