/* SimTag Dienstplan – Kernlogik (Browser und Node). Keine Abhängigkeiten. */
(function (root) {
  'use strict';

  const TYPEN = ['RTW', 'KTW', 'NEF'];
  const CODE_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function neuerCode(vorhanden, zufall) {
    const r = zufall || Math.random;
    for (;;) {
      let c = '';
      for (let i = 0; i < 6; i++) c += CODE_ZEICHEN[Math.floor(r() * CODE_ZEICHEN.length)];
      if (!vorhanden.has(c)) { vorhanden.add(c); return c; }
    }
  }

  function uid(prefix) {
    return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  function zeitZuMin(t) { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); }
  function minZuZeit(m) {
    m = ((Math.round(m) % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  function standardEinstellungen() {
    return {
      titel: 'SimTag 2027',
      datum: '2027-06-26',
      ort: 'LAFP NRW, Schloß Holte-Stukenbrock',
      durchgaenge: [
        { id: 'D1', start: '08:00', ende: '10:00' },
        { id: 'D2', start: '10:15', ende: '12:15' },
        { id: 'D3', start: '13:00', ende: '14:45' },
        { id: 'D4', start: '15:15', ende: '17:00' }
      ],
      stationen: [
        { id: 'S1', name: 'Verkehrsunfall', kurz: 'VU', x: 0.22, y: 0.30, patienten: 10 },
        { id: 'S2', name: 'Zugriff (SEK)', kurz: 'SEK', x: 0.52, y: 0.18, patienten: 10 },
        { id: 'S3', name: 'Explosion/Brand', kurz: 'Brand', x: 0.80, y: 0.32, patienten: 12 },
        { id: 'S4', name: 'Esoterik-Seminar', kurz: 'Eso', x: 0.70, y: 0.70, patienten: 25 },
        { id: 'S5', name: 'Zeltlager', kurz: 'Zelt', x: 0.30, y: 0.72, patienten: 15 }
      ],
      bereitstellung: { x: 0.50, y: 0.48 },
      eingang: { x: 0.08, y: 0.50 },
      besatzung: { RTW: [2, 3], KTW: [2, 3], NEF: [1, 2] },
      ersteWelle: 3,          // die ersten n Fahrzeuge je Station zählen als ersteintreffend
      nefPosition: 4,         // NEF wird als n-tes Fahrzeug alarmiert
      alarmRaster: [0, 3, 3, 5, 8, 8, 10, 12, 12, 15, 15, 18, 18, 20, 22, 24],
      anfahrtMin: 2,
      schminkenVorher: 45,
      treffenVorher: 15,
      nurEingecheckte: false,
      orgaPasswort: 'simtag2027',
      seed: 2027
    };
  }

  function leererZustand() {
    return { version: 1, einstellungen: standardEinstellungen(), personen: [], fahrzeuge: [], plan: null, log: [] };
  }

  /* ---------- Wachen ---------- */

  // Teilnehmende 3. LJ auf Wachen verteilen (eine Wache je Station). Klassen bleiben möglichst zusammen.
  function wachenKapazitaet(zustand) {
    const e = zustand.einstellungen, S = e.stationen.length, cap = Array(S).fill(0);
    zustand.fahrzeuge.forEach(f => { if (f.wache && f.status !== 'abgemeldet' && f.status !== 'defekt') cap[f.wache - 1] += e.besatzung[f.typ][1]; });
    return cap.map(c => c || 1);
  }

  // Sollgröße je Wache: anteilig zu den Sitzplätzen der Wache (Methode des größten Rests)
  function sollGroessen(n, cap) {
    const summe = cap.reduce((a, b) => a + b, 0);
    const roh = cap.map(c => n * c / summe), soll = roh.map(Math.floor);
    let rest = n - soll.reduce((a, b) => a + b, 0);
    roh.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest > 0) { soll[i]++; rest--; } });
    return soll;
  }

  // Teilnehmende 3. LJ auf Wachen verteilen (eine Wache je Station), anteilig zu den Sitzplätzen.
  // Klassen bleiben möglichst zusammen. nurOhneWache: nur Neue einsortieren, Bestehende bleiben.
  function wachenVerteilen(zustand, nurOhneWache) {
    const e = zustand.einstellungen, S = e.stationen.length;
    const tn = zustand.personen.filter(p => p.lj === 3 && aktiv(p, e));
    const cap = wachenKapazitaet(zustand);
    const soll = sollGroessen(tn.length, cap);
    const ok = p => p.wache >= 1 && p.wache <= S;
    if (!nurOhneWache) {
      tn.sort((a, b) => (a.klasse || '').localeCompare(b.klasse || '') || a.name.localeCompare(b.name));
      let w = 0, n = 0;
      tn.forEach(p => { while (w < S - 1 && n >= soll[w]) { w++; n = 0; } p.wache = w + 1; n++; });
      return;
    }
    const zaehl = Array(S).fill(0);
    tn.forEach(p => { if (ok(p)) zaehl[p.wache - 1]++; });
    tn.filter(p => !ok(p)).forEach(p => {
      let w = 0; for (let i = 1; i < S; i++) if (zaehl[i] - soll[i] < zaehl[w] - soll[w]) w = i;
      p.wache = w + 1; zaehl[w]++;
    });
  }

  // Wachen ausgleichen, wenn Fahrzeuge oder Leute am Tag wegfallen: verschiebt so wenige Personen wie nötig.
  function wachenAusgleichen(zustand) {
    const e = zustand.einstellungen, S = e.stationen.length;
    const tn = zustand.personen.filter(p => p.lj === 3 && aktiv(p, e) && p.wache >= 1 && p.wache <= S);
    const soll = sollGroessen(tn.length, wachenKapazitaet(zustand));
    const je = Array.from({ length: S }, (_, i) => tn.filter(p => p.wache === i + 1));
    let verschoben = 0;
    for (;;) {
      let hi = 0, lo = 0;
      for (let i = 1; i < S; i++) { if (je[i].length - soll[i] > je[hi].length - soll[hi]) hi = i; if (je[i].length - soll[i] < je[lo].length - soll[lo]) lo = i; }
      if (je[hi].length - soll[hi] <= 0 || je[lo].length - soll[lo] >= 0) break;
      const p = je[hi].pop(); p.wache = lo + 1; je[lo].push(p); verschoben++;
    }
    return verschoben;
  }

  // Fahrzeuge gleichmäßig nach Typ auf Wachen verteilen, Funkrufname vergeben.
  function fahrzeugWacheWaehlen(zustand, fz) {
    const S = zustand.einstellungen.stationen.length;
    const zaehl = Array(S).fill(0), gesamt = Array(S).fill(0);
    zustand.fahrzeuge.forEach(f => {
      if (f === fz || !f.wache || f.status === 'abgemeldet') return;
      gesamt[f.wache - 1]++;
      if (f.typ === fz.typ) zaehl[f.wache - 1]++;
    });
    let w = 0;
    for (let i = 1; i < S; i++) if (zaehl[i] < zaehl[w] || (zaehl[i] === zaehl[w] && gesamt[i] < gesamt[w])) w = i;
    return w + 1;
  }

  function funkrufnameVergeben(zustand, fz) {
    const belegt = new Set(zustand.fahrzeuge.filter(f => f !== fz && f.wache === fz.wache && f.typ === fz.typ).map(f => f.nr));
    let n = 1; while (belegt.has(n)) n++;
    fz.nr = n;
    fz.funkrufname = fz.wache + '-' + fz.typ + '-' + n;
  }

  function fahrzeugHinzufuegen(zustand, daten) {
    const fz = {
      id: uid('f'), typ: daten.typ, kennzeichen: (daten.kennzeichen || '').trim().toUpperCase(),
      traeger: (daten.traeger || '').trim(), status: daten.status || 'da',
      registriert: daten.registriert || new Date().toISOString()
    };
    fz.wache = daten.wache || fahrzeugWacheWaehlen(zustand, fz);
    zustand.fahrzeuge.push(fz);
    funkrufnameVergeben(zustand, fz);
    return fz;
  }

  /* ---------- Planung ---------- */

  function aktiv(p, e) {
    if (p.status === 'abgemeldet' || p.status === 'krank') return false;
    if (e.nurEingecheckte) return !!p.eingecheckt;
    return true;
  }

  function leereStatistik() { return { einsaetze: 0, erste: 0, nef: 0, fahrer: 0, pause: 0, fahrzeuge: {} }; }

  function statistikAus(plan, bisIndex) {
    const st = {};
    const g = id => (st[id] || (st[id] = leereStatistik()));
    (plan ? plan.durchgaenge : []).slice(0, bisIndex).forEach(d => {
      d.einsaetze.forEach(e => e.fahrzeuge.forEach(f => f.besatzung.forEach(pid => {
        const s = g(pid); s.einsaetze++;
        if (f.erste) s.erste++;
        if (f.typ === 'NEF') s.nef++;
        if (f.fahrer === pid) s.fahrer++;
        s.fahrzeuge[f.fid] = (s.fahrzeuge[f.fid] || 0) + 1;
      })));
      d.einsaetze.forEach(e => e.pause.forEach(pid => g(pid).pause++));
    });
    return st;
  }

  function rotiere(arr, k) { if (!arr.length) return arr; k = ((k % arr.length) + arr.length) % arr.length; return arr.slice(k).concat(arr.slice(0, k)); }

  function alarmMinute(e, pos) {
    const r = e.alarmRaster;
    if (pos < r.length) return r[pos];
    return r[r.length - 1] + 2 * (pos - r.length + 1);
  }

  // Plant einen Durchgang für eine Wache. Liefert {fahrzeuge:[...], pause:[...], hinweise:[...]}
  function planeWache(zustand, dIndex, wache, station, statistik, zufall) {
    const e = zustand.einstellungen;
    const leute = zustand.personen.filter(p => p.lj === 3 && p.wache === wache && aktiv(p, e));
    const fzAlle = zustand.fahrzeuge.filter(f => f.wache === wache && f.status !== 'abgemeldet' && f.status !== 'defekt');
    const hinweise = [];
    const g = id => (statistik[id] || (statistik[id] = leereStatistik()));

    // Reihenfolge: RTW/KTW rotieren je Durchgang, damit jedes Fahrzeug mal vorne fährt; NEF an fester Position.
    const boden = fzAlle.filter(f => f.typ !== 'NEF').sort((a, b) => (a.typ === b.typ ? a.nr - b.nr : (a.typ === 'RTW' ? -1 : 1)));
    const nefs = fzAlle.filter(f => f.typ === 'NEF').sort((a, b) => a.nr - b.nr);
    const schritt = Math.max(1, Math.ceil(boden.length / Math.max(1, e.durchgaenge.length)));
    const reihe = rotiere(boden, dIndex * schritt);
    const nefsR = rotiere(nefs, dIndex);
    nefsR.forEach((n, i) => reihe.splice(Math.min(reihe.length, e.nefPosition - 1 + i * 4), 0, n));

    // Besatzungsstärke festlegen
    const min = f => e.besatzung[f.typ][0], max = f => e.besatzung[f.typ][1];
    let fahrzeuge = reihe.slice();
    let N = leute.length;
    while (fahrzeuge.length && fahrzeuge.reduce((s, f) => s + min(f), 0) > N) {
      // hinterstes Fahrzeug bleibt unbesetzt (NEF zuletzt streichen)
      let idx = fahrzeuge.length - 1;
      while (idx > 0 && fahrzeuge[idx].typ === 'NEF') idx--;
      hinweise.push(fahrzeuge[idx].funkrufname + ' bleibt unbesetzt (zu wenig Teilnehmende)');
      fahrzeuge.splice(idx, 1);
    }
    const groesse = fahrzeuge.map(min);
    let rest = N - groesse.reduce((s, x) => s + x, 0);
    // Zusätzliche Plätze zuerst auf RTW/KTW in Alarmreihenfolge, dann NEF
    for (const nurBoden of [true, false]) {
      for (let i = 0; i < fahrzeuge.length && rest > 0; i++) {
        if (nurBoden && fahrzeuge[i].typ === 'NEF') continue;
        if (groesse[i] < max(fahrzeuge[i])) { groesse[i]++; rest--; }
      }
    }
    const plaetze = groesse.reduce((s, x) => s + x, 0);

    // Wer pausiert? Die mit den meisten Einsätzen bisher (Zufall bei Gleichstand)
    const los = new Map(leute.map(p => [p.id, zufall()]));
    let kandidaten = leute.slice().sort((a, b) =>
      (g(a.id).einsaetze - g(b.id).einsaetze) || (Math.min(g(a.id).erste, 1) - Math.min(g(b.id).erste, 1)) || (g(b.id).pause - g(a.id).pause) || (los.get(a.id) - los.get(b.id)));
    const pause = kandidaten.slice(plaetze).map(p => p.id);
    kandidaten = kandidaten.slice(0, plaetze);

    // Plätze bilden und nach Seltenheit füllen: erste Welle, dann NEF, dann übrige
    const ergebnis = fahrzeuge.map((f, i) => ({
      fid: f.id, funkrufname: f.funkrufname, typ: f.typ, kennzeichen: f.kennzeichen, traeger: f.traeger,
      reihenfolge: i + 1, minute: alarmMinute(e, i), erste: i < e.ersteWelle, besatzung: [], fahrer: null
    }));
    const slots = [];
    ergebnis.forEach((f, i) => { for (let k = 0; k < groesse[i]; k++) slots.push(f); });
    const rang = f => (f.erste ? 0 : f.typ === 'NEF' ? 1 : 2);
    slots.sort((a, b) => rang(a) - rang(b) || a.reihenfolge - b.reihenfolge);

    const frei = new Set(kandidaten.map(p => p.id));
    const person = new Map(leute.map(p => [p.id, p]));
    for (const f of slots) {
      let best = null, bestK = Infinity;
      for (const pid of frei) {
        const s = g(pid);
        let k = 0;
        if (f.erste) k += 100 * s.erste;               // erste Welle: wer am seltensten vorne war
        if (f.typ === 'NEF') k += 100 * s.nef;          // NEF: wer am seltensten NEF hatte
        if (!f.erste && s.erste === 0) k += 40;       // Leute ohne erste Welle für spätere Durchgänge aufheben
        if (f.typ !== 'NEF' && s.nef === 0) k += 5;    // Leute ohne NEF bevorzugt für NEF aufheben
        k += 15 * (s.fahrzeuge[f.fid] || 0);           // nicht immer dasselbe Fahrzeug
        k += los.get(pid);
        if (k < bestK) { bestK = k; best = pid; }
      }
      if (best == null) break;
      frei.delete(best);
      f.besatzung.push(best);
    }

    // Fahrer: möglichst vom Träger des Fahrzeugs, sonst wer am seltensten gefahren ist
    ergebnis.forEach(f => {
      if (!f.besatzung.length) return;
      const eigene = f.besatzung.filter(pid => norm(person.get(pid).traeger) === norm(f.traeger));
      const pool = eigene.length ? eigene : f.besatzung;
      pool.sort((a, b) => g(a).fahrer - g(b).fahrer || los.get(a) - los.get(b));
      f.fahrer = pool[0];
      f.fahrerFremd = !eigene.length;
      // Fahrer an erste Stelle
      f.besatzung = [f.fahrer].concat(f.besatzung.filter(x => x !== f.fahrer));
    });

    // Statistik fortschreiben
    ergebnis.forEach(f => f.besatzung.forEach(pid => {
      const s = g(pid); s.einsaetze++; if (f.erste) s.erste++; if (f.typ === 'NEF') s.nef++;
      if (f.fahrer === pid) s.fahrer++; s.fahrzeuge[f.fid] = (s.fahrzeuge[f.fid] || 0) + 1;
    }));
    pause.forEach(pid => g(pid).pause++);

    return { wache, station, fahrzeuge: ergebnis.filter(f => f.besatzung.length), pause, hinweise };
  }

  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, ''); }

  function stationFuer(gruppe, dIndex, S) { return ((gruppe - 1 + dIndex) % S + S) % S; }

  // Gruppen (A, B, …) für 2. und 1. LJ
  function gruppenVerteilen(zustand, lj) {
    const S = zustand.einstellungen.stationen.length;
    const liste = zustand.personen.filter(p => p.lj === lj)
      .sort((a, b) => (a.klasse || '').localeCompare(b.klasse || '') || a.name.localeCompare(b.name));
    const ziel = Math.ceil(liste.length / S) || 1;
    liste.forEach((p, i) => { p.gruppe = Math.min(S, Math.floor(i / ziel) + 1); });
  }

  // Ganzer Plan oder ab Durchgang `abIndex` neu (frühere Durchgänge bleiben unverändert)
  function planen(zustand, abIndex) {
    const e = zustand.einstellungen;
    const S = e.stationen.length;
    abIndex = Math.max(0, abIndex || 0);
    if (!zustand.plan || abIndex === 0) abIndex = 0;
    if (zustand.personen.some(p => p.lj === 3 && !(p.wache >= 1 && p.wache <= S))) wachenVerteilen(zustand, true);
    if (abIndex > 0) wachenAusgleichen(zustand);
    [2, 1].forEach(lj => { if (zustand.personen.some(p => p.lj === lj && !(p.gruppe >= 1 && p.gruppe <= S))) gruppenVerteilen(zustand, lj); });

    const alt = zustand.plan;
    const statistik = statistikAus(alt, abIndex);
    const durchgaenge = [];
    e.durchgaenge.forEach((d, di) => {
      if (di < abIndex && alt && alt.durchgaenge[di]) { durchgaenge.push(alt.durchgaenge[di]); return; }
      const zufall = rng((e.seed || 1) * 31 + di * 7919 + (zustand.planZaehler || 0));
      const einsaetze = [];
      for (let w = 1; w <= S; w++) {
        const st = e.stationen[stationFuer(w, di, S)];
        einsaetze.push(planeWache(zustand, di, w, st.id, statistik, zufall));
      }
      const mimen = {}, zuschauer = {};
      for (let gr = 1; gr <= S; gr++) {
        mimen[e.stationen[stationFuer(gr, di, S)].id] = gr;
        zuschauer[e.stationen[stationFuer(gr + 2, di, S)].id] = gr;
      }
      durchgaenge.push({ id: d.id, einsaetze, mimen, zuschauer });
    });
    zustand.planZaehler = (zustand.planZaehler || 0) + 1;
    zustand.plan = { erstellt: new Date().toISOString(), abIndex, durchgaenge, fingerabdruck: fingerabdruck(zustand) };
    return zustand.plan;
  }

  // Erkennt, ob sich Fahrzeuge oder Teilnehmende seit der Planung geändert haben
  function fingerabdruck(zustand) {
    const e = zustand.einstellungen;
    const p = zustand.personen.filter(x => x.lj === 3 && aktiv(x, e)).map(x => x.id + ':' + x.wache).sort().join(',');
    const f = zustand.fahrzeuge.filter(x => x.status !== 'abgemeldet' && x.status !== 'defekt').map(x => x.id + ':' + x.wache).sort().join(',');
    return hash(p + '|' + f + '|' + JSON.stringify([e.besatzung, e.ersteWelle, e.nefPosition, e.stationen.length, e.durchgaenge.length]));
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function planVeraltet(zustand) { return !zustand.plan || zustand.plan.fingerabdruck !== fingerabdruck(zustand); }

  // Index des Durchgangs, der zur Uhrzeit (Minuten) läuft oder als nächstes kommt
  function aktuellerDurchgang(e, minute) {
    for (let i = 0; i < e.durchgaenge.length; i++) if (minute < zeitZuMin(e.durchgaenge[i].ende)) return i;
    return e.durchgaenge.length;
  }

  /* ---------- Auswertung ---------- */

  function gerechtigkeit(zustand) {
    const st = statistikAus(zustand.plan, zustand.plan ? zustand.plan.durchgaenge.length : 0);
    const tn = zustand.personen.filter(p => p.lj === 3 && aktiv(p, zustand.einstellungen));
    const werte = k => tn.map(p => (st[p.id] || leereStatistik())[k]);
    const verteilung = arr => { const m = {}; arr.forEach(v => { m[v] = (m[v] || 0) + 1; }); return m; };
    return {
      anzahl: tn.length,
      einsaetze: verteilung(werte('einsaetze')),
      erste: verteilung(werte('erste')),
      nef: verteilung(werte('nef')),
      ohneErste: tn.filter(p => !(st[p.id] && st[p.id].erste)).map(p => p.id),
      statistik: st
    };
  }

  function kapazitaet(zustand) {
    const e = zustand.einstellungen;
    const fz = zustand.fahrzeuge.filter(f => f.status !== 'abgemeldet' && f.status !== 'defekt');
    const anz = t => fz.filter(f => f.typ === t).length;
    const min = TYPEN.reduce((s, t) => s + anz(t) * e.besatzung[t][0], 0);
    const max = TYPEN.reduce((s, t) => s + anz(t) * e.besatzung[t][1], 0);
    const tn = zustand.personen.filter(p => p.lj === 3 && aktiv(p, e)).length;
    const ersteSitze = e.stationen.length * e.durchgaenge.length * e.ersteWelle * e.besatzung.RTW[1];
    return { RTW: anz('RTW'), KTW: anz('KTW'), NEF: anz('NEF'), min, max, tn, ersteSitze };
  }

  // Persönlicher Plan einer Person
  function persoenlicherPlan(zustand, pid) {
    const e = zustand.einstellungen, p = zustand.personen.find(x => x.id === pid);
    if (!p) return null;
    const station = id => e.stationen.find(s => s.id === id);
    const name = id => { const q = zustand.personen.find(x => x.id === id); return q ? q.name : '?'; };
    const zeilen = [];
    (zustand.plan ? zustand.plan.durchgaenge : []).forEach((d, di) => {
      const dg = e.durchgaenge[di]; if (!dg) return;
      const start = zeitZuMin(dg.start);
      if (p.lj === 3) {
        let z = null;
        d.einsaetze.forEach(ei => {
          ei.fahrzeuge.forEach(f => {
            if (f.besatzung.includes(pid)) z = {
              art: 'einsatz', station: station(ei.station), wache: ei.wache, funkrufname: f.funkrufname, typ: f.typ,
              kennzeichen: f.kennzeichen, traeger: f.traeger, rolle: f.fahrer === pid ? 'Fahrer:in' : 'Besatzung',
              erste: f.erste, reihenfolge: f.reihenfolge, alarm: minZuZeit(start + f.minute),
              team: f.besatzung.filter(x => x !== pid).map(name)
            };
          });
          if (ei.pause.includes(pid)) z = { art: 'pause', station: station(ei.station), wache: ei.wache };
        });
        zeilen.push(Object.assign({ durchgang: di + 1, von: dg.start, bis: dg.ende }, z || { art: 'frei' }));
      } else {
        const tab = p.lj === 2 ? d.mimen : d.zuschauer;
        const sid = Object.keys(tab).find(k => tab[k] === p.gruppe);
        zeilen.push({
          durchgang: di + 1, von: dg.start, bis: dg.ende, art: p.lj === 2 ? 'mime' : 'zuschauen', station: station(sid),
          schminken: minZuZeit(start - e.schminkenVorher), treffen: minZuZeit(start - e.treffenVorher)
        });
      }
    });
    return { person: p, zeilen };
  }


  /* ---------- Datenschutz: was ohne Orga-Zugang sichtbar ist ---------- */

  // Öffentliche Sicht: keine Namen, keine Codes. Besatzungen nur als Anzahl.
  function oeffentlich(zustand) {
    const e = Object.assign({}, zustand.einstellungen); delete e.orgaPasswort;
    const plan = zustand.plan ? {
      erstellt: zustand.plan.erstellt,
      durchgaenge: zustand.plan.durchgaenge.map(d => ({
        id: d.id, mimen: d.mimen, zuschauer: d.zuschauer,
        einsaetze: d.einsaetze.map(ei => ({
          wache: ei.wache, station: ei.station, pause: ei.pause.length, hinweise: ei.hinweise,
          fahrzeuge: ei.fahrzeuge.map(f => Object.assign({}, f, { besatzung: f.besatzung.length, fahrer: null }))
        }))
      }))
    } : null;
    const lj = n => zustand.personen.filter(p => p.lj === n && p.status !== 'abgemeldet');
    const zaehl = n => ({ gesamt: lj(n).length, da: lj(n).filter(p => p.eingecheckt).length });
    const gruppen = {};
    [2, 1].forEach(n => { gruppen[n] = {}; lj(n).forEach(p => { gruppen[n][p.gruppe] = (gruppen[n][p.gruppe] || 0) + 1; }); });
    return {
      version: zustand.version, demo: !!zustand.demo, einstellungen: e, plan, gruppen,
      zaehlung: { 3: zaehl(3), 2: zaehl(2), 1: zaehl(1) },
      fahrzeuge: zustand.fahrzeuge.map(f => ({ id: f.id, typ: f.typ, funkrufname: f.funkrufname, kennzeichen: f.kennzeichen, traeger: f.traeger, wache: f.wache, status: f.status }))
    };
  }

  function findeCode(zustand, code) {
    code = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return code.length >= 4 ? zustand.personen.find(p => p.code === code) || null : null;
  }

  // Persönliche Sicht über den Code
  function meinPlan(zustand, code) {
    const p = findeCode(zustand, code);
    if (!p) return null;
    const pp = persoenlicherPlan(zustand, p.id);
    return { name: p.name, klasse: p.klasse, lj: p.lj, wache: p.wache, gruppe: p.gruppe, eingecheckt: p.eingecheckt, status: p.status, zeilen: pp.zeilen };
  }

  function einchecken(zustand, code, jetzt) {
    const p = findeCode(zustand, code);
    if (!p) return null;
    const neu = !p.eingecheckt;
    if (neu) p.eingecheckt = jetzt || new Date().toISOString();
    if (p.status === 'abgemeldet' || p.status === 'krank') p.status = 'angemeldet';
    return { name: p.name, lj: p.lj, eingecheckt: p.eingecheckt, neu };
  }

  const api = {
    TYPEN, rng, neuerCode, uid, zeitZuMin, minZuZeit, standardEinstellungen, leererZustand,
    wachenVerteilen, wachenAusgleichen, gruppenVerteilen, fahrzeugHinzufuegen, fahrzeugWacheWaehlen, funkrufnameVergeben,
    planen, planVeraltet, fingerabdruck, aktuellerDurchgang, gerechtigkeit, kapazitaet, persoenlicherPlan,
    statistikAus, stationFuer, aktiv, norm, oeffentlich, findeCode, meinPlan, einchecken
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SimCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
