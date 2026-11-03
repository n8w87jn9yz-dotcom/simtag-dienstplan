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
      selbstanmeldung: true,  // Fastlane nur mit Selbstanmeldung der Besatzung
      fahrgruppen: JSON.parse(JSON.stringify(STANDARD_FAHRGRUPPEN)),
      orgaPasswort: 'simtag2027',
      seed: 2027
    };
  }

  function leererZustand() {
    return { version: 1, einstellungen: standardEinstellungen(), personen: [], fahrzeuge: [], anmeldungen: [], plan: null, log: [], zugang: zufallsText(10) };
  }

  function zufallsText(n) {
    const b = new Uint32Array(n);
    try { globalThis.crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 4294967296); }
    let t = ''; for (let i = 0; i < n; i++) t += CODE_ZEICHEN[b[i] % CODE_ZEICHEN.length];
    return t;
  }

  /* ---------- Wer darf welches Fahrzeug fahren? ---------- */
  // Fahrgruppe = Rettungsdienstträger (Kreis/Stadt). Wer bei einem Mitglied arbeitet, darf alle Fahrzeuge der Gruppe fahren.
  // Abgeleitet aus der Formel „Fahrer von Orga?“ der Planung 2026 (z. B. gGmbH und BF BI → Stadt Bielefeld).
  // Träger, die in keiner Gruppe stehen, bilden ihre eigene Gruppe.
  const STANDARD_FAHRGRUPPEN = [
    { name: 'Stadt Bielefeld', mitglieder: ['BF Bielefeld', 'BF BI', 'Feuerwehr Bielefeld', 'Rettungsdienst gGmbH', 'gGmbH', 'BIEKRA'] },
    { name: 'Stadt Gütersloh', mitglieder: ['BF GT', 'FW Gütersloh', 'Feuerwehr Gütersloh'] },
    { name: 'Kreis Gütersloh', mitglieder: ['Kreis GT'] },
    { name: 'Stadt Düsseldorf', mitglieder: ['Feuerwehr Düsseldorf', 'FW Düsseldorf', 'BF Düsseldorf'] }
  ];

  function fahrgruppe(e, traeger) {
    const n = norm(traeger); if (!n) return '';
    const gruppen = (e && e.fahrgruppen) || STANDARD_FAHRGRUPPEN;
    for (const g of gruppen) if (norm(g.name) === n || (g.mitglieder || []).some(m => norm(m) === n)) return norm(g.name);
    return n;
  }
  function fahrgruppeName(e, traeger) {
    const n = norm(traeger); if (!n) return '';
    const gruppen = (e && e.fahrgruppen) || STANDARD_FAHRGRUPPEN;
    for (const g of gruppen) if (norm(g.name) === n || (g.mitglieder || []).some(m => norm(m) === n)) return g.name;
    return String(traeger).trim();
  }
  // Fahrzeug ohne Träger: keine Einschränkung bekannt
  function darfFahren(e, p, f) {
    if (!p || !f) return false;
    if (!norm(f.traeger)) return true;
    return !!norm(p.traeger) && fahrgruppe(e, p.traeger) === fahrgruppe(e, f.traeger);
  }
  // Text „Gruppe: Träger, Träger“ (eine Zeile pro Gruppe) <-> Liste
  function fahrgruppenAusText(text) {
    return String(text || '').split(/\r?\n/).map(z => z.trim()).filter(Boolean).map(z => {
      const [name, rest] = z.split(/:(.*)/s);
      return { name: name.trim(), mitglieder: String(rest || '').split(/[,;]/).map(x => x.trim()).filter(Boolean) };
    }).filter(g => g.name);
  }
  function fahrgruppenAlsText(e) {
    return ((e && e.fahrgruppen) || STANDARD_FAHRGRUPPEN).map(g => g.name + ': ' + (g.mitglieder || []).join(', ')).join('\n');
  }

  // Je Wache: wie viele Fahrzeuge brauchen eine Fahrerin oder einen Fahrer aus welcher Fahrgruppe?
  function fahrerBedarf(zustand) {
    const e = zustand.einstellungen, S = e.stationen.length;
    const bedarf = Array.from({ length: S }, () => new Map());
    zustand.fahrzeuge.forEach(f => {
      if (!fzAktiv(f, e) || f.fahrerExtern || !norm(f.traeger) || !(f.wache >= 1 && f.wache <= S)) return;
      const g = fahrgruppe(e, f.traeger), m = bedarf[f.wache - 1];
      m.set(g, (m.get(g) || 0) + 1);
    });
    return bedarf;
  }

  // Übersicht je Fahrgruppe: Fahrzeuge und Teilnehmende, die sie fahren dürfen
  function fahrerUebersicht(zustand) {
    const e = zustand.einstellungen, m = new Map();
    const eintrag = t => { const k = fahrgruppe(e, t); if (!m.has(k)) m.set(k, { gruppe: fahrgruppeName(e, t), fahrzeuge: 0, extern: 0, leute: 0, traeger: new Set() }); return m.get(k); };
    zustand.fahrzeuge.forEach(f => { if (!fzAktiv(f, e) || !norm(f.traeger)) return; const x = eintrag(f.traeger); x.traeger.add(f.traeger); if (f.fahrerExtern) x.extern++; else x.fahrzeuge++; });
    zustand.personen.forEach(p => { if (p.lj !== 3 || !aktiv(p, e) || !norm(p.traeger)) return; const x = eintrag(p.traeger); x.traeger.add(p.traeger); x.leute++; });
    return [...m.values()].map(x => Object.assign(x, { traeger: [...x.traeger].sort() })).sort((a, b) => (a.leute - a.fahrzeuge) - (b.leute - b.fahrzeuge) || a.gruppe.localeCompare(b.gruppe));
  }

  /* ---------- Wachen ---------- */

  // Teilnehmende 3. LJ auf Wachen verteilen (eine Wache je Station). Klassen bleiben möglichst zusammen.
  function wachenKapazitaet(zustand) {
    const e = zustand.einstellungen, S = e.stationen.length, cap = Array(S).fill(0);
    zustand.fahrzeuge.forEach(f => { if (fzAktiv(f, e)) cap[f.wache - 1] += e.besatzung[f.typ][1]; });
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
  // Zuerst bekommt jede Wache genug Leute, die ihre Fahrzeuge fahren dürfen (plus eine Person Luft je Fahrgruppe),
  // der Rest wird nach Klasse aufgefüllt, damit Klassen möglichst zusammenbleiben.
  // nurOhneWache: nur Neue einsortieren, Bestehende bleiben.
  function wachenVerteilen(zustand, nurOhneWache) {
    const e = zustand.einstellungen, S = e.stationen.length;
    const tn = zustand.personen.filter(p => p.lj === 3 && aktiv(p, e));
    const soll = sollGroessen(tn.length, wachenKapazitaet(zustand));
    const bedarf = fahrerBedarf(zustand);
    const gr = p => fahrgruppe(e, p.traeger);
    const ok = p => p.wache >= 1 && p.wache <= S;
    const sortierung = (a, b) => (a.klasse || '').localeCompare(b.klasse || '') || a.name.localeCompare(b.name);
    if (!nurOhneWache) {
      tn.forEach(p => { p.wache = 0; });
      const zaehl = Array(S).fill(0);
      const setze = (p, w) => { p.wache = w + 1; zaehl[w]++; };
      const proGruppe = new Map();
      tn.slice().sort(sortierung).forEach(p => { const g = gr(p); if (!proGruppe.has(g)) proGruppe.set(g, []); proGruppe.get(g).push(p); });
      // Runde 1: je Fahrzeug eine Person, die es fahren darf (reihum über die Wachen, falls es knapp ist)
      proGruppe.forEach((liste, g) => {
        const offen = bedarf.map(m => m.get(g) || 0);
        let weiter = true;
        while (weiter && liste.length) {
          weiter = false;
          for (let w = 0; w < S && liste.length; w++) if (offen[w] > 0) { setze(liste.shift(), w); offen[w]--; weiter = true; }
        }
      });
      // Runde 2: übrige Leute der Fahrgruppe anteilig zu deren Fahrzeugen verteilen, damit die Fahrerrolle wechseln kann
      proGruppe.forEach((liste, g) => {
        const D = bedarf.reduce((s, m) => s + (m.get(g) || 0), 0); if (!D) return;
        const hat = Array(S).fill(0); tn.forEach(p => { if (p.wache && gr(p) === g) hat[p.wache - 1]++; });
        const n0 = liste.length + hat.reduce((a, b) => a + b, 0);
        const ziel = bedarf.map(m => Math.floor(n0 * (m.get(g) || 0) / D));
        let weiter = true;
        while (weiter && liste.length) {
          weiter = false;
          for (let w = 0; w < S && liste.length; w++) if (hat[w] < ziel[w] && zaehl[w] < soll[w]) { setze(liste.shift(), w); hat[w]++; weiter = true; }
        }
      });
      // Runde 3: alle übrigen nach Klasse auffüllen
      let w = 0;
      tn.filter(p => !ok(p)).sort(sortierung).forEach(p => {
        while (w < S - 1 && zaehl[w] >= soll[w]) w++;
        setze(p, w);
      });
      return;
    }
    const zaehl = Array(S).fill(0), hat = Array.from({ length: S }, () => new Map());
    tn.forEach(p => { if (ok(p)) { zaehl[p.wache - 1]++; const m = hat[p.wache - 1]; m.set(gr(p), (m.get(gr(p)) || 0) + 1); } });
    tn.filter(p => !ok(p)).forEach(p => {
      const g = gr(p);
      const wert = i => ((bedarf[i].get(g) || 0) > (hat[i].get(g) || 0) ? -1000 : 0) + zaehl[i] - soll[i];
      let w = 0; for (let i = 1; i < S; i++) if (wert(i) < wert(w)) w = i;
      p.wache = w + 1; zaehl[w]++; hat[w].set(g, (hat[w].get(g) || 0) + 1);
    });
  }

  // Wachen ausgleichen, wenn Fahrzeuge oder Leute am Tag wegfallen oder dazukommen. Verschiebt so wenige Personen wie nötig:
  // 1. Fehlt einer Wache jemand, der ein Fahrzeug fahren darf, kommt eine passende Person aus einer Wache mit Überschuss.
  // 2. Danach werden die Größen an die Sitzplätze angeglichen, ohne neue Fahrer-Lücken zu reißen.
  function wachenAusgleichen(zustand) {
    const e = zustand.einstellungen, S = e.stationen.length;
    const tn = zustand.personen.filter(p => p.lj === 3 && aktiv(p, e) && p.wache >= 1 && p.wache <= S);
    const soll = sollGroessen(tn.length, wachenKapazitaet(zustand));
    const bedarf = fahrerBedarf(zustand);
    const gr = new Map(tn.map(p => [p.id, fahrgruppe(e, p.traeger)]));
    const groesse = w => tn.filter(p => p.wache === w + 1).length;
    const anzahl = (w, g) => tn.filter(p => p.wache === w + 1 && gr.get(p.id) === g).length;
    const ueberschuss = (w, g) => anzahl(w, g) - (bedarf[w].get(g) || 0);
    let verschoben = 0;
    for (let w = 0; w < S; w++) {
      for (const [g, n] of bedarf[w]) {
        let fehlt = n - anzahl(w, g);
        while (fehlt > 0) {
          let best = null, bestWert = -Infinity;
          tn.forEach(p => {
            if (gr.get(p.id) !== g || p.wache === w + 1) return;
            const v = p.wache - 1; if (ueberschuss(v, g) <= 0) return;
            const wert = groesse(v) - soll[v];
            if (wert > bestWert) { bestWert = wert; best = p; }
          });
          if (!best) break;
          best.wache = w + 1; verschoben++; fehlt--;
        }
      }
    }
    for (let runde = 0; runde < tn.length; runde++) {
      let hi = 0, lo = 0;
      for (let i = 1; i < S; i++) { if (groesse(i) - soll[i] > groesse(hi) - soll[hi]) hi = i; if (groesse(i) - soll[i] < groesse(lo) - soll[lo]) lo = i; }
      if (groesse(hi) - soll[hi] <= 0 || groesse(lo) - soll[lo] >= 0) break;
      // wer kann gehen? Zuerst Leute, deren Fahrgruppe in der Wache gar nicht gebraucht wird, dann Überschuss
      const kandidaten = tn.filter(p => p.wache === hi + 1 && ueberschuss(hi, gr.get(p.id)) > 0)
        .sort((a, b) => ((bedarf[hi].get(gr.get(a.id)) || 0) - (bedarf[hi].get(gr.get(b.id)) || 0)) || ((bedarf[lo].get(gr.get(b.id)) || 0) - (bedarf[lo].get(gr.get(a.id)) || 0)));
      if (!kandidaten.length) break;
      kandidaten[0].wache = lo + 1; verschoben++;
    }
    return verschoben;
  }

  // Fahrzeuge gleichmäßig nach Typ auf Wachen verteilen, Funkrufname vergeben.
  function fahrzeugWacheWaehlen(zustand, fz) {
    const e = zustand.einstellungen, S = e.stationen.length;
    const zaehl = Array(S).fill(0), gesamt = Array(S).fill(0), frei = Array(S).fill(0);
    const g = fahrgruppe(e, fz.traeger);
    zustand.fahrzeuge.forEach(f => {
      if (f === fz || !f.wache || f.status === 'abgemeldet' || f.status === 'reserve') return;
      gesamt[f.wache - 1]++;
      if (f.typ === fz.typ) zaehl[f.wache - 1]++;
      if (g && !f.fahrerExtern && fahrgruppe(e, f.traeger) === g) frei[f.wache - 1]--;
    });
    if (g) zustand.personen.forEach(p => { if (p.lj === 3 && p.wache >= 1 && p.wache <= S && aktiv(p, e) && fahrgruppe(e, p.traeger) === g) frei[p.wache - 1]++; });
    let w = 0;
    for (let i = 1; i < S; i++) {
      if (zaehl[i] < zaehl[w] || (zaehl[i] === zaehl[w] && (frei[i] > frei[w] || (frei[i] === frei[w] && gesamt[i] < gesamt[w])))) w = i;
    }
    return w + 1;
  }

  function funkrufnameVergeben(zustand, fz) {
    const belegt = new Set(zustand.fahrzeuge.filter(f => f !== fz && f.wache === fz.wache && f.typ === fz.typ).map(f => f.nr));
    let n = 1; while (belegt.has(n)) n++;
    fz.nr = n;
    fz.funkrufname = (fz.wache || 'R') + '-' + fz.typ + '-' + n;
  }

  function fahrzeugHinzufuegen(zustand, daten) {
    const fz = {
      id: uid('f'), typ: daten.typ, kennzeichen: (daten.kennzeichen || '').trim().toUpperCase(),
      traeger: (daten.traeger || '').trim(), status: daten.status || 'da',
      registriert: daten.registriert || new Date().toISOString()
    };
    fz.wache = daten.status === 'reserve' ? 0 : (daten.wache || fahrzeugWacheWaehlen(zustand, fz));
    zustand.fahrzeuge.push(fz);
    funkrufnameVergeben(zustand, fz);
    return fz;
  }

  /* ---------- Planung ---------- */

  // Fahrzeug wird eingeplant? Reserve, defekt und abgemeldet nie; am SimTag (nurEingecheckte) nur angekommene.
  function fzAktiv(f, e) {
    if (f.status === 'abgemeldet' || f.status === 'defekt' || f.status === 'reserve' || !f.wache) return false;
    return e.nurEingecheckte ? f.status === 'da' : true;
  }

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

  // Ordnet Fahrzeugen je eine Person zu (höchstens eine pro Person). Greedy nach Kosten, Engpässe zuerst,
  // danach Erweiterungspfade, damit möglichst viele Fahrzeuge eine Fahrerin oder einen Fahrer bekommen.
  function zuordnen(fahrzeuge, kandidaten, kosten) {
    const elig = new Map(fahrzeuge.map(f => [f, kandidaten(f).slice().sort((a, b) => kosten(f, a) - kosten(f, b))]));
    const besitzer = new Map(), wahl = new Map();
    const pfad = (f, besucht) => {
      for (const p of elig.get(f)) {
        if (besucht.has(p)) continue; besucht.add(p);
        if (!besitzer.has(p) || pfad(besitzer.get(p), besucht)) { besitzer.set(p, f); wahl.set(f, p); return true; }
      }
      return false;
    };
    fahrzeuge.slice().sort((a, b) => elig.get(a).length - elig.get(b).length).forEach(f => {
      const frei = elig.get(f).find(p => !besitzer.has(p));
      if (frei != null) { besitzer.set(frei, f); wahl.set(f, frei); } else pfad(f, new Set());
    });
    return wahl;
  }

  // Plant einen Durchgang für eine Wache. Liefert {fahrzeuge:[...], pause:[...], hinweise:[...]}
  // Pflicht: Wer fährt, arbeitet bei einem Träger derselben Fahrgruppe wie das Fahrzeug (außer „Fahrer:in vom Träger“).
  function planeWache(zustand, dIndex, wache, station, statistik, zufall) {
    const e = zustand.einstellungen;
    const leute = zustand.personen.filter(p => p.lj === 3 && p.wache === wache && aktiv(p, e));
    const fzAlle = zustand.fahrzeuge.filter(f => f.wache === wache && fzAktiv(f, e));
    const hinweise = [];
    const g = id => (statistik[id] || (statistik[id] = leereStatistik()));
    const person = new Map(leute.map(p => [p.id, p]));
    const los = new Map(leute.map(p => [p.id, zufall()]));
    const brauchtFahrer = f => !f.fahrerExtern;
    const fahrerFuer = f => leute.filter(p => darfFahren(e, p, f)).map(p => p.id);

    // Reihenfolge: RTW/KTW rotieren je Durchgang, damit jedes Fahrzeug mal vorne fährt; NEF an fester Position.
    const boden = fzAlle.filter(f => f.typ !== 'NEF').sort((a, b) => (a.typ === b.typ ? a.nr - b.nr : (a.typ === 'RTW' ? -1 : 1)));
    const nefs = fzAlle.filter(f => f.typ === 'NEF').sort((a, b) => a.nr - b.nr);
    const schritt = Math.max(1, Math.ceil(boden.length / Math.max(1, e.durchgaenge.length)));
    const bodenR = rotiere(boden, dIndex * schritt);
    // Erste Welle: Fahrzeuge vorziehen, für die noch jemand fahren darf, der noch nie vorne war
    // (gerecht verteilt werden Personen, nicht Fahrzeuge)
    const vorne = [], benutzt = new Set();
    const frischerFahrer = f => fahrerFuer(f).find(pid => g(pid).erste === 0 && !benutzt.has(pid));
    for (let k = 0; k < Math.min(e.ersteWelle, bodenR.length); k++) {
      const rest = bodenR.filter(f => !vorne.includes(f));
      const wahl = rest.find(f => !brauchtFahrer(f) || frischerFahrer(f) != null) || rest[0];
      if (brauchtFahrer(wahl)) { const pid = frischerFahrer(wahl); if (pid != null) benutzt.add(pid); }
      vorne.push(wahl);
    }
    const reihe = vorne.concat(bodenR.filter(f => !vorne.includes(f)));
    const nefsR = rotiere(nefs, dIndex);
    nefsR.forEach((n, i) => reihe.splice(Math.min(reihe.length, e.nefPosition - 1 + i * 4), 0, n));

    // Fahrzeuge, für die niemand in der Wache fahren darf, bleiben stehen
    const moeglich = zuordnen(reihe.filter(brauchtFahrer), fahrerFuer, () => 0);
    let fahrzeuge = reihe.filter(f => {
      if (!brauchtFahrer(f) || moeglich.has(f)) return true;
      hinweise.push(f.funkrufname + ' bleibt unbesetzt: niemand in Wache ' + wache + ' darf ein Fahrzeug von ' + (f.traeger || '?') + ' fahren');
      return false;
    });

    // Besatzungsstärke festlegen
    const min = f => e.besatzung[f.typ][0], max = f => e.besatzung[f.typ][1];
    const N = leute.length;
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

    const ergebnis = fahrzeuge.map((f, i) => ({
      fid: f.id, funkrufname: f.funkrufname, typ: f.typ, kennzeichen: f.kennzeichen, traeger: f.traeger,
      reihenfolge: i + 1, minute: alarmMinute(e, i), erste: i < e.ersteWelle, besatzung: [], fahrer: null,
      fahrerExtern: !!f.fahrerExtern, _f: f, _plaetze: groesse[i]
    }));

    // Wer würde ohne Fahrer-Pflicht pausieren? Die mit den meisten Einsätzen bisher (Zufall bei Gleichstand)
    const letzter = dIndex === e.durchgaenge.length - 1;
    const rangfolge = (a, b) => (g(a).einsaetze - g(b).einsaetze) || (Math.min(g(a).erste, 1) - Math.min(g(b).erste, 1)) || (g(b).pause - g(a).pause) || (los.get(a) - los.get(b));
    const rang = leute.map(p => p.id).sort(rangfolge);
    const wuerdePausieren = new Set(rang.slice(plaetze));

    // Kosten einer Person auf einem Platz: erste Welle, NEF und Fahrzeugwechsel gerecht verteilen
    const kosten = (f, pid) => {
      const s = g(pid);
      let k = 0;
      if (f.erste) k += 100 * s.erste;               // erste Welle: wer am seltensten vorne war
      if (f.typ === 'NEF') k += 100 * s.nef;          // NEF: wer am seltensten NEF hatte
      if (!f.erste && s.erste === 0) k += letzter ? 400 : 40; // Leute ohne erste Welle für spätere Durchgänge aufheben
      if (f.typ !== 'NEF' && s.nef === 0) k += 5;    // Leute ohne NEF bevorzugt für NEF aufheben
      k += 15 * (s.fahrzeuge[f.fid] || 0);           // nicht immer dasselbe Fahrzeug
      return k + los.get(pid);
    };

    // 1. Fahrer:innen festlegen (Pflicht aus der Fahrgruppe). Wer sonst pausieren würde, fährt nur, wenn es nicht anders geht.
    const fahrerKosten = (f, pid) => kosten(f, pid) + 8 * g(pid).fahrer + (wuerdePausieren.has(pid) ? 60 : 0);
    const mitFahrer = ergebnis.filter(f => !f.fahrerExtern);
    const fahrerWahl = zuordnen(mitFahrer, f => fahrerFuer(f._f), fahrerKosten);
    const fahrer = new Set();
    mitFahrer.forEach(f => { const pid = fahrerWahl.get(f); if (pid != null) { f.fahrer = pid; f.besatzung.push(pid); fahrer.add(pid); } });

    // 2. Pause: aus den übrigen die mit den meisten Einsätzen
    const uebrige = rang.filter(pid => !fahrer.has(pid));
    const frei = new Set(uebrige.slice(0, Math.max(0, plaetze - fahrer.size)));
    const pause = uebrige.filter(pid => !frei.has(pid));

    // 3. Restliche Plätze nach Seltenheit füllen: erste Welle, dann NEF, dann übrige
    const slots = [];
    ergebnis.forEach(f => { for (let k = f.besatzung.length; k < f._plaetze; k++) slots.push(f); });
    const rangSlot = f => (f.erste ? 0 : f.typ === 'NEF' ? 1 : 2);
    slots.sort((a, b) => rangSlot(a) - rangSlot(b) || a.reihenfolge - b.reihenfolge);
    for (const f of slots) {
      let best = null, bestK = Infinity;
      for (const pid of frei) { const k = kosten(f, pid); if (k < bestK) { bestK = k; best = pid; } }
      if (best == null) break;
      frei.delete(best);
      f.besatzung.push(best);
    }
    frei.forEach(pid => pause.push(pid));

    // Statistik fortschreiben
    ergebnis.forEach(f => {
      delete f._f; delete f._plaetze;
      f.besatzung.forEach(pid => {
        const s = g(pid); s.einsaetze++; if (f.erste) s.erste++; if (f.typ === 'NEF') s.nef++;
        if (f.fahrer === pid) s.fahrer++; s.fahrzeuge[f.fid] = (s.fahrzeuge[f.fid] || 0) + 1;
      });
    });
    pause.forEach(pid => g(pid).pause++);
    if (person.size && !ergebnis.length) hinweise.push('Kein Fahrzeug in Wache ' + wache + ' einsatzbereit');

    return { wache, station, fahrzeuge: ergebnis.filter(f => f.besatzung.length || f.fahrerExtern), pause, hinweise };
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
    wachenAusgleichen(zustand);
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
    const p = zustand.personen.filter(x => x.lj === 3 && aktiv(x, e)).map(x => x.id + ':' + x.wache + ':' + fahrgruppe(e, x.traeger)).sort().join(',');
    const f = zustand.fahrzeuge.filter(x => fzAktiv(x, e)).map(x => x.id + ':' + x.wache + ':' + fahrgruppe(e, x.traeger) + (x.fahrerExtern ? ':x' : '')).sort().join(',');
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
    const fz = zustand.fahrzeuge.filter(f => fzAktiv(f, e));
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



  /* ---------- Fahrzeug-Ankunft am SimTag ---------- */

  const ORTE = { BI: 'Bielefeld', GT: 'Gütersloh', HF: 'Herford', LIP: 'Lippe', DT: 'Lippe', LE: 'Lippe', HX: 'Höxter', WAR: 'Höxter', SO: 'Soest', LP: 'Lippstadt',
    HAM: 'Hamm', MS: 'Münster', D: 'Düsseldorf', PB: 'Paderborn', MI: 'Minden', WAF: 'Warendorf', BE: 'Beckum', UN: 'Unna', DO: 'Dortmund', HSK: 'Hochsauerland', OE: 'Olpe', COE: 'Coesfeld', ST: 'Steinfurt', BOR: 'Borken', RE: 'Recklinghausen' };

  function kzNorm(k) { return String(k || '').toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, ''); }

  // Typische Lesefehler korrigieren: hinten Ziffern, vorne Buchstaben
  function kzKorrigiert(k) {
    const n = kzNorm(k);
    const zuZiffer = { O: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
    const zuBuchst = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 8: 'B', 6: 'G' };
    const m = n.match(/^(.*?)([0-9OIZSBGDLT]{1,4})([EH]?)$/);
    if (!m || !m[1]) return n;
    return m[1].replace(/[0-9]/g, c => zuBuchst[c] || c) + m[2].replace(/[A-Z]/g, c => zuZiffer[c] || c) + m[3];
  }

  function abstand(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  // Sucht in einer Liste den Eintrag zum (evtl. ungenau gelesenen) Kennzeichen. Nur eindeutige Treffer.
  function kzSuchen(liste, kz, kzVon) {
    const kandidaten = [kzNorm(kz), kzKorrigiert(kz)].filter(Boolean);
    if (!kandidaten[0]) return null;
    let best = null, bestD = Infinity, zweiter = Infinity;
    liste.forEach(x => {
      const fk = kzNorm(kzVon(x)); if (!fk) return;
      const dd = Math.min(...kandidaten.map(c => abstand(c, fk)));
      if (dd < bestD) { zweiter = bestD; bestD = dd; best = x; } else if (dd < zweiter) zweiter = dd;
    });
    const erlaubt = kandidaten[0].length >= 6 ? 2 : 1;
    if (!best || bestD > erlaubt || (bestD > 0 && zweiter <= bestD)) return null;
    return { treffer: best, genau: bestD === 0, abstand: bestD };
  }

  // Sucht ein Fahrzeug der Vorplanung zum (evtl. ungenau gelesenen) Kennzeichen
  function fahrzeugZuKennzeichen(zustand, kz) {
    const t = kzSuchen(zustand.fahrzeuge, kz, f => f.kennzeichen);
    return t ? { fahrzeug: t.treffer, genau: t.genau, abstand: t.abstand } : null;
  }

  // Träger-Vorschlag aus dem Ortskürzel
  function traegerVorschlag(zustand, kzText) {
    const roh = String(kzText || '').toUpperCase().trim();
    const teil = roh.split(/[^A-ZÄÖÜ]/)[0];
    const n = kzNorm(roh);
    const praefixe = teil && teil.length <= 3 ? [teil] : [n.slice(0, 3), n.slice(0, 2), n.slice(0, 1)];
    const alle = [...new Set(zustand.fahrzeuge.map(f => f.traeger).filter(Boolean))];
    for (const pr of praefixe) {
      if (!pr) continue;
      const ausPlan = [...new Set(zustand.fahrzeuge.filter(f => kzNorm(f.kennzeichen).startsWith(pr) && String(f.kennzeichen).toUpperCase().split(/[^A-ZÄÖÜ]/)[0] === pr).map(f => f.traeger))];
      if (ausPlan.length) return ausPlan;
      if (ORTE[pr]) { const t = alle.filter(x => x.toLowerCase().includes(ORTE[pr].toLowerCase())); if (t.length) return t; }
    }
    return [];
  }

  // Möglichkeiten für ein Fahrzeug, das nicht in der Vorplanung steht
  function ankunftOptionen(zustand, typ, traeger) {
    const e = zustand.einstellungen;
    const gleich = f => f.typ === typ && norm(f.traeger) === norm(traeger);
    const gemeldet = zustand.fahrzeuge.filter(f => gleich(f) && f.status !== 'reserve');
    const offen = gemeldet.filter(f => f.status === 'gemeldet').sort((a, b) => (!!a.kennzeichen - !!b.kennzeichen) || a.wache - b.wache || a.nr - b.nr);
    const fremdeOffen = zustand.fahrzeuge.filter(f => f.typ === typ && f.status === 'gemeldet' && !gleich(f)).sort((a, b) => a.wache - b.wache || a.nr - b.nr);
    const k = kapazitaet(Object.assign({}, zustand, { einstellungen: Object.assign({}, e, { nurEingecheckte: false }) }));
    const fehlendePlaetze = Math.max(0, k.tn - k.max);
    const probe = { typ, traeger, status: 'da' };
    const wache = fahrzeugWacheWaehlen(zustand, probe);
    const belegt = new Set(zustand.fahrzeuge.filter(f => f.wache === wache && f.typ === typ).map(f => f.nr));
    let nr = 1; while (belegt.has(nr)) nr++;
    return {
      gemeldet: gemeldet.length, da: gemeldet.filter(f => f.status === 'da').length,
      freierPlatz: offen[0] || null, fremdeOffen, fehlendePlaetze,
      zusatz: { wache, funkrufname: wache + '-' + typ + '-' + nr },
      empfehlung: fehlendePlaetze > 0 ? 'zusatz' : 'reserve'
    };
  }

  // Kennzeichen und Träger auch im bestehenden Plan nachtragen
  function imPlanNachtragen(zustand, f) {
    (zustand.plan ? zustand.plan.durchgaenge : []).forEach(d => d.einsaetze.forEach(ei => ei.fahrzeuge.forEach(x => {
      if (x.fid === f.id) { x.kennzeichen = f.kennzeichen; x.traeger = f.traeger; }
    })));
  }

  // Ankunft festhalten. art: treffer | platz | uebernehmen | zusatz | reserve
  function ankunftBestaetigen(zustand, a) {
    const jetzt = new Date().toISOString();
    let f;
    if (a.art === 'treffer' || a.art === 'platz' || a.art === 'uebernehmen') {
      f = zustand.fahrzeuge.find(x => x.id === a.fid);
      if (!f) return null;
      if (a.art === 'uebernehmen' && norm(f.traeger) !== norm(a.traeger)) f.ersetzt = f.traeger;
      if (a.kennzeichen) f.kennzeichen = String(a.kennzeichen).trim().toUpperCase();
      if (a.traeger) f.traeger = a.traeger;
      f.status = 'da'; f.registriert = jetzt;
      imPlanNachtragen(zustand, f);
    } else {
      f = fahrzeugHinzufuegen(zustand, { typ: a.typ, kennzeichen: a.kennzeichen, traeger: a.traeger, status: a.art === 'reserve' ? 'reserve' : 'da', registriert: jetzt });
      f.zusaetzlich = true;
    }
    return f;
  }

  // Reserve-Fahrzeug doch einplanen (bekommt Wache und neuen Funkrufnamen)
  function reserveAktivieren(zustand, fid) {
    const f = zustand.fahrzeuge.find(x => x.id === fid);
    if (!f) return null;
    f.status = 'da'; f.wache = fahrzeugWacheWaehlen(zustand, f); funkrufnameVergeben(zustand, f);
    return f;
  }

  // Vorplanung: Anzahl gemeldeter Fahrzeuge je Träger und Typ festlegen
  function vorplanungSetzen(zustand, traeger, anzahl) {
    const ergebnis = { neu: 0, entfernt: 0 };
    TYPEN.forEach(t => {
      const soll = Math.max(0, Number(anzahl[t]) || 0);
      const vorhanden = zustand.fahrzeuge.filter(f => f.typ === t && norm(f.traeger) === norm(traeger) && f.status !== 'reserve' && !f.zusaetzlich);
      for (let i = vorhanden.length; i < soll; i++) { fahrzeugHinzufuegen(zustand, { typ: t, traeger, status: 'gemeldet', registriert: null }); ergebnis.neu++; }
      const ueber = vorhanden.filter(f => f.status === 'gemeldet').sort((a, b) => (!!a.kennzeichen - !!b.kennzeichen) || b.nr - a.nr);
      let zuviel = vorhanden.length - soll;
      while (zuviel > 0 && ueber.length) {
        const f = ueber.shift();
        zustand.fahrzeuge.splice(zustand.fahrzeuge.indexOf(f), 1); ergebnis.entfernt++; zuviel--;
      }
    });
    return ergebnis;
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
      fahrzeuge: zustand.fahrzeuge.map(f => ({ id: f.id, typ: f.typ, funkrufname: f.funkrufname, kennzeichen: f.kennzeichen, traeger: f.traeger, wache: f.wache, status: f.status })),
      traeger: [...new Set(zustand.fahrzeuge.filter(f => f.status !== 'abgemeldet').map(f => f.traeger).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de')),
      klassen: [...new Set(zustand.personen.map(p => p.klasse).filter(Boolean))].sort()
    };
  }

  function findeCode(zustand, code) {
    code = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return code.length >= 4 ? zustand.personen.find(p => p.code === code) || null : null;
  }
  function findePerson(zustand, id) { return id ? zustand.personen.find(p => p.id === id) || null : null; }

  // Suche ohne Groß/Klein, Umlaute und Akzente; jedes eingegebene Wort muss ein Namensteil beginnen
  function suchNorm(s) {
    return String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function namenSuchen(zustand, q, max) {
    const teile = suchNorm(q).split(' ').filter(Boolean);
    if (teile.join('').length < 2) return [];
    const varianten = t => [t, t.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')];
    return zustand.personen
      .map(p => ({ p, w: suchNorm(p.name).split(' ') }))
      .filter(x => teile.every(t => x.w.some(w => varianten(w).some(v => v.startsWith(t)))))
      .sort((a, b) => a.p.name.localeCompare(b.p.name, 'de'))
      .slice(0, max || 8)
      .map(x => ({ id: x.p.id, name: x.p.name, klasse: x.p.klasse, lj: x.p.lj }));
  }

  // Persönliche Sicht (über Code oder ausgewählten Namen)
  function planFuerPerson(zustand, p) {
    if (!p) return null;
    const pp = persoenlicherPlan(zustand, p.id);
    return { id: p.id, name: p.name, klasse: p.klasse, lj: p.lj, wache: p.wache, gruppe: p.gruppe, eingecheckt: p.eingecheckt, status: p.status, zeilen: pp.zeilen };
  }
  function meinPlan(zustand, code) { return planFuerPerson(zustand, findeCode(zustand, code)); }
  function meinPlanId(zustand, id) { return planFuerPerson(zustand, findePerson(zustand, id)); }

  function personEinchecken(p, jetzt) {
    if (!p) return null;
    const neu = !p.eingecheckt;
    if (neu) p.eingecheckt = jetzt || new Date().toISOString();
    if (p.status === 'abgemeldet' || p.status === 'krank') p.status = 'angemeldet';
    return { id: p.id, name: p.name, lj: p.lj, eingecheckt: p.eingecheckt, neu };
  }
  function einchecken(zustand, code, jetzt) { return personEinchecken(findeCode(zustand, code), jetzt); }
  function eincheckenId(zustand, id, jetzt) { return personEinchecken(findePerson(zustand, id), jetzt); }

  /* ---------- Selbstanmeldung der Fahrzeuge in der Warteschlange ---------- */
  // Ablauf am Tag: QR in der Warteschlange → Besatzung meldet Fahrzeug und Leute an → Bestätigung auf dem Handy →
  // Fastlane: Kennzeichen scannen, alles grün → durchfahren. Sonst rote Spur: nachmelden, Orga klärt.

  const ANM_STATUS = ['offen', 'durch', 'storniert'];

  function anmeldungen(zustand) { return zustand.anmeldungen || (zustand.anmeldungen = []); }
  function findeAnmeldung(zustand, id) { return anmeldungen(zustand).find(a => a.id === id) || null; }

  function anmeldungSpeichern(zustand, d, jetzt, neuesToken) {
    jetzt = jetzt || new Date().toISOString();
    const liste = anmeldungen(zustand);
    let a = d.id ? findeAnmeldung(zustand, d.id) : null;
    if (d.id && (!a || a.token !== d.token || a.status === 'storniert')) return { fehler: 'Diese Anmeldung gibt es nicht mehr. Bitte neu anmelden.' };
    const gesehen = new Set();
    const personen = (Array.isArray(d.personen) ? d.personen : []).slice(0, 6).map(x => {
      const p = x && x.id ? findePerson(zustand, String(x.id)) : null;
      if (p) { if (gesehen.has(p.id)) return null; gesehen.add(p.id); return { pid: p.id }; }
      const frei = String((x && x.name) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      return frei ? { frei } : null;
    }).filter(Boolean);
    const neu = !a;
    if (!a) {
      a = { id: uid('a'), nr: liste.reduce((m, x) => Math.max(m, x.nr || 0), 0) + 1, token: neuesToken || zufallsText(16), erstellt: jetzt, status: 'offen', fid: null };
      liste.push(a);
    }
    const vorher = { typ: a.typ, kennzeichen: a.kennzeichen, traeger: a.traeger };
    a.typ = TYPEN.includes(d.typ) ? d.typ : 'RTW';
    a.kennzeichen = String(d.kennzeichen || '').toUpperCase().replace(/[^A-Z0-9ÄÖÜ\- ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
    a.traeger = String(d.traeger || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    a.personen = personen; a.geaendert = jetzt;
    if (neu || vorher.typ !== a.typ || kzNorm(vorher.kennzeichen) !== kzNorm(a.kennzeichen) || norm(vorher.traeger) !== norm(a.traeger)) fahrzeugVerknuepfen(zustand, a);
    // schon durchgefahren und Leute nachgemeldet: gleich einchecken
    if (a.status === 'durch') a.personen.forEach(x => personEinchecken(findePerson(zustand, x.pid), jetzt));
    return { anmeldung: a, neu };
  }

  // Fahrzeug zur Anmeldung finden: genaues Kennzeichen aus der Vorplanung, sonst freier Platz des Trägers (gleicher Typ)
  function fahrzeugVerknuepfen(zustand, a) {
    if (a.fest) return;
    const alt = a.fid ? zustand.fahrzeuge.find(f => f.id === a.fid) : null;
    if (alt) {
      if (a.kzGesetzt && alt.status !== 'da') { alt.kennzeichen = ''; imPlanNachtragen(zustand, alt); }
      if (alt.anmeldung === a.id) delete alt.anmeldung;
    }
    a.fid = null; a.kzGesetzt = false;
    const frei = f => !f.anmeldung || f.anmeldung === a.id || !findeAnmeldung(zustand, f.anmeldung) || findeAnmeldung(zustand, f.anmeldung).status === 'storniert';
    let f = null;
    const k = kzNorm(a.kennzeichen);
    if (k) f = zustand.fahrzeuge.find(x => kzNorm(x.kennzeichen) === k && frei(x) && x.status !== 'abgemeldet') || null;
    if (!f && a.traeger) {
      f = zustand.fahrzeuge.filter(x => x.typ === a.typ && norm(x.traeger) === norm(a.traeger) && x.status === 'gemeldet' && !kzNorm(x.kennzeichen) && frei(x))
        .sort((x, y) => x.wache - y.wache || x.nr - y.nr)[0] || null;
      if (f && k) { f.kennzeichen = a.kennzeichen; a.kzGesetzt = true; imPlanNachtragen(zustand, f); }
    }
    if (f) { f.anmeldung = a.id; a.fid = f.id; }
  }

  // Orga ordnet ein Fahrzeug fest zu (rote Spur)
  function anmeldungFahrzeugSetzen(zustand, aid, fid) {
    const a = findeAnmeldung(zustand, aid), f = zustand.fahrzeuge.find(x => x.id === fid);
    if (!a || !f) return null;
    const alt = a.fid && zustand.fahrzeuge.find(x => x.id === a.fid);
    if (alt && alt !== f && alt.anmeldung === a.id) delete alt.anmeldung;
    a.fid = f.id; a.fest = true; a.kzGesetzt = false; f.anmeldung = a.id;
    if (a.kennzeichen && !kzNorm(f.kennzeichen)) { f.kennzeichen = a.kennzeichen; imPlanNachtragen(zustand, f); }
    if (!a.kennzeichen && f.kennzeichen) a.kennzeichen = f.kennzeichen;
    return f;
  }

  function anmeldungPruefen(zustand, a) {
    const e = zustand.einstellungen;
    const f = a.fid ? zustand.fahrzeuge.find(x => x.id === a.fid) || null : null;
    const andere = anmeldungen(zustand).filter(x => x.id !== a.id && x.status !== 'storniert');
    const gruende = [], hinweise = [];
    const personen = a.personen.map(x => {
      const p = findePerson(zustand, x.pid);
      const doppelt = p ? andere.find(o => o.personen.some(y => y.pid === p.id)) : null;
      return { pid: p ? p.id : null, name: p ? p.name : x.frei, klasse: p ? p.klasse : '', lj: p ? p.lj : null, traeger: p ? p.traeger : '',
        gefunden: !!p, darfFahren: !!(p && f && darfFahren(e, p, f)), doppeltNr: doppelt ? doppelt.nr : null };
    });
    if (!f) gruende.push(a.kennzeichen ? 'Kennzeichen ' + a.kennzeichen + ' steht nicht in der Vorplanung' + (a.traeger ? ' und für ' + a.traeger + ' ist kein ' + a.typ + '-Platz mehr frei' : '') : 'Fahrzeug nicht zugeordnet (Kennzeichen fehlt)');
    else if (f.status === 'defekt' || f.status === 'abgemeldet') gruende.push('Fahrzeug ist als ' + f.status + ' eingetragen');
    if (!personen.length) gruende.push('Keine Besatzung eingetragen');
    personen.filter(p => !p.gefunden).forEach(p => gruende.push('„' + p.name + '“ steht nicht in der Schülerliste'));
    personen.filter(p => p.doppeltNr).forEach(p => gruende.push(p.name + ' ist schon bei Anmeldung Nr. ' + p.doppeltNr + ' eingetragen'));
    if (f && !f.fahrerExtern && norm(f.traeger) && personen.some(p => p.gefunden) && !personen.some(p => p.darfFahren)) gruende.push('Niemand an Bord darf ein Fahrzeug von ' + f.traeger + ' fahren');
    if (kzNorm(a.kennzeichen) && andere.some(o => kzNorm(o.kennzeichen) === kzNorm(a.kennzeichen))) gruende.push('Kennzeichen ist schon in einer anderen Anmeldung');
    personen.filter(p => p.gefunden && p.lj !== 3).forEach(p => hinweise.push(p.name + ' ist im ' + p.lj + '. Ausbildungsjahr'));
    if (f && a.traeger && norm(f.traeger) !== norm(a.traeger)) hinweise.push('Fahrzeug ist für ' + f.traeger + ' vorgeplant');
    if (f && f.status === 'reserve') hinweise.push('Fahrzeug ist als Reserve vorgesehen');
    return { gruen: !gruende.length, gruende, hinweise, fahrzeug: f, personen };
  }

  // Was die Besatzung auf dem Handy sieht (nur die eigene Anmeldung)
  function bestaetigung(zustand, a) {
    if (!a) return null;
    const pr = anmeldungPruefen(zustand, a), f = pr.fahrzeug;
    return {
      id: a.id, nr: a.nr, typ: a.typ, kennzeichen: a.kennzeichen, traeger: a.traeger, status: a.status,
      erstellt: a.erstellt, geaendert: a.geaendert, durch: a.durch || null,
      gruen: pr.gruen, gruende: pr.gruende, hinweise: pr.hinweise,
      kennung: f ? f.funkrufname : null, wache: f ? f.wache : null, fzStatus: f ? f.status : null, fzTraeger: f ? f.traeger : null,
      personen: pr.personen.map(p => ({ id: p.pid, name: p.name, klasse: p.klasse, gefunden: p.gefunden, darfFahren: p.darfFahren, doppelt: !!p.doppeltNr }))
    };
  }
  function bestaetigungLaden(zustand, id, token) {
    const a = findeAnmeldung(zustand, id);
    return a && a.token === token && a.status !== 'storniert' ? bestaetigung(zustand, a) : null;
  }

  // Fastlane: Anmeldung über das Kennzeichen (auch ungenau gelesen) oder die Anmelde-Nummer finden.
  // Ungenaue Treffer zählen nur, wenn das Kennzeichen unter ALLEN bekannten Kennzeichen (Vorplanung und Anmeldungen)
  // eindeutig ist. So wird ein Fahrzeug ohne Anmeldung nie einer ähnlichen fremden Anmeldung zugeordnet.
  function einfahrtSuchen(zustand, text) {
    const liste = anmeldungen(zustand).filter(a => a.status !== 'storniert');
    const nr = String(text || '').trim().match(/^(?:nr\.?|a|#)?\s*(\d{1,4})$/i);
    if (nr) { const a = liste.find(x => x.nr === Number(nr[1])); return a ? { anmeldung: a, fahrzeug: a.fid ? zustand.fahrzeuge.find(f => f.id === a.fid) || null : null, genau: true } : null; }
    const proKz = new Map();
    liste.forEach(a => {
      const f = a.fid ? zustand.fahrzeuge.find(x => x.id === a.fid) || null : null;
      [a.kennzeichen, f && f.kennzeichen].forEach(k => { const n = kzNorm(k); if (n) proKz.set(n, { kz: n, anmeldung: a, fahrzeug: f }); });
    });
    zustand.fahrzeuge.forEach(f => {
      const n = kzNorm(f.kennzeichen); if (!n || proKz.has(n)) return;
      const a = f.anmeldung ? liste.find(x => x.id === f.anmeldung) || null : null;
      proKz.set(n, { kz: n, anmeldung: a, fahrzeug: f });
    });
    const t = kzSuchen([...proKz.values()], text, x => x.kz);
    return t ? { anmeldung: t.treffer.anmeldung, fahrzeug: t.treffer.fahrzeug, genau: t.genau } : null;
  }
  function anmeldungFinden(zustand, text) { const t = einfahrtSuchen(zustand, text); return t ? t.anmeldung : null; }

  // Durchfahren: Fahrzeug ist da, Besatzung eingecheckt. Vorheriger Stand wird für „Rückgängig“ gemerkt.
  function anmeldungDurch(zustand, aid, jetzt) {
    jetzt = jetzt || new Date().toISOString();
    const a = findeAnmeldung(zustand, aid); if (!a) return null;
    const f = a.fid ? zustand.fahrzeuge.find(x => x.id === a.fid) : null;
    a.vorher = { fz: f ? { status: f.status, registriert: f.registriert } : null, leute: {} };
    if (f) { if (f.status !== 'reserve') f.status = 'da'; f.registriert = jetzt; }
    a.personen.forEach(x => { const p = findePerson(zustand, x.pid); if (p) { a.vorher.leute[p.id] = { eingecheckt: p.eingecheckt, status: p.status }; personEinchecken(p, jetzt); } });
    a.status = 'durch'; a.durch = jetzt;
    return a;
  }
  function anmeldungZurueck(zustand, aid) {
    const a = findeAnmeldung(zustand, aid); if (!a || a.status !== 'durch') return null;
    const f = a.fid ? zustand.fahrzeuge.find(x => x.id === a.fid) : null;
    const v = a.vorher || { fz: null, leute: {} };
    if (f && v.fz) { f.status = v.fz.status; f.registriert = v.fz.registriert; }
    Object.keys(v.leute).forEach(pid => { const p = findePerson(zustand, pid); if (p) { p.eingecheckt = v.leute[pid].eingecheckt; p.status = v.leute[pid].status; } });
    a.status = 'offen'; a.durch = null; delete a.vorher;
    return a;
  }

  // Rote Spur: unbekannte Person als Teilnehmende aufnehmen
  function anmeldungPersonAufnehmen(zustand, aid, index, daten) {
    const a = findeAnmeldung(zustand, aid); if (!a || !a.personen[index] || a.personen[index].pid) return null;
    const codes = new Set(zustand.personen.map(p => p.code));
    const f = a.fid && zustand.fahrzeuge.find(x => x.id === a.fid);
    const lj = [1, 2, 3].includes(Number(daten && daten.lj)) ? Number(daten.lj) : 3;
    const p = { id: uid('p'), name: a.personen[index].frei, klasse: String((daten && daten.klasse) || '').trim(), lj,
      traeger: String((daten && daten.traeger) || (f && f.traeger) || a.traeger || '').trim(), code: neuerCode(codes), eingecheckt: null, status: 'angemeldet', nachgemeldet: true };
    zustand.personen.push(p);
    a.personen[index] = { pid: p.id };
    if (lj === 3) wachenVerteilen(zustand, true); else gruppenVerteilen(zustand, lj);
    if (a.status === 'durch') personEinchecken(p);
    return p;
  }
  function anmeldungPersonEntfernen(zustand, aid, index) {
    const a = findeAnmeldung(zustand, aid); if (!a || !a.personen[index]) return null;
    return a.personen.splice(index, 1)[0];
  }
  function anmeldungStornieren(zustand, aid) {
    const a = findeAnmeldung(zustand, aid); if (!a) return null;
    if (a.status === 'durch') anmeldungZurueck(zustand, aid);
    const f = a.fid && zustand.fahrzeuge.find(x => x.id === a.fid);
    if (f) { if (a.kzGesetzt && f.status !== 'da') { f.kennzeichen = ''; imPlanNachtragen(zustand, f); } if (f.anmeldung === a.id) delete f.anmeldung; }
    a.status = 'storniert'; a.fid = null;
    return a;
  }

  const api = {
    TYPEN, STANDARD_FAHRGRUPPEN, ANM_STATUS, rng, neuerCode, uid, zufallsText, zeitZuMin, minZuZeit, standardEinstellungen, leererZustand,
    fahrgruppe, fahrgruppeName, darfFahren, fahrgruppenAusText, fahrgruppenAlsText, fahrerBedarf, fahrerUebersicht,
    wachenVerteilen, wachenAusgleichen, gruppenVerteilen, fahrzeugHinzufuegen, fahrzeugWacheWaehlen, funkrufnameVergeben,
    planen, planVeraltet, fingerabdruck, aktuellerDurchgang, gerechtigkeit, kapazitaet, persoenlicherPlan,
    statistikAus, stationFuer, aktiv, fzAktiv, norm, oeffentlich, kzNorm, kzKorrigiert, abstand, kzSuchen, fahrzeugZuKennzeichen, traegerVorschlag,
    ankunftOptionen, ankunftBestaetigen, reserveAktivieren, vorplanungSetzen, imPlanNachtragen,
    findeCode, findePerson, suchNorm, namenSuchen, meinPlan, meinPlanId, einchecken, eincheckenId,
    findeAnmeldung, anmeldungSpeichern, anmeldungPruefen, bestaetigung, bestaetigungLaden, einfahrtSuchen, anmeldungFinden, anmeldungDurch, anmeldungZurueck,
    fahrzeugVerknuepfen, anmeldungFahrzeugSetzen, anmeldungPersonAufnehmen, anmeldungPersonEntfernen, anmeldungStornieren
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SimCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
