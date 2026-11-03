#!/usr/bin/env node
/* SimTag Dienstplan – Server (Node 18+, ohne Abhängigkeiten)
 *
 * Umgebung:
 *   PORT=8080                 Port (lauscht nur auf 127.0.0.1, nginx davor)
 *   ORGA_PASSWORT=…           Pflicht. Passwort für den Orga-Bereich (mind. 10 Zeichen)
 *   DATEN=./daten             Ordner für state.json und Sicherungen
 *   DEMO=1                    Beim ersten Start erfundene Beispieldaten anlegen (Testlauf)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('../src/core.js');
const demoZustand = require('../src/demo.js');

const PORT = Number(process.env.PORT || 8080);
const PASSWORT = process.env.ORGA_PASSWORT || '';
const DATEN = path.resolve(process.env.DATEN || path.join(__dirname, 'daten'));
const OEFFENTLICH = path.resolve(__dirname, '..', 'dist', 'public');
const VENDOR = path.resolve(__dirname, '..', 'src', 'vendor');
if (PASSWORT.length < 10) { console.error('ORGA_PASSWORT fehlt oder ist kürzer als 10 Zeichen.'); process.exit(1); }
fs.mkdirSync(path.join(DATEN, 'sicherung'), { recursive: true });

const DATEI = path.join(DATEN, 'state.json');
let letzteSicherung = 0;
let zustand;
if (fs.existsSync(DATEI)) zustand = JSON.parse(fs.readFileSync(DATEI, 'utf8'));
else { zustand = process.env.DEMO === '1' ? demoZustand(C) : C.leererZustand(); speichern(); }
delete zustand.einstellungen.orgaPasswort;

function speichern() {
  const tmp = DATEI + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(zustand));
  fs.renameSync(tmp, DATEI);
  if (Date.now() - letzteSicherung > 5 * 60 * 1000) {
    letzteSicherung = Date.now();
    fs.copyFileSync(DATEI, path.join(DATEN, 'sicherung', 'state-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'));
  }
}

/* --- Live-Benachrichtigung (Server-Sent Events) --- */
const hoerer = new Set();
function melden() { for (const res of hoerer) res.write('data: ' + zustand.version + '\n\n'); }
setInterval(() => { for (const res of hoerer) res.write(': ping\n\n'); }, 25000);

/* --- einfache Bremse gegen Durchprobieren von Codes und Passwörtern --- */
const zaehler = new Map();
function gebremst(req, art, max) {
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
  const k = art + ':' + ip, jetzt = Date.now();
  const e = zaehler.get(k) || { n: 0, seit: jetzt };
  if (jetzt - e.seit > 60000) { e.n = 0; e.seit = jetzt; }
  e.n++; zaehler.set(k, e);
  return e.n > max;
}
setInterval(() => zaehler.clear(), 10 * 60000);

function gleich(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const istOrga = req => gleich(req.headers['x-orga-key'] || '', PASSWORT);

function json(res, code, daten) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(daten));
}
function koerper(req, max) {
  return new Promise((ok, nein) => {
    let n = 0; const teile = [];
    req.on('data', d => { n += d.length; if (n > max) { nein(new Error('zu groß')); req.destroy(); } else teile.push(d); });
    req.on('end', () => { try { ok(teile.length ? JSON.parse(Buffer.concat(teile).toString('utf8')) : {}); } catch (e) { nein(e); } });
  });
}

const TYPEN = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p.startsWith('/api/')) {
      const r = p.slice(5);
      if (r === 'info') return json(res, 200, { simtag: true, version: zustand.version });
      if (r === 'public') return json(res, 200, C.oeffentlich(zustand));
      if (r === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        res.write('retry: 5000\n\n'); hoerer.add(res); req.on('close', () => hoerer.delete(res)); return;
      }
      if (r === 'me') {
        if (gebremst(req, 'code', 30)) return json(res, 429, { fehler: 'Zu viele Versuche. Bitte eine Minute warten.' });
        const m = C.meinPlan(zustand, url.searchParams.get('code'));
        return m ? json(res, 200, m) : json(res, 404, { fehler: 'Code nicht gefunden' });
      }
      if (r === 'checkin' && req.method === 'POST') {
        if (gebremst(req, 'code', 30)) return json(res, 429, { fehler: 'Zu viele Versuche. Bitte eine Minute warten.' });
        const b = await koerper(req, 1000);
        const e = C.einchecken(zustand, b.code);
        if (!e) return json(res, 404, { fehler: 'Code nicht gefunden' });
        if (e.neu) { zustand.version++; speichern(); melden(); }
        return json(res, 200, e);
      }
      if (r === 'login' && req.method === 'POST') {
        if (gebremst(req, 'login', 10)) return json(res, 429, { fehler: 'Zu viele Versuche. Bitte eine Minute warten.' });
        const b = await koerper(req, 1000);
        return gleich(b.passwort || '', PASSWORT) ? json(res, 200, { ok: true }) : json(res, 401, { fehler: 'Passwort stimmt nicht.' });
      }
      if (r === 'state') {
        if (!istOrga(req)) return json(res, 401, { fehler: 'Nicht angemeldet' });
        if (req.method === 'GET') return json(res, 200, zustand);
        if (req.method === 'POST') {
          const b = await koerper(req, 8 * 1024 * 1024);
          if (b.basis !== zustand.version) return json(res, 409, { fehler: 'Konflikt', version: zustand.version });
          if (!b.zustand || !b.zustand.einstellungen || !Array.isArray(b.zustand.personen)) return json(res, 400, { fehler: 'Ungültige Daten' });
          zustand = b.zustand; zustand.version = b.basis + 1; delete zustand.einstellungen.orgaPasswort;
          speichern(); melden();
          return json(res, 200, { version: zustand.version });
        }
      }
      return json(res, 404, { fehler: 'Unbekannt' });
    }
    // Statische Dateien
    // Texterkennung (Tesseract) liegt in src/vendor und wird lange zwischengespeichert
    if (p.startsWith('/vendor/')) {
      const v = path.join(VENDOR, decodeURIComponent(p.slice(8)));
      if (!v.startsWith(VENDOR + path.sep) || !fs.existsSync(v)) return json(res, 404, { fehler: 'Nicht gefunden' });
      res.writeHead(200, { 'Content-Type': TYPEN[path.extname(v)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=604800' });
      return fs.createReadStream(v).pipe(res);
    }
    let datei = path.join(OEFFENTLICH, decodeURIComponent(p === '/' ? '/index.html' : p));
    if (!datei.startsWith(OEFFENTLICH)) return json(res, 403, { fehler: 'Verboten' });
    if (!fs.existsSync(datei) || fs.statSync(datei).isDirectory()) datei = path.join(OEFFENTLICH, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPEN[path.extname(datei)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(datei).pipe(res);
  } catch (e) {
    json(res, 400, { fehler: 'Anfrage fehlerhaft' });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log('SimTag-Dienstplan läuft auf http://127.0.0.1:' + PORT));
