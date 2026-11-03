/* SimTag Dienstplan – Oberfläche */
(function () {
  'use strict';
  const C = window.SimCore;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* egal */ } }
  };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* egal */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* egal */ } }
  };

  /* ================= Datenhaltung ================= */
  // Zwei Betriebsarten mit gleicher Schnittstelle:
  //  server – eigener Node-Server (api/…), Namen verlassen den Server nur mit Orga-Schlüssel oder eigenem Code
  //  demo   – alles im Browser (erfundene Beispieldaten)
  const DEMO_KEY = 'simtag2027-demo-v2';
  const DEMO_PASSWORT = 'simtag2027';
  const Store = {
    modus: 'demo', schluessel: null, hoerer: [], demoZ: null, zugang: ls.get('simtag-zugang') || '',
    async init() {
      if (/^https?:$/.test(location.protocol) && !window.SIMTAG_DEMO) {
        try {
          const r = await fetch('api/info', { cache: 'no-store' });
          if (r.ok) { const j = await r.json(); if (j && j.simtag) { this.modus = 'server'; } }
        } catch (e) { /* kein Server: Demo */ }
      }
      if (this.modus === 'server') {
        this.schluessel = ss.get('simtag-orga');
        try {
          const ev = new EventSource('api/events');
          ev.onmessage = () => this.melden();
        } catch (e) { setInterval(() => this.melden(), 15000); }
      } else {
        this.ladeDemo();
        this.schluessel = ss.get('simtag-orga-demo');
        window.addEventListener('storage', e => { if (e.key === DEMO_KEY) { this.ladeDemo(); this.melden(); } });
      }
    },
    ladeDemo() {
      const roh = ls.get(DEMO_KEY);
      try { this.demoZ = roh ? JSON.parse(roh) : null; } catch (e) { this.demoZ = null; }
      if (!this.demoZ || !this.demoZ.einstellungen) { this.demoZ = window.demoZustand(C); this.speichereDemo(); }
    },
    speichereDemo() { ls.set(DEMO_KEY, JSON.stringify(this.demoZ)); },
    demoZuruecksetzen() { this.demoZ = window.demoZustand(C); this.speichereDemo(); this.melden(); },
    melden() { this.hoerer.forEach(f => f()); },
    abonnieren(f) { this.hoerer.push(f); },
    get orga() { return !!this.schluessel; },

    async api(pfad, opt) {
      opt = opt || {};
      const kopf = { 'Content-Type': 'application/json' };
      if (this.schluessel) kopf['X-Orga-Key'] = this.schluessel;
      const r = await fetch('api/' + pfad, { method: opt.method || 'GET', headers: kopf, body: opt.body ? JSON.stringify(opt.body) : undefined, cache: 'no-store' });
      let j = null; try { j = await r.json(); } catch (e) { /* leer */ }
      if (!r.ok) { const err = new Error((j && j.fehler) || ('Fehler ' + r.status)); err.status = r.status; throw err; }
      return j;
    },
    async oeffentlich() { return this.modus === 'server' ? this.api('public') : C.oeffentlich(this.demoZ); },
    async mein(code) { return this.modus === 'server' ? this.api('me?code=' + encodeURIComponent(code)) : C.meinPlan(this.demoZ, code); },
    async meinId(id) { return this.modus === 'server' ? this.api('me?id=' + encodeURIComponent(id) + '&z=' + encodeURIComponent(this.zugang)) : C.meinPlanId(this.demoZ, id); },
    async namen(q) { return this.modus === 'server' ? this.api('namen?q=' + encodeURIComponent(q) + '&z=' + encodeURIComponent(this.zugang)) : C.namenSuchen(this.demoZ, q, 8); },
    demoGeaendert() { this.demoZ.version++; this.speichereDemo(); this.melden(); },
    async einchecken(code) {
      if (this.modus === 'server') return this.api('checkin', { method: 'POST', body: { code } });
      const r = C.einchecken(this.demoZ, code); if (r && r.neu) this.demoGeaendert(); return r;
    },
    async eincheckenId(id) {
      if (this.modus === 'server') return this.api('checkin', { method: 'POST', body: { id, z: this.zugang } });
      const r = C.eincheckenId(this.demoZ, id); if (r && r.neu) this.demoGeaendert(); return r;
    },
    async anmeldungSenden(d) {
      if (this.modus === 'server') return this.api('anmeldung', { method: 'POST', body: Object.assign({}, d, { z: this.zugang }) });
      const r = C.anmeldungSpeichern(this.demoZ, d);
      if (r.fehler) throw new Error(r.fehler);
      this.demoGeaendert();
      return { id: r.anmeldung.id, token: r.anmeldung.token, bestaetigung: C.bestaetigung(this.demoZ, r.anmeldung) };
    },
    async anmeldungLaden(id, token) {
      if (this.modus === 'server') return this.api('anmeldung?id=' + encodeURIComponent(id) + '&token=' + encodeURIComponent(token));
      const b = C.bestaetigungLaden(this.demoZ, id, token); if (!b) { const e = new Error('Anmeldung nicht gefunden'); e.status = 404; throw e; } return b;
    },
    async anmelden(pw) {
      if (this.modus === 'server') { await this.api('login', { method: 'POST', body: { passwort: pw } }).catch(e => { throw e; }); this.schluessel = pw; ss.set('simtag-orga', pw); return true; }
      if (pw !== DEMO_PASSWORT) throw new Error('Passwort stimmt nicht.');
      this.schluessel = pw; ss.set('simtag-orga-demo', pw); return true;
    },
    abmelden() { this.schluessel = null; ss.del('simtag-orga'); ss.del('simtag-orga-demo'); },
    async voll() { return this.modus === 'server' ? this.api('state') : JSON.parse(JSON.stringify(this.demoZ)); },
    // Änderung als Funktion: wird bei gleichzeitigen Änderungen (z. B. Check-ins) auf dem neuesten Stand wiederholt
    async aendern(fn) {
      for (let versuch = 0; versuch < 4; versuch++) {
        const z = await this.voll();
        const basis = z.version;
        const ergebnis = fn(z);
        z.version = basis + 1;
        if (this.modus !== 'server') { this.demoZ = z; this.speichereDemo(); this.melden(); return ergebnis; }
        try { await this.api('state', { method: 'POST', body: { basis, zustand: z } }); this.melden(); return ergebnis; }
        catch (e) { if (e.status !== 409) throw e; }
      }
      throw new Error('Die Daten wurden gerade von jemand anderem geändert. Bitte noch einmal versuchen.');
    }
  };

  /* ================= Zustand der Oberfläche ================= */
  const ui = {
    route: 'plan', ich: ls.get('simtag-ich') || '', station: 'S1', orgaTab: 'lage', planD: 0,
    filterLj: 3, suche: '', simZeit: null, ziehen: null, fzTyp: 'RTW', meldung: null,
    ns: {}, checkinWahl: null, einTab: 'fastlane', einOffen: null, aufnahme: {}, rotSichtbar: new Set()
  };
  let pub = null, voll = null, mein = null, anmBest = null;
  const lsJson = k => { try { return JSON.parse(ls.get(k) || 'null'); } catch (e) { return null; } };
  let meineAnm = lsJson('simtag-anmeldung');

  function jetztMin() {
    if (ui.simZeit != null) return ui.simZeit;
    const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  }
  function toast(t) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = t; el.setAttribute('role', 'status');
    document.body.appendChild(el); setTimeout(() => el.remove(), 3200);
  }
  function datei(name, inhalt, typ) {
    try {
      const url = URL.createObjectURL(new Blob([inhalt], { type: typ || 'text/plain' }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    } catch (e) { toast('Download ist hier nicht möglich.'); }
  }
  const WACHE_FARBEN = ['#c62828', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#ef6c00', '#00838f', '#5d4037'];
  const WACHE_NAMEN = ['Rot', 'Blau', 'Grün', 'Gelb', 'Violett', 'Orange', 'Türkis', 'Braun'];
  const wfarbe = w => w ? WACHE_FARBEN[(w - 1) % WACHE_FARBEN.length] : '#6b7785';
  const wtext = w => (w === 4 ? '#1a1a1a' : '#ffffff');
  const frnChip = (name, w) => '<span class="frn"><i class="wpunkt" style="background:' + wfarbe(w) + '"></i>' + esc(name) + '</span>';
  const kz = k => k ? '<span class="kz"><b>' + esc(k) + '</b></span>' : '<span class="leise">ohne Kennzeichen</span>';
  const typ = t => '<span class="typ ' + esc(t) + '">' + esc(t) + '</span>';
  const station = (e, id) => e.stationen.find(s => s.id === id) || { id, name: id, kurz: id };
  const ljName = { 3: '3. Ausbildungsjahr', 2: '2. Ausbildungsjahr', 1: '1. Ausbildungsjahr' };
  const ljRolle = { 3: 'Besatzung RTW/KTW/NEF', 2: 'Verletztendarstellung', 1: 'Reserve und Beobachtung' };
  const gruppeBuchst = g => String.fromCharCode(64 + (g || 0));
  const datumLang = d => { try { return new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return d; } };

  /* ================= Rahmen ================= */
  const ROUTEN = [['plan', 'Mein Plan'], ['lage', 'Lagekarte'], ['stationen', 'Stationen'], ['checkin', 'Check-in'], ['anmeldung', 'RTW-Anmeldung'], ['ankunft', 'Einfahrt', true], ['zettel', 'Zettel', true], ['orga', 'Orga']];
  function rahmen(inhalt) {
    const e = pub.einstellungen;
    const demo = Store.modus === 'demo' || pub.demo;
    const zeit = ui.simZeit != null ? ui.simZeit : 622;
    return '<header class="kopf"><div class="kopf-innen"><div class="marke"><i></i><b>' + esc(e.titel) + '</b><span>' + esc(datumLang(e.datum)) + ' · ' + esc(e.ort) + '</span></div><nav aria-label="Bereiche">' +
      ROUTEN.filter(r => !r[2] || Store.orga).map(([id, t]) => '<a href="#' + id + '"' + (ui.route === id ? ' aria-current="page"' : '') + '>' + t + '</a>').join('') + '</nav></div></header>' +
      (demo ? '<div class="demo-band"><div><span>Demo mit erfundenen Daten. Nichts davon sind echte Personen.</span>' +
        '<label for="simzeit">Simulierte Uhrzeit <input id="simzeit" type="range" min="420" max="1080" step="1" value="' + Math.round(zeit) + '"> <b class="mono" id="simzeit-text">' + C.minZuZeit(zeit) + '</b></label></div></div>' : '') +
      '<main id="inhalt">' + inhalt + '</main>';
  }

  /* ================= Mein Plan ================= */
  // Namenssuche: Name tippen, aus der Liste auswählen (nur mit Zugangsschlüssel aus QR-Code/Link)
  const nsZustand = ctx => ui.ns[ctx] || (ui.ns[ctx] = { q: '', treffer: [], geladen: false, fehler: '', nr: 0 });
  function namenSuche(ctx, label, platzhalter, wahlText) {
    const st = nsZustand(ctx);
    let h = '<label class="feld" for="ns-' + ctx + '"><span>' + label + '</span><input id="ns-' + ctx + '" data-ns="' + ctx + '" type="search" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="search" value="' + esc(st.q) + '" placeholder="' + esc(platzhalter) + '"></label>';
    if (C.suchNorm(st.q).replace(/ /g, '').length < 2) return h;
    if (st.fehler) return h + '<div class="hinweis rot">' + esc(st.fehler) + '</div>';
    if (st.treffer.length) {
      h += '<div class="namen-treffer">' + st.treffer.map(t => '<button type="button" class="namen-wahl" data-act="ns-wahl" data-ctx="' + ctx + '" data-id="' + esc(t.id) + '" data-name="' + esc(t.name) + '" data-klasse="' + esc(t.klasse) + '" data-lj="' + t.lj + '">' +
        '<b>' + esc(t.name) + '</b><span>Klasse ' + esc(t.klasse || '–') + ' · ' + t.lj + '. LJ</span>' + (wahlText ? '<em>' + wahlText + '</em>' : '') + '</button>').join('') + '</div>';
    } else if (st.geladen) h += '<p class="leise">Kein passender Name. Prüfe die Schreibweise oder tippe nur den Nachnamen.</p>';
    return h;
  }
  function nsZuruecksetzen(ctx) { ui.ns[ctx] = { q: '', treffer: [], geladen: false, fehler: '', nr: 0 }; }
  async function nsSuchen(ctx) {
    const st = nsZustand(ctx), nr = ++st.nr;
    if (C.suchNorm(st.q).replace(/ /g, '').length < 2) { st.treffer = []; st.geladen = false; st.fehler = ''; return render(); }
    try { const t = await Store.namen(st.q); if (nr !== st.nr) return; st.treffer = t || []; st.fehler = ''; }
    catch (e) { if (nr !== st.nr) return; st.treffer = []; st.fehler = e.status === 403 ? 'Die Namenssuche funktioniert nur über den Link aus dem QR-Code am Eingang oder aus der Einladung. Bitte den QR-Code noch einmal scannen.' : (e.message || 'Suche nicht möglich'); }
    st.geladen = true; render();
  }
  const ohneZugang = () => Store.modus === 'server' && !Store.zugang && !Store.orga;
  const zugangHinweis = () => ohneZugang() ? '<div class="hinweis">Öffne diese Seite über den QR-Code am Eingang oder den Link aus der Einladung. Erst dann findest du deinen Namen.</div>' : '';

  /* ================= Mein Plan ================= */
  function viewPlan() {
    const e = pub.einstellungen;
    let h = '<div class="seitenkopf"><div><div class="eyebrow">Persönlicher Ablauf</div><h1>Mein Plan</h1></div>' +
      (mein ? '<button class="knopf klein" data-act="ich-weg">Andere Person wählen</button>' : '<p>Tippe deinen Namen ein und wähle dich aus der Liste aus.</p>') + '</div>';
    if (mein) return h + meinAblauf(e, mein);
    if (ui.ich && mein === false) h += '<div class="hinweis rot">Dein Eintrag wurde nicht gefunden. Bitte wähle deinen Namen noch einmal aus.</div>';
    h += '<form class="flaeche" id="plan-suche" style="max-width:560px" autocomplete="off">' + namenSuche('plan', 'Dein Name', 'Vor- oder Nachname', 'Mein Plan') + zugangHinweis();
    if (Store.modus === 'demo') {
      const z = Store.demoZ, bsp = [3, 2, 1].map(l => z.personen.find(p => p.lj === l && p.status !== 'krank'));
      h += '<div class="zeile leise">Zum Ausprobieren: ' + bsp.map(p => '<button class="knopf klein" type="button" data-act="ns-wahl" data-ctx="plan" data-id="' + p.id + '">' + esc(p.name) + ' · ' + p.lj + '. LJ</button>').join('') + '</div>';
    }
    return h + '</form>';
  }

  function meinAblauf(e, m) {
    const jetzt = jetztMin();
    let h = '<section class="flaeche"><div class="zeile" style="justify-content:space-between"><div><h2>' + esc(m.name) + '</h2><p class="leise">Klasse ' + esc(m.klasse) + ' · ' + ljName[m.lj] + ' · ' + ljRolle[m.lj] +
      (m.lj === 3 ? ' · Wache ' + m.wache : ' · Gruppe ' + gruppeBuchst(m.gruppe)) + '</p></div>' +
      (m.eingecheckt ? '<span class="pille gut">Eingecheckt ' + new Date(m.eingecheckt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + '</span>'
        : '<button class="knopf haupt" data-act="selbst-checkin">Ich bin da</button>') + '</div>';
    if (m.status === 'krank') h += '<div class="hinweis rot">Du bist als krank gemeldet und nicht eingeplant. Melde dich am Eingang, falls du doch da bist.</div>';
    h += '<p class="leise">Der Plan kann sich am Tag ändern, wenn Fahrzeuge oder Leute fehlen. Schau vor jedem Durchgang noch einmal hier rein.</p></section>';
    h += '<div class="ablauf">';
    m.zeilen.forEach(z => {
      const lauf = jetzt >= C.zeitZuMin(z.von) && jetzt < C.zeitZuMin(z.bis);
      const st = z.station || {};
      let kl = 'block', innen = '';
      if (z.art === 'einsatz') {
        if (z.erste) kl += ' erste';
        innen = '<div class="zeile"><h3>' + esc(st.name) + '</h3>' + (z.erste ? '<span class="pille akzent">Erste Welle</span>' : '') + (lauf ? '<span class="pille gut">läuft</span>' : '') + '</div>' +
          '<div class="zeile">' + typ(z.typ) + frnChip(z.funkrufname, z.wache) + kz(z.kennzeichen) + '<span class="leise">' + esc(z.traeger) + '</span></div>' +
          '<div class="alarm">Alarm ca. <b>' + esc(z.alarm) + '</b> <span class="leise">· Fahrzeug ' + z.reihenfolge + ' in der Alarmfolge</span></div>' +
          '<div><b>' + esc(z.rolle) + '</b>' + (z.team.length ? ' mit ' + z.team.map(esc).join(', ') : ' (allein)') + '</div>';
      } else if (z.art === 'pause') {
        kl += ' pause';
        innen = '<div class="zeile"><h3>Ohne Fahrzeug</h3>' + (lauf ? '<span class="pille gut">läuft</span>' : '') + '</div><div>Du begleitest deine Wache als Beobachter:in an der Station <b>' + esc(st.name) + '</b>. In den anderen Durchgängen fährst du dafür öfter.</div>';
      } else if (z.art === 'mime') {
        innen = '<div class="zeile"><h3>' + esc(st.name) + '</h3><span class="pille">Verletztendarstellung</span>' + (lauf ? '<span class="pille gut">läuft</span>' : '') + '</div>' +
          '<div class="zeile"><span>Schminken <b class="mono">' + esc(z.schminken) + '</b></span><span>Treffen am Einsatzort <b class="mono">' + esc(z.treffen) + '</b></span></div>';
      } else if (z.art === 'zuschauen') {
        innen = '<div class="zeile"><h3>' + esc(st.name) + '</h3><span class="pille">Beobachtung, Reserve</span>' + (lauf ? '<span class="pille gut">läuft</span>' : '') + '</div>' +
          '<div>Treffen an der Station <b class="mono">' + esc(z.treffen) + '</b>. Bleib erreichbar, falls du als Reserve gebraucht wirst.</div>';
      } else {
        innen = '<div><h3>Nicht eingeplant</h3><p class="leise">Melde dich bei der Orga.</p></div>';
      }
      h += '<article class="' + kl + '"><div class="zeit">' + esc(z.von) + '<small>bis ' + esc(z.bis) + ' · D' + z.durchgang + '</small></div><div>' + innen + '</div></article>';
    });
    if (!m.zeilen.length) h += '<div class="hinweis">Der Plan ist noch nicht erstellt.</div>';
    return h + '</div>';
  }

  /* ================= Check-in ================= */
  function viewCheckin() {
    let h = '<div class="seitenkopf"><div><div class="eyebrow">Am Eingang</div><h1>Check-in</h1></div><p>Bestätige, dass du da bist. Erst dann wirst du am Tag fest eingeplant.</p></div>';
    h += '<form class="flaeche" id="checkin-form" style="max-width:560px" autocomplete="off">';
    const w = ui.checkinWahl;
    if (w) {
      h += '<div class="zeile" style="justify-content:space-between"><div><h2>' + esc(w.name) + '</h2><p class="leise">Klasse ' + esc(w.klasse || '–') + ' · ' + esc(w.lj) + '. LJ</p></div><button class="knopf klein" type="button" data-act="checkin-anders">Nicht ich</button></div>' +
        '<button class="knopf haupt gross" type="submit">Ich bin da</button>';
    } else h += namenSuche('checkin', 'Dein Name', 'Vor- oder Nachname', 'Das bin ich') + zugangHinweis();
    h += '<div id="checkin-ergebnis">' + (ui.checkinMeldung || '') + '</div></form>';
    h += '<div class="hinweis">Kommst du mit einem RTW, KTW oder NEF? Dann meldet ihr euch in der Warteschlange gemeinsam über die <a href="#anmeldung">Fahrzeug-Anmeldung</a> an. Ein Check-in hier ist dann nicht nötig.</div>';
    if (Store.orga) h += '<section class="flaeche"><h3>QR-Code für den Eingang</h3><p class="leise">Ausdrucken und am Eingang aufhängen. Er führt mit Zugangsschlüssel direkt auf diese Seite.</p><div class="qr" data-qr="' + esc(zugangUrl('checkin')) + '"></div><p class="mono leise" style="word-break:break-all">' + esc(zugangUrl('checkin')) + '</p></section>';
    return h;
  }
  // Link mit Zugangsschlüssel (für QR-Codes und die Einladung an die Klassen)
  function zugangUrl(route) {
    const basis = location.href.split('#')[0].split('?')[0];
    const k = (voll && voll.zugang) || Store.zugang || '';
    return basis + (k ? '?z=' + encodeURIComponent(k) : '') + '#' + route;
  }

  /* ================= Lagekarte ================= */
  const KW = 1000, KH = 625;
  function fahrzeugLage(e, plan, t) {
    // liefert pro Fahrzeug-ID {x,y,zustand,station}
    const di = C.aktuellerDurchgang(e, t);
    const br = e.bereitstellung, lage = {};
    const d = plan && plan.durchgaenge[di], dg = e.durchgaenge[di];
    if (!d || !dg) return { di, lage };
    const start = C.zeitZuMin(dg.start), ende = C.zeitZuMin(dg.ende);
    d.einsaetze.forEach(ei => {
      const st = station(e, ei.station);
      ei.fahrzeuge.forEach((f, i) => {
        const alarm = start + f.minute, an = alarm + (e.anfahrtMin || 2);
        const ring = (k, n, r) => { const w = (k / Math.max(1, n)) * Math.PI * 2; return [Math.cos(w) * r, Math.sin(w) * r]; };
        const [ox, oy] = ring(i, ei.fahrzeuge.length, 34 + (i % 2) * 10);
        const sx = st.x * KW + ox, sy = st.y * KH + oy;
        const bx = br.x * KW + ((ei.wache - 3) * 26), by = br.y * KH + (i - ei.fahrzeuge.length / 2) * 6;
        let x = bx, y = by, z = 'bereit';
        if (t >= ende || t < start - 30) { z = t >= ende ? 'zurueck' : 'bereit'; }
        else if (t >= an) { x = sx; y = sy; z = 'vorort'; }
        else if (t >= alarm) { const p = (t - alarm) / Math.max(0.1, an - alarm); x = bx + (sx - bx) * p; y = by + (sy - by) * p; z = 'anfahrt'; }
        lage[f.fid] = { x, y, z, station: st.id, f, alarm };
      });
    });
    return { di, lage };
  }

  function karteSvg(e, plan, t, bearbeitbar) {
    const { lage } = fahrzeugLage(e, plan, t);
    let s = '<svg viewBox="0 0 ' + KW + ' ' + KH + '" role="img" aria-label="Lagekarte des Übungsgeländes">';
    if (e.karteBild) s += '<image href="' + esc(e.karteBild) + '" x="0" y="0" width="' + KW + '" height="' + KH + '" preserveAspectRatio="xMidYMid slice"/>';
    else {
      // schematisches Gelände, bis ein echter Lageplan hochgeladen ist
      s += '<rect width="' + KW + '" height="' + KH + '" fill="var(--map-ground)"/>' +
        '<path d="M0 312 H1000 M500 0 V625 M140 0 C 180 200, 120 420, 200 625" stroke="var(--map-road)" stroke-width="26" fill="none"/>' +
        '<path d="M0 312 H1000 M500 0 V625 M140 0 C 180 200, 120 420, 200 625" stroke="var(--line)" stroke-width="1" stroke-dasharray="10 12" fill="none"/>' +
        [[600, 380, 140, 70], [780, 120, 120, 80], [330, 90, 110, 60], [360, 420, 90, 80], [860, 470, 100, 90]].map(r => '<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '" fill="var(--map-build)" rx="3"/>').join('') +
        '<text x="16" y="606" class="klein-label">Schema – Lageplan des Geländes in den Einstellungen hochladen</text>';
    }
    const ein = e.eingang, br = e.bereitstellung;
    s += '<g class="' + (bearbeitbar ? 'zieh' : '') + '" data-ziehen="eingang"><rect x="' + (ein.x * KW - 40) + '" y="' + (ein.y * KH - 16) + '" width="80" height="32" rx="4" fill="var(--fg)"/><text x="' + ein.x * KW + '" y="' + (ein.y * KH + 5) + '" text-anchor="middle" class="st-label" style="fill:var(--bg);stroke:none;font-size:13px">EINGANG</text></g>';
    s += '<g class="' + (bearbeitbar ? 'zieh' : '') + '" data-ziehen="bereitstellung"><rect x="' + (br.x * KW - 90) + '" y="' + (br.y * KH - 40) + '" width="180" height="80" rx="6" fill="none" stroke="var(--blau)" stroke-width="2" stroke-dasharray="6 5"/><text x="' + br.x * KW + '" y="' + (br.y * KH - 46) + '" text-anchor="middle" class="st-label" style="font-size:13px">Bereitstellungsraum</text></g>';
    e.stationen.forEach((st, i) => {
      const x = st.x * KW, y = st.y * KH;
      s += '<g class="' + (bearbeitbar ? 'zieh' : '') + '" data-ziehen="st:' + i + '"><circle cx="' + x + '" cy="' + y + '" r="58" fill="color-mix(in srgb, var(--accent) 12%, transparent)" stroke="var(--accent)" stroke-width="2"/>' +
        '<text x="' + x + '" y="' + (y - 64) + '" text-anchor="middle" class="st-label">' + esc(st.id.replace('S', 'SIM ') + ' · ' + st.name) + '</text>' +
        '<text x="' + x + '" y="' + (y + 4) + '" text-anchor="middle" class="klein-label">' + (st.patienten || 0) + ' Pat.</text></g>';
    });
    const farbe = { RTW: 'var(--accent)', KTW: 'var(--blau)', NEF: 'var(--sk1)' };
    Object.values(lage).forEach(l => {
      if (l.z === 'zurueck') return;
      s += '<g><title>' + esc(l.f.funkrufname + ' · ' + (l.z === 'vorort' ? 'vor Ort' : l.z === 'anfahrt' ? 'auf Anfahrt' : 'Alarm ' + C.minZuZeit(l.alarm))) + '</title>' +
        '<rect x="' + (l.x - 7) + '" y="' + (l.y - 4.5) + '" width="14" height="9" rx="2" fill="' + farbe[l.f.typ] + '" stroke="var(--surface)" stroke-width="1.2" opacity="' + (l.z === 'bereit' ? 0.55 : 1) + '"/></g>';
    });
    return s + '</svg>';
  }

  function viewLage() {
    const e = pub.einstellungen, t = jetztMin();
    const { di, lage } = fahrzeugLage(e, pub.plan, t);
    const dg = e.durchgaenge[di];
    let h = '<div class="seitenkopf"><div><div class="eyebrow">Live</div><h1>Lagekarte</h1></div><p>' +
      (dg ? 'Durchgang ' + (di + 1) + ' · ' + dg.start + '–' + dg.ende + (t < C.zeitZuMin(dg.start) ? ' (beginnt gleich)' : ' (läuft)') : 'Alle Durchgänge sind beendet.') + ' · Stand ' + C.minZuZeit(t) + ' Uhr</p></div>';
    h += '<div class="lage"><div class="flaeche"><div class="karte" id="karte">' + karteSvg(e, pub.plan, t, Store.orga) + '</div>' +
      '<div class="legende"><span><i style="background:var(--accent)"></i>RTW</span><span><i style="background:var(--blau)"></i>KTW</span><span><i style="background:var(--sk1)"></i>NEF</span><span>blass = wartet im Bereitstellungsraum</span>' +
      (Store.orga ? '<span>Stationen, Eingang und Bereitstellungsraum lassen sich mit der Maus verschieben.</span>' : '') + '</div></div>';
    h += '<aside class="flaeche"><h3>Stationen jetzt</h3>';
    const d = pub.plan && pub.plan.durchgaenge[di];
    e.stationen.forEach(st => {
      const ei = d && d.einsaetze.find(x => x.station === st.id);
      const fz = Object.values(lage).filter(l => l.station === st.id);
      const vor = fz.filter(l => l.z === 'vorort').length, an = fz.filter(l => l.z === 'anfahrt').length;
      const naechster = fz.filter(l => l.z === 'bereit').sort((a, b) => a.alarm - b.alarm)[0];
      h += '<div style="display:grid;gap:3px"><div class="zeile"><b>' + esc(st.name) + '</b>' + (ei ? '<span class="pille">Wache ' + ei.wache + '</span>' : '') + '</div>' +
        '<div class="leise">' + vor + ' vor Ort · ' + an + ' auf Anfahrt · ' + (fz.length - vor - an) + ' warten' + (naechster ? ' · nächster Alarm ' + C.minZuZeit(naechster.alarm) + ' <span class="frn">' + esc(naechster.f.funkrufname) + '</span>' : '') + '</div>' +
        '<div class="balken" aria-hidden="true"><i style="width:' + (fz.length ? vor / fz.length * 100 : 0) + '%;background:var(--sk3)"></i><i style="width:' + (fz.length ? an / fz.length * 100 : 0) + '%;background:var(--sk2)"></i></div></div>';
    });
    const zl = pub.zaehlung;
    h += '<div class="trenner"></div><h3>Auf dem Gelände</h3><div class="leise">3. LJ ' + zl[3].da + '/' + zl[3].gesamt + ' · 2. LJ ' + zl[2].da + '/' + zl[2].gesamt + ' · 1. LJ ' + zl[1].da + '/' + zl[1].gesamt + ' eingecheckt</div></aside></div>';
    return h;
  }

  /* ================= Stationen ================= */
  function viewStationen() {
    const e = pub.einstellungen, plan = Store.orga && voll ? voll.plan : pub.plan;
    const st = station(e, ui.station);
    let h = '<div class="seitenkopf"><div><div class="eyebrow">Für Stationsleitungen</div><h1>Alarmierung ' + esc(st.id.replace('S', 'SIM ')) + '</h1></div><p>Welche Wache kommt wann, und in welcher Minute wird welches Fahrzeug alarmiert.</p></div>';
    h += '<div class="zeile">' + e.stationen.map(s => '<button class="knopf" data-act="station" data-id="' + s.id + '" aria-pressed="' + (s.id === st.id) + '">' + esc(s.id.replace('S', 'SIM ') + ' ' + s.name) + '</button>').join('') + '</div>';
    if (!plan) return h + '<div class="hinweis">Noch kein Plan erstellt.</div>';
    const name = id => { const p = voll && voll.personen.find(x => x.id === id); return p ? p.name : ''; };
    plan.durchgaenge.forEach((d, di) => {
      const dg = e.durchgaenge[di]; if (!dg) return;
      const ei = d.einsaetze.find(x => x.station === st.id); if (!ei) return;
      const start = C.zeitZuMin(dg.start);
      const mg = d.mimen[st.id], zg = d.zuschauer[st.id];
      const anzM = pub.gruppen[2] ? pub.gruppen[2][mg] || 0 : 0, anzZ = pub.gruppen[1] ? pub.gruppen[1][zg] || 0 : 0;
      h += '<section class="flaeche"><div class="zeile" style="justify-content:space-between"><h2>Durchgang ' + (di + 1) + ' · ' + dg.start + '–' + dg.ende + '</h2><div class="zeile"><span class="pille akzent">Wache ' + ei.wache + '</span>' +
        '<span class="pille">Mimen Gruppe ' + gruppeBuchst(mg) + ' (' + anzM + ')</span><span class="pille">Beobachtung Gruppe ' + gruppeBuchst(zg) + ' (' + anzZ + ')</span></div></div>' +
        '<div class="leise">Mimen schminken ab ' + C.minZuZeit(start - e.schminkenVorher) + ', Treffen am Einsatzort ' + C.minZuZeit(start - e.treffenVorher) + '.</div>';
      h += '<div class="tabelle-box"><table><thead><tr><th>Alarm</th><th>Minute</th><th>Fahrzeug</th><th>Typ</th><th>Kennzeichen</th><th>Träger</th><th>Besatzung</th></tr></thead><tbody>';
      ei.fahrzeuge.forEach(f => {
        const bes = Array.isArray(f.besatzung) ? (Store.orga ? f.besatzung.map(name).join(', ') : f.besatzung.length + ' Pers.') : f.besatzung + ' Pers.';
        h += '<tr class="' + (f.erste ? 'erste' : '') + '"><td class="mono">' + C.minZuZeit(start + f.minute) + '</td><td class="mono">+' + f.minute + '</td><td>' + frnChip(f.funkrufname, ei.wache) + '</td><td>' + typ(f.typ) + '</td><td>' + kz(f.kennzeichen) + '</td><td>' + esc(f.traeger) + '</td><td>' + esc(bes) + '</td></tr>';
      });
      h += '</tbody></table></div>' + (ei.hinweise && ei.hinweise.length ? '<div class="hinweis">' + ei.hinweise.map(esc).join('<br>') + '</div>' : '') + '</section>';
    });
    return h;
  }

  /* ================= Orga ================= */
  function viewOrga() {
    if (!Store.orga) {
      return '<div class="seitenkopf"><div><div class="eyebrow">Nur für das Orga-Team</div><h1>Orga-Bereich</h1></div><p>Hier werden Teilnehmende und Fahrzeuge verwaltet und der Plan erstellt.</p></div>' +
        '<form class="flaeche" id="login-form" style="max-width:420px"><label class="feld" for="pw"><span>Passwort</span><input id="pw" type="password" autocomplete="current-password"></label>' +
        '<button class="knopf haupt" type="submit">Anmelden</button>' + (Store.modus === 'demo' ? '<p class="leise">Demo-Passwort: <span class="mono">' + DEMO_PASSWORT + '</span></p>' : '') + '<div id="login-fehler"></div></form>';
    }
    if (!voll) return '<p class="leise">Lade Daten …</p>';
    const tabs = [['lage', 'Lage'], ['fahrzeuge', 'Fahrzeuge'], ['personen', 'Teilnehmende'], ['plan', 'Plan'], ['gerecht', 'Gerechtigkeit'], ['einst', 'Einstellungen']];
    let h = '<div class="seitenkopf"><div><div class="eyebrow">Orga-Team</div><h1>Steuerung</h1></div><button class="knopf klein" data-act="abmelden">Abmelden</button></div>';
    h += '<div class="tabs" role="tablist">' + tabs.map(([id, t]) => '<button role="tab" data-act="tab" data-id="' + id + '" aria-selected="' + (ui.orgaTab === id) + '">' + t + '</button>').join('') + '</div>';
    h += ({ lage: orgaLage, fahrzeuge: orgaFahrzeuge, personen: orgaPersonen, plan: orgaPlan, gerecht: orgaGerecht, einst: orgaEinst })[ui.orgaTab]();
    return h;
  }

  function naechsterOffenerDurchgang(e) {
    const t = jetztMin();
    for (let i = 0; i < e.durchgaenge.length; i++) if (t < C.zeitZuMin(e.durchgaenge[i].start)) return i;
    return e.durchgaenge.length;
  }

  function planStatus() {
    const z = voll, e = z.einstellungen;
    const veraltet = C.planVeraltet(z);
    const ab = naechsterOffenerDurchgang(e);
    let h = '';
    if (!z.plan) h += '<div class="hinweis rot"><b>Noch kein Plan.</b> <button class="knopf haupt klein" data-act="planen" data-ab="0">Plan erstellen</button></div>';
    else if (veraltet) {
      h += '<div class="hinweis rot"><b>Der Plan passt nicht mehr</b> zu den aktuellen Fahrzeugen oder Teilnehmenden. ' +
        (ab < e.durchgaenge.length ? '<button class="knopf haupt klein" data-act="planen" data-ab="' + ab + '">Ab Durchgang ' + (ab + 1) + ' neu planen</button> ' : 'Alle Durchgänge haben schon begonnen. ') +
        '<button class="knopf klein" data-act="planen" data-ab="0">Alles neu planen</button></div>';
    } else h += '<div class="hinweis gruen">Der Plan ist aktuell (erstellt ' + new Date(z.plan.erstellt).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) + ').</div>';
    return h;
  }

  function orgaLage() {
    const z = voll, e = z.einstellungen, k = C.kapazitaet(z);
    const lj = n => z.personen.filter(p => p.lj === n && p.status !== 'abgemeldet');
    const kart = (zahl, text) => '<div class="kennzahl"><b>' + zahl + '</b><span>' + text + '</span></div>';
    let h = planStatus();
    h += '<div class="raster">';
    h += '<section class="flaeche"><h3>Teilnehmende</h3><div class="raster" style="grid-template-columns:repeat(3,1fr)">' +
      [3, 2, 1].map(n => kart(lj(n).filter(p => p.eingecheckt).length + '<span class="leise" style="font-size:1rem"> / ' + lj(n).length + '</span>', n + '. LJ eingecheckt')).join('') + '</div>' +
      '<label class="zeile" for="nur-ein"><input id="nur-ein" type="checkbox" data-act="nur-eingecheckte"' + (e.nurEingecheckte ? ' checked' : '') + '> <b>SimTag läuft:</b> nur eingecheckte Teilnehmende und angekommene Fahrzeuge einplanen</label></section>';
    h += '<section class="flaeche"><h3>Fahrzeuge</h3><div class="raster" style="grid-template-columns:repeat(3,1fr)">' + kart(k.RTW, 'RTW') + kart(k.KTW, 'KTW') + kart(k.NEF, 'NEF') + '</div>' +
      '<p class="leise">' + z.fahrzeuge.filter(f => f.status === 'da').length + ' vor Ort angemeldet, ' + z.fahrzeuge.filter(f => f.status === 'gemeldet').length + ' nur vorab gemeldet, ' + z.fahrzeuge.filter(f => f.status === 'defekt' || f.status === 'abgemeldet').length + ' fallen aus.</p></section>';
    const proD = Math.min(k.tn, k.max);
    h += '<section class="flaeche"><h3>Rechnung je Durchgang</h3><p>' + k.tn + ' Teilnehmende im 3. LJ, ' + k.min + ' bis ' + k.max + ' Sitzplätze. ' +
      (k.tn > k.max ? 'Pro Durchgang fahren ' + proD + ', ' + (k.tn - k.max) + ' beobachten.' : k.tn < k.min ? '<b>Zu wenige Leute:</b> einige Fahrzeuge bleiben unbesetzt.' : 'Alle fahren in jedem Durchgang.') + '</p>' +
      '<p class="leise">Erste Welle: ' + k.ersteSitze + ' Plätze über den Tag. ' + (k.ersteSitze >= k.tn ? 'Das reicht, damit jede Person mindestens einmal vorne fährt.' : 'Das reicht nicht für alle. Erste Welle in den Einstellungen vergrößern.') + '</p></section>';
    h += '</div>';
    h += '<section class="flaeche"><h3>Teilnahme-Link</h3><div class="zeile" style="align-items:start;gap:20px"><div class="qr" data-qr="' + esc(zugangUrl('plan')) + '"></div><div style="display:grid;gap:8px;min-width:0">' +
      '<p>Diesen Link an die Klassen schicken oder als QR-Code aushängen. Damit sucht jede Person ihren Namen und sieht ihren Plan. Ohne den Schlüssel im Link funktioniert die Namenssuche nicht, so bleiben die Namen unter euch.</p>' +
      '<p class="mono leise" style="word-break:break-all">' + esc(zugangUrl('plan')) + '</p><div class="zeile"><a class="knopf klein" href="#zettel" data-act="zettel-schilder">QR-Schilder drucken</a><button class="knopf klein" data-act="zugang-neu">Neuen Schlüssel erzeugen</button></div>' +
      '<p class="leise">Für andere einchecken: im Reiter Teilnehmende.</p></div></div></section>';
    return h;
  }

  function orgaPersonen() {
    const z = voll, q = ui.suche.toLowerCase();
    const liste = z.personen.filter(p => p.lj === ui.filterLj && (!q || (p.name + ' ' + p.klasse + ' ' + p.traeger + ' ' + p.code).toLowerCase().includes(q)))
      .sort((a, b) => (a.klasse || '').localeCompare(b.klasse || '') || a.name.localeCompare(b.name));
    let h = planStatus();
    h += '<section class="flaeche"><div class="zeile">' + [3, 2, 1].map(n => '<button class="knopf" data-act="lj" data-lj="' + n + '" aria-pressed="' + (ui.filterLj === n) + '">' + n + '. LJ (' + z.personen.filter(p => p.lj === n).length + ')</button>').join('') +
      '<label class="feld" for="suche" style="flex:1;min-width:180px"><span>Suchen</span><input id="suche" type="text" value="' + esc(ui.suche) + '" placeholder="Name, Klasse, Träger oder Code"></label></div>' +
      '<div class="tabelle-box"><table><thead><tr><th>Name</th><th>Klasse</th><th>Träger</th><th>' + (ui.filterLj === 3 ? 'Wache' : 'Gruppe') + '</th><th>Code</th><th>Status</th><th>Check-in</th></tr></thead><tbody>' +
      liste.map(p => '<tr class="' + (p.status === 'krank' || p.status === 'abgemeldet' ? 'aus' : '') + '"><td>' + esc(p.name) + (p.nachgemeldet ? ' <span class="pille warn">nachgemeldet</span>' : '') + '</td><td>' + esc(p.klasse) + '</td><td>' + esc(p.traeger) + '</td><td>' + (p.lj === 3 ? p.wache || '–' : gruppeBuchst(p.gruppe)) + '</td><td class="mono">' + esc(p.code) + '</td><td>' +
        '<select data-act="p-status" data-id="' + p.id + '" aria-label="Status ' + esc(p.name) + '">' + [['angemeldet', 'angemeldet'], ['krank', 'krank'], ['abgemeldet', 'abgemeldet']].map(([v, t]) => '<option value="' + v + '"' + (p.status === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></td><td>' +
        (p.eingecheckt ? '<button class="knopf klein" data-act="p-checkout" data-id="' + p.id + '">✓ ' + new Date(p.eingecheckt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + '</button>' : '<button class="knopf klein" data-act="p-checkin" data-id="' + p.id + '">einchecken</button>') + '</td></tr>').join('') +
      '</tbody></table></div></section>';
    h += '<section class="flaeche"><h3>Teilnehmende einfügen</h3><p class="leise">Aus Excel kopieren und hier einfügen, eine Person pro Zeile: <span class="mono">Name; Klasse; Ausbildungsjahr; Träger</span>. Träger ist der Arbeitgeber (z. B. Stadt Bielefeld, Kreis Gütersloh). Daran hängt, welche Fahrzeuge jemand fahren darf.</p>' +
      '<textarea id="import" placeholder="Muster, Lena;24A;3;Kreis Gütersloh"></textarea><div class="zeile"><button class="knopf haupt" data-act="import">Einfügen</button>' +
      (window.SIMTAG_DEMO ? '' : '<button class="knopf" data-act="codes-csv">Liste herunterladen (CSV)</button>') + '<button class="knopf" data-act="wachen-neu">Wachen und Gruppen neu verteilen</button></div>' +
      '<p class="leise">„Neu verteilen“ nur vor dem SimTag benutzen. Am Tag selbst gleicht „Neu planen“ die Wachen automatisch aus und verschiebt nur so wenige Leute wie nötig.</p></section>';
    return h;
  }

  function orgaPlan() {
    const z = voll, e = z.einstellungen;
    let h = planStatus();
    if (!z.plan) return h;
    const di = Math.min(ui.planD, z.plan.durchgaenge.length - 1), d = z.plan.durchgaenge[di], dg = e.durchgaenge[di];
    const name = id => { const p = z.personen.find(x => x.id === id); return p ? p.name : '?'; };
    h += '<div class="zeile">' + e.durchgaenge.map((x, i) => '<button class="knopf" data-act="plan-d" data-i="' + i + '" aria-pressed="' + (i === di) + '">D' + (i + 1) + ' · ' + x.start + '</button>').join('') + '</div>';
    d.einsaetze.forEach(ei => {
      const st = station(e, ei.station), start = C.zeitZuMin(dg.start);
      h += '<section class="flaeche"><div class="zeile" style="justify-content:space-between"><h3>Wache ' + ei.wache + ' → ' + esc(st.id.replace('S', 'SIM ') + ' ' + st.name) + '</h3><span class="leise">' + ei.fahrzeuge.reduce((s, f) => s + f.besatzung.length, 0) + ' fahren · ' + ei.pause.length + ' beobachten</span></div>' +
        '<div class="tabelle-box"><table><thead><tr><th>Alarm</th><th>Fahrzeug</th><th>Kennzeichen</th><th>Fahrer:in</th><th>Besatzung</th></tr></thead><tbody>' +
        ei.fahrzeuge.map(f => '<tr class="' + (f.erste ? 'erste' : '') + '"><td class="mono">' + C.minZuZeit(start + f.minute) + '</td><td>' + frnChip(f.funkrufname, ei.wache) + '</td><td>' + kz(f.kennzeichen) + '</td><td>' + (f.fahrerExtern ? '<span class="pille">vom Träger</span>' : esc(name(f.fahrer))) + '</td><td>' + f.besatzung.filter(x => x !== f.fahrer).map(name).map(esc).join(', ') + '</td></tr>').join('') +
        '</tbody></table></div>' + (ei.pause.length ? '<p class="leise"><b>Beobachten:</b> ' + ei.pause.map(name).map(esc).join(', ') + '</p>' : '') +
        (ei.hinweise.length ? '<div class="hinweis">' + ei.hinweise.map(esc).join('<br>') + '</div>' : '') + '</section>';
    });
    return h;
  }

  function verteilungsBalken(titel, vert, gesamt, gutAb) {
    const keys = Object.keys(vert).map(Number).sort((a, b) => a - b);
    return '<section class="flaeche"><h3>' + titel + '</h3>' + keys.map(k => {
      const n = vert[k], pct = gesamt ? n / gesamt * 100 : 0;
      const farbe = k >= gutAb ? 'var(--sk3)' : 'var(--sk1)';
      return '<div style="display:grid;grid-template-columns:70px 1fr 48px;gap:8px;align-items:center"><span class="mono">' + k + '×</span><div class="balken"><i style="width:' + pct + '%;background:' + farbe + '"></i></div><span class="mono">' + n + '</span></div>';
    }).join('') + '</section>';
  }

  function orgaGerecht() {
    const z = voll;
    if (!z.plan) return planStatus();
    const g = C.gerechtigkeit(z);
    const minE = Math.min(...Object.keys(g.einsaetze).map(Number)), maxE = Math.max(...Object.keys(g.einsaetze).map(Number));
    let h = planStatus();
    h += '<p>' + g.anzahl + ' Teilnehmende im 3. LJ. Jede Person fährt ' + (minE === maxE ? minE : minE + ' bis ' + maxE) + '-mal. ' + (g.ohneErste.length ? g.ohneErste.length + ' Person(en) sind nie in der ersten Welle.' : 'Alle sind mindestens einmal in der ersten Welle.') + '</p>';
    h += '<div class="raster">' + verteilungsBalken('Einsätze pro Person', g.einsaetze, g.anzahl, maxE - 1) + verteilungsBalken('Erste Welle pro Person', g.erste, g.anzahl, 1) + verteilungsBalken('NEF pro Person', g.nef, g.anzahl, 1) + '</div>';
    if (g.ohneErste.length) h += '<div class="hinweis">Nie in der ersten Welle: ' + g.ohneErste.map(id => esc((z.personen.find(p => p.id === id) || {}).name)).join(', ') + '</div>';
    h += '<p class="leise">So verteilt die App: Wer bisher am wenigsten gefahren ist, fährt zuerst. Die Plätze der ersten Welle bekommen die, die am seltensten vorne waren. Die NEF-Plätze bekommen die, die noch nie NEF hatten. Fahren darf nur, wer bei einem Träger derselben Fahrgruppe arbeitet (z. B. alle Bielefelder alle Bielefelder Fahrzeuge); innerhalb der Gruppe wechselt die Fahrerrolle. Niemand sitzt zweimal auf demselben Fahrzeug, wenn es sich vermeiden lässt.</p>';
    return h;
  }

  function orgaEinst() {
    const e = voll.einstellungen;
    let h = '<form class="flaeche" id="einst-form"><h3>Allgemein</h3><div class="raster">' +
      '<label class="feld" for="e-datum"><span>Datum</span><input id="e-datum" type="date" value="' + esc(e.datum) + '"></label>' +
      '<label class="feld" for="e-ort"><span>Ort</span><input id="e-ort" type="text" value="' + esc(e.ort) + '"></label>' +
      '<label class="feld" for="e-welle"><span>Erste Welle (Fahrzeuge je Station)</span><input id="e-welle" type="number" min="1" max="6" value="' + e.ersteWelle + '"></label>' +
      '<label class="feld" for="e-nef"><span>NEF wird als n-tes Fahrzeug alarmiert</span><input id="e-nef" type="number" min="1" max="10" value="' + e.nefPosition + '"></label>' +
      '<label class="feld" for="e-anfahrt"><span>Anfahrt (Minuten)</span><input id="e-anfahrt" type="number" min="0" max="15" value="' + e.anfahrtMin + '"></label>' +
      '<label class="feld" for="e-raster"><span>Alarmminuten in Reihenfolge</span><input id="e-raster" type="text" class="mono" value="' + esc(e.alarmRaster.join(', ')) + '"></label>' +
      '<label class="feld" for="e-schminken"><span>Schminken vor Start (Min.)</span><input id="e-schminken" type="number" min="0" value="' + e.schminkenVorher + '"></label>' +
      '<label class="feld" for="e-treffen"><span>Treffen vor Start (Min.)</span><input id="e-treffen" type="number" min="0" value="' + e.treffenVorher + '"></label></div>';
    h += '<h3>Besatzung (mindestens / höchstens)</h3><div class="raster">' + C.TYPEN.map(t => '<div class="zeile"><b style="width:44px">' + t + '</b><input aria-label="' + t + ' mindestens" id="b-' + t + '-0" type="number" min="1" max="4" value="' + e.besatzung[t][0] + '" style="width:80px"><input aria-label="' + t + ' höchstens" id="b-' + t + '-1" type="number" min="1" max="4" value="' + e.besatzung[t][1] + '" style="width:80px"></div>').join('') + '</div>';
    h += '<h3>Durchgänge</h3><div class="raster">' + e.durchgaenge.map((d, i) => '<div class="zeile"><b style="width:30px">D' + (i + 1) + '</b><input aria-label="D' + (i + 1) + ' Beginn" id="d-' + i + '-s" type="time" value="' + d.start + '" style="width:120px"><input aria-label="D' + (i + 1) + ' Ende" id="d-' + i + '-e" type="time" value="' + d.ende + '" style="width:120px"></div>').join('') + '</div>';
    h += '<h3>Stationen</h3><div class="raster">' + e.stationen.map((s, i) => '<div class="zeile"><b style="width:50px">' + s.id.replace('S', 'SIM ') + '</b><input aria-label="Name" id="s-' + i + '-n" type="text" value="' + esc(s.name) + '" style="flex:1;min-width:120px"><input aria-label="Patienten" id="s-' + i + '-p" type="number" min="0" value="' + (s.patienten || 0) + '" style="width:80px" title="Anzahl Patient:innen"></div>').join('') + '</div>';
    h += '<h3>Wer darf welches Fahrzeug fahren?</h3><p class="leise">Eine Zeile pro Fahrgruppe: <span class="mono">Gruppe: Träger, Träger, …</span>. Wer bei einem Träger der Gruppe arbeitet, darf alle Fahrzeuge der Gruppe fahren. Träger, die nirgends stehen, bilden eine eigene Gruppe. Groß- und Kleinschreibung und Leerzeichen sind egal.</p>' +
      '<textarea id="e-fahrgruppen" rows="6" class="mono">' + esc(C.fahrgruppenAlsText(e)) + '</textarea>';
    h += '<h3>Einfahrt</h3><label class="zeile" for="e-selbst"><input id="e-selbst" type="checkbox"' + (e.selbstanmeldung !== false ? ' checked' : '') + '> Fastlane nur mit Selbstanmeldung der Besatzung (sonst wird jedes bekannte Kennzeichen direkt „da“)</label>';
    h += '<div class="zeile"><button class="knopf haupt" type="submit">Einstellungen speichern</button><span class="leise">Danach den Plan neu erstellen.</span></div></form>';
    h += '<section class="flaeche"><h3>Lageplan des Geländes</h3><p class="leise">Ein Bild vom LAFP-Gelände (Screenshot aus einer Karte oder ein Lageplan) als Hintergrund der Lagekarte. Danach Stationen auf der Lagekarte an die richtige Stelle ziehen.</p>' +
      '<div class="zeile"><input id="karte-bild" type="file" accept="image/*" aria-label="Lageplan hochladen">' + (e.karteBild ? '<button class="knopf klein" data-act="karte-weg">Bild entfernen</button>' : '') + '</div></section>';
    h += '<section class="flaeche"><h3>Daten</h3><div class="zeile">' + (window.SIMTAG_DEMO ? '' : '<button class="knopf" data-act="export">Alles als Datei sichern (JSON)</button>') +
      (Store.modus === 'demo' ? '<button class="knopf" data-act="demo-reset">Demo-Daten neu erzeugen</button>' : '') + '</div></section>';
    return h;
  }

  /* ================= Fahrzeuge: Vorplanung und Übersicht ================= */
  const FZ_STATUS = [['gemeldet', 'erwartet'], ['da', 'ist da'], ['reserve', 'Reserve'], ['defekt', 'defekt'], ['abgemeldet', 'abgemeldet']];
  const FZ_FILTER = [['alle', 'Alle'], ['gemeldet', 'Erwartet'], ['da', 'Ist da'], ['reserve', 'Reserve'], ['aus', 'Fällt aus']];
  const zeitKurz = iso => iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';

  function traegerUebersicht(z) {
    const m = new Map();
    z.fahrzeuge.forEach(f => {
      const k = f.traeger || 'ohne Träger';
      if (!m.has(k)) m.set(k, { traeger: k, RTW: [0, 0], KTW: [0, 0], NEF: [0, 0], offen: [], extra: 0 });
      const t = m.get(k);
      if (f.status === 'reserve' || f.zusaetzlich) { t.extra++; if (f.status === 'reserve') return; }
      if (f.status === 'defekt' || f.status === 'abgemeldet') return;
      if (!f.zusaetzlich) t[f.typ][0]++;
      if (f.status === 'da') t[f.typ][1]++;
      if (f.status === 'gemeldet') t.offen.push(f);
    });
    return [...m.values()].sort((a, b) => a.traeger.localeCompare(b.traeger));
  }

  function orgaFahrzeuge() {
    const z = voll;
    const traeger = [...new Set(z.fahrzeuge.map(f => f.traeger).concat(z.personen.map(p => p.traeger)).filter(Boolean))].sort();
    let h = planStatus();
    h += '<div class="hinweis">Am SimTag melden sich die Besatzungen in der Warteschlange selbst an. An der <a href="#ankunft">Einfahrt</a> wird nur das Kennzeichen gescannt: grün heißt durchfahren, sonst rote Spur.</div>';
    const fu = C.fahrerUebersicht(z);
    const knapp = fu.filter(x => x.fahrzeuge > x.leute);
    h += '<section class="flaeche"><h3>Wer darf was fahren?</h3><p class="leise">Je Fahrgruppe: Fahrzeuge, die eine Fahrerin oder einen Fahrer aus dem Kurs brauchen, und Teilnehmende im 3. LJ, die sie fahren dürfen. Gruppen stehen in den Einstellungen.</p>' +
      (knapp.length ? '<div class="hinweis rot"><b>Zu wenige Fahrer:innen:</b> ' + knapp.map(x => esc(x.gruppe) + ' (' + x.fahrzeuge + ' Fahrzeuge, ' + x.leute + ' Personen)').join(', ') + '. Diese Fahrzeuge bleiben teils stehen, außer der Träger stellt die Fahrerin oder den Fahrer.</div>' : '') +
      '<div class="tabelle-box"><table><thead><tr><th>Fahrgruppe</th><th>Träger</th><th>Fahrzeuge</th><th>Dürfen fahren</th></tr></thead><tbody>' +
      fu.map(x => '<tr><td><b>' + esc(x.gruppe) + '</b></td><td class="leise">' + x.traeger.map(esc).join(', ') + '</td><td class="mono">' + x.fahrzeuge + (x.extern ? ' <span class="leise">+' + x.extern + ' mit eigener Fahrer:in</span>' : '') + '</td><td class="mono">' + x.leute + (x.fahrzeuge > x.leute ? ' <span class="pille schlecht">zu wenig</span>' : x.fahrzeuge && x.leute < x.fahrzeuge * 1.5 ? ' <span class="pille warn">knapp</span>' : '') + '</td></tr>').join('') +
      '</tbody></table></div></section>';

    // Vorplanung je Träger
    const tu = traegerUebersicht(z);
    h += '<section class="flaeche"><h3>Vorplanung je Träger</h3><p class="leise">So viele Fahrzeuge hat jeder Träger zugesagt. Jedes bekommt schon jetzt eine Kennung. Kennzeichen sind freiwillig; wenn sie bekannt sind, erkennt die Ankunft das Fahrzeug direkt.</p>' +
      '<div class="tabelle-box"><table><thead><tr><th>Träger</th><th>RTW</th><th>KTW</th><th>NEF</th><th>Zusätzlich</th><th>Noch erwartet</th></tr></thead><tbody>' +
      tu.map(t => '<tr><td>' + esc(t.traeger) + '</td>' + C.TYPEN.map(ty => '<td class="mono">' + t[ty][1] + '/' + t[ty][0] + '</td>').join('') + '<td class="mono">' + (t.extra || '') + '</td><td>' + t.offen.map(f => frnChip(f.funkrufname, f.wache)).join(' ') + '</td></tr>').join('') +
      '</tbody></table></div><p class="leise">Zahlen: angekommen / zugesagt.</p>' +
      '<form id="vp-form" class="zeile" style="align-items:end"><label class="feld" for="vp-tr" style="flex:1;min-width:180px"><span>Träger</span><input id="vp-tr" type="text" list="traeger-liste" autocomplete="off"></label>' +
      C.TYPEN.map(t => '<label class="feld" for="vp-' + t + '" style="width:80px"><span>' + t + '</span><input id="vp-' + t + '" type="number" min="0" max="30" value="0"></label>').join('') +
      '<button class="knopf haupt" type="submit">Zusage speichern</button></form>' +
      '<datalist id="traeger-liste">' + traeger.map(t => '<option value="' + esc(t) + '"></option>').join('') + '</datalist>' +
      '<details><summary>Mehrere Träger auf einmal einfügen</summary><p class="leise">Eine Zeile pro Träger: <span class="mono">Träger; RTW; KTW; NEF</span></p><textarea id="vp-import" placeholder="Kreis Gütersloh;5;0;1"></textarea><button class="knopf" data-act="vp-import">Einfügen</button></details>' +
      (ui.fzMeldung || '') + '</section>';

    // Übersicht mit Suche
    const q = (ui.fzSuche || '').toLowerCase(), fil = ui.fzFilter || 'alle';
    const passt = f => (fil === 'alle' || (fil === 'aus' ? (f.status === 'defekt' || f.status === 'abgemeldet') : f.status === fil)) &&
      (!q || (f.funkrufname + ' ' + f.kennzeichen + ' ' + C.kzNorm(f.kennzeichen) + ' ' + f.traeger + ' ' + f.typ + ' wache ' + f.wache).toLowerCase().includes(q));
    const liste = z.fahrzeuge.filter(passt).sort((a, b) => (a.wache || 99) - (b.wache || 99) || a.typ.localeCompare(b.typ) || a.nr - b.nr);
    h += '<section class="flaeche"><div class="zeile" style="justify-content:space-between"><h3>Alle Fahrzeuge</h3><span class="leise">' + liste.length + ' von ' + z.fahrzeuge.length + '</span></div>' +
      '<div class="zeile"><label class="feld" for="fz-suche" style="flex:1;min-width:200px"><span>Suchen</span><input id="fz-suche" type="search" value="' + esc(ui.fzSuche || '') + '" placeholder="Kennung, Kennzeichen oder Träger"></label>' +
      '<div class="zeile">' + FZ_FILTER.map(([v, t]) => '<button class="knopf klein" data-act="fz-filter" data-v="' + v + '" aria-pressed="' + (fil === v) + '">' + t + '</button>').join('') + '</div></div>' +
      '<div class="tabelle-box"><table><thead><tr><th>Kennung</th><th>Typ</th><th>Kennzeichen</th><th>Träger</th><th>Status</th><th>Angekommen</th><th title="Fahrer:in stellt der Träger, nicht aus dem Kurs">Fahrer:in vom Träger</th></tr></thead><tbody>' +
      liste.map(f => '<tr class="' + (f.status === 'defekt' || f.status === 'abgemeldet' ? 'aus' : '') + '"><td>' + frnChip(f.funkrufname, f.wache) + (f.zusaetzlich ? ' <span class="pille warn">zusätzlich</span>' : '') + (f.ersetzt ? ' <span class="pille" title="Platz übernommen von ' + esc(f.ersetzt) + '">statt ' + esc(f.ersetzt) + '</span>' : '') + '</td><td>' + typ(f.typ) + '</td>' +
        '<td><input type="text" class="mono kz-feld" data-act="fz-kz" data-id="' + f.id + '" value="' + esc(f.kennzeichen) + '" placeholder="unbekannt" aria-label="Kennzeichen ' + esc(f.funkrufname) + '"></td><td>' + esc(f.traeger) + '</td><td>' +
        '<select data-act="fz-status" data-id="' + f.id + '" aria-label="Status ' + esc(f.funkrufname) + '">' + FZ_STATUS.map(([v, t]) => '<option value="' + v + '"' + (f.status === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></td><td class="mono">' + zeitKurz(f.status === 'da' && f.registriert) + '</td><td><input type="checkbox" data-act="fz-extern" data-id="' + f.id + '"' + (f.fahrerExtern ? ' checked' : '') + ' aria-label="Fahrer:in von ' + esc(f.funkrufname) + ' kommt vom Träger"></td></tr>').join('') +
      '</tbody></table></div>' + (liste.length ? '' : '<p class="leise">Kein Fahrzeug passt zur Suche.</p>') + '</section>';
    return h;
  }

  /* ================= Fahrzeug-Anmeldung in der Warteschlange (öffentlich, per QR) ================= */
  const anfLeer = () => ({ typ: 'RTW', kennzeichen: '', traeger: '', traegerFrei: '', personen: [], fehler: '', bearbeiten: false, senden: false });
  let anf = anfLeer();

  function viewAnmeldung() {
    if (anmBest && !anf.bearbeiten) return bestaetigungAnsicht(anmBest);
    const liste = pub.traeger || [];
    const anders = anf.traeger === '__anders' || (anf.traeger && !liste.includes(anf.traeger));
    let h = '<div class="seitenkopf"><div><div class="eyebrow">Warteschlange an der Einfahrt</div><h1>' + (anf.bearbeiten ? 'Anmeldung ändern' : 'Fahrzeug anmelden') + '</h1></div>' +
      '<p>Tragt euer Fahrzeug und alle ein, die drinsitzen. Den Bildschirm danach an der Kontrolle vorzeigen. Ist alles grün, fahrt ihr durch die Fastlane.</p></div>';
    if (ohneZugang() && !anf.bearbeiten) return h + '<div class="hinweis rot">Bitte den QR-Code „Fahrzeug-Anmeldung“ an der Einfahrt scannen. Nur darüber ist die Anmeldung möglich.</div>';
    h += '<form id="anf-form" class="anf" autocomplete="off">';
    h += '<section class="flaeche"><h3>1 · Fahrzeug</h3><div class="typwahl">' + C.TYPEN.map(t => '<button type="button" class="knopf gross" data-act="anf-typ" data-typ="' + t + '" aria-pressed="' + (anf.typ === t) + '">' + t + '</button>').join('') + '</div>' +
      '<label class="feld" for="anf-kz"><span>Kennzeichen</span><input id="anf-kz" type="text" class="mono" autocapitalize="characters" spellcheck="false" value="' + esc(anf.kennzeichen) + '" placeholder="z. B. GT-RD 1234" style="font-size:1.25rem"></label>' +
      '<label class="feld" for="anf-tr"><span>Träger des Fahrzeugs</span><select id="anf-tr"><option value="">Bitte wählen …</option>' +
      liste.map(t => '<option value="' + esc(t) + '"' + (anf.traeger === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') +
      '<option value="__anders"' + (anders ? ' selected' : '') + '>Anderer Träger …</option></select></label>' +
      (anders ? '<label class="feld" for="anf-tr-frei"><span>Anderer Träger</span><input id="anf-tr-frei" type="text" value="' + esc(anf.traegerFrei || (anf.traeger !== '__anders' ? anf.traeger : '')) + '" placeholder="Name des Trägers"></label>' : '') + '</section>';
    h += '<section class="flaeche"><h3>2 · Besatzung</h3><p class="leise">Alle, die im Fahrzeug sitzen. Namen suchen und antippen.</p>';
    if (anf.personen.length) {
      h += '<ul class="crew">' + anf.personen.map((x, i) => '<li><span class="' + (x.id ? 'ok' : 'nein') + '" aria-hidden="true">' + (x.id ? '✓' : '?') + '</span><div><b>' + esc(x.name) + '</b><small>' + (x.id ? 'Klasse ' + esc(x.klasse || '–') : 'nicht in der Schülerliste, wird in der roten Spur geklärt') + '</small></div>' +
        '<button type="button" class="knopf klein" data-act="anf-weg" data-i="' + i + '" aria-label="' + esc(x.name) + ' entfernen">Entfernen</button></li>').join('') + '</ul>';
    }
    if (anf.personen.length < 6) {
      h += namenSuche('anm', anf.personen.length ? 'Weitere Person' : 'Name', 'Vor- oder Nachname', 'Hinzufügen');
      const st = nsZustand('anm');
      if (st.geladen && C.suchNorm(st.q).length >= 3 && !st.fehler) h += '<button type="button" class="knopf klein" data-act="anf-frei">„' + esc(st.q.trim()) + '“ trotzdem eintragen</button>';
    }
    h += '</section>';
    if (anf.fehler) h += '<div class="hinweis rot">' + esc(anf.fehler) + '</div>';
    h += '<div class="zeile"><button class="knopf haupt gross" type="submit"' + (anf.senden ? ' disabled' : '') + '>' + (anf.bearbeiten ? 'Änderungen speichern' : 'Anmelden') + '</button>' +
      (anf.bearbeiten ? '<button type="button" class="knopf" data-act="anf-abbrechen">Abbrechen</button>' : '') + '</div></form>';
    return h;
  }

  function bestaetigungAnsicht(b) {
    const durch = b.status === 'durch';
    const art = durch ? 'durch' : b.gruen ? 'gruen' : 'rot';
    const titel = { durch: '✓ Durchgefahren', gruen: 'Fastlane', rot: 'Rote Spur' }[art];
    const text = { durch: 'um ' + zeitKurz(b.durch) + ' Uhr. Viel Erfolg beim SimTag!', gruen: 'Alles angemeldet. Diesen Bildschirm an der Kontrolle zeigen.', rot: 'Bitte in die rote Spur fahren. Dort klären wir:' }[art];
    let h = '<section class="best ' + art + '" aria-live="polite"><div class="best-band"><b>' + titel + '</b><span>' + text + '</span></div>';
    if (art === 'rot') h += '<ul class="gruende">' + b.gruende.map(g => '<li>' + esc(g) + '</li>').join('') + '</ul>';
    h += '<div class="best-mitte">' + (b.kennung ? kennungKachel({ wache: b.wache, funkrufname: b.kennung }) : '<div class="kennung leer"><small>Kennung</small><b>?</b></div>') +
      '<div class="best-daten"><div class="zeile">' + typ(b.typ) + kz(b.kennzeichen) + '</div><div>' + esc(b.fzTraeger || b.traeger || 'Träger fehlt') + '</div>' +
      '<div class="best-nr">Anmeldung <b>Nr. ' + b.nr + '</b></div><div class="leise">angemeldet ' + zeitKurz(b.erstellt) + ' Uhr' + (b.geaendert && b.geaendert !== b.erstellt ? ', geändert ' + zeitKurz(b.geaendert) : '') + '</div></div></div>';
    h += '<h3>Besatzung</h3><ul class="crew">' + b.personen.map(p => '<li><span class="' + (p.gefunden && !p.doppelt ? 'ok' : 'nein') + '" aria-hidden="true">' + (p.gefunden && !p.doppelt ? '✓' : '!') + '</span><div><b>' + esc(p.name) + '</b><small>' +
      (p.gefunden ? 'Klasse ' + esc(p.klasse || '–') : 'nicht in der Schülerliste') + (p.doppelt ? ' · steht schon in einer anderen Anmeldung' : '') + '</small></div>' + (p.darfFahren ? '<span class="pille gut">darf fahren</span>' : '') + '</li>').join('') + '</ul>';
    if (b.hinweise && b.hinweise.length) h += '<p class="leise">' + b.hinweise.map(esc).join(' · ') + '</p>';
    h += '<div class="zeile best-knoepfe"><button class="knopf" data-act="anf-bearbeiten">Fahrzeug oder Besatzung ändern</button><button class="knopf" data-act="anf-neu">Anderes Fahrzeug anmelden</button>' + (durch ? '<a class="knopf" href="#plan">Mein Plan</a>' : '') + '</div>' +
      '<p class="leise">Die Anzeige aktualisiert sich von selbst, sobald die Orga etwas klärt.</p></section>';
    return h;
  }

  async function anmeldungAbschicken() {
    const tr = anf.traeger === '__anders' ? anf.traegerFrei.trim() : anf.traeger;
    if (!C.kzNorm(anf.kennzeichen) && !tr) { anf.fehler = 'Bitte das Kennzeichen oder den Träger eintragen.'; return render(); }
    if (!anf.personen.length) { anf.fehler = 'Bitte mindestens eine Person eintragen.'; return render(); }
    anf.fehler = ''; anf.senden = true; render();
    try {
      const d = { typ: anf.typ, kennzeichen: anf.kennzeichen, traeger: tr, personen: anf.personen.map(x => (x.id ? { id: x.id } : { name: x.name })) };
      if (anf.bearbeiten && meineAnm) { d.id = meineAnm.id; d.token = meineAnm.token; }
      const r = await Store.anmeldungSenden(d);
      meineAnm = { id: r.id, token: r.token }; ls.set('simtag-anmeldung', JSON.stringify(meineAnm));
      anmBest = r.bestaetigung; anf = anfLeer(); nsZuruecksetzen('anm');
      window.scrollTo(0, 0);
    } catch (e) { anf.senden = false; anf.fehler = e.status === 403 ? 'Bitte den QR-Code an der Einfahrt noch einmal scannen.' : (e.message || 'Anmeldung hat nicht geklappt.'); }
    anf.senden = false; render();
  }

  /* ================= Ankunft am SimTag ================= */
  const ank = { text: '', gelesen: '', ocr: '', typ: 'RTW', traeger: '', ergebnis: null, kamera: null, stream: null };

  function viewAnkunft() {
    if (!Store.orga) { ui.orgaTab = 'lage'; return viewOrga(); }
    if (!voll) return '<p class="leise">Lade Daten …</p>';
    const z = voll, e = z.einstellungen;
    const vor = z.fahrzeuge.filter(f => !f.zusaetzlich && f.status !== 'reserve');
    const da = vor.filter(f => f.status === 'da').length;
    const anm = (z.anmeldungen || []).filter(a => a.status !== 'storniert');
    const rot = anm.filter(a => a.status === 'offen' && !C.anmeldungPruefen(z, a).gruen);
    const wartet = anm.filter(a => a.status === 'offen').length - rot.length;
    let h = '<div class="seitenkopf"><div><div class="eyebrow">Kontrolle an der Einfahrt</div><h1>Einfahrt</h1></div><p><b>' + da + '</b> von ' + vor.length + ' zugesagten Fahrzeugen sind da' +
      (z.fahrzeuge.filter(f => f.zusaetzlich).length ? ', dazu ' + z.fahrzeuge.filter(f => f.zusaetzlich).length + ' zusätzliche' : '') + '. ' + anm.length + ' Anmeldungen, ' + wartet + ' grün in der Schlange.</p></div>';
    const tabs = [['fastlane', 'Fastlane'], ['rot', 'Rote Spur' + (rot.length ? ' (' + rot.length + ')' : '')], ['liste', 'Anmeldungen und erwartet']];
    h += '<div class="tabs" role="tablist">' + tabs.map(([id, t]) => '<button role="tab" data-act="ein-tab" data-id="' + id + '" aria-selected="' + (ui.einTab === id) + '"' + (id === 'rot' && rot.length ? ' class="tab-rot"' : '') + '>' + t + '</button>').join('') + '</div>';
    if (ui.einTab === 'rot') return h + einfahrtRot(z, rot, wartet);
    if (ui.einTab === 'liste') return h + einfahrtListe(z, anm);

    // Fastlane: Kennzeichen erfassen
    h += '<section class="flaeche ank-scan"><h3>Kennzeichen erfassen</h3>';
    if (ank.kamera === 'an') {
      h += '<div class="sucher"><video id="kamera-video" autoplay playsinline muted></video><div class="sucher-rahmen" aria-hidden="true"></div></div>' +
        '<div class="zeile"><button class="knopf haupt gross" data-act="kamera-foto">Erfassen</button><button class="knopf" data-act="kamera-stopp">Kamera aus</button></div>';
    } else {
      h += '<div class="zeile"><button class="knopf haupt gross" data-act="kamera-start">Kamera</button>' +
        '<label class="knopf gross" for="kz-foto">Foto<input id="kz-foto" type="file" accept="image/*" capture="environment" hidden></label></div>' +
        '<p class="leise">' + (e.selbstanmeldung !== false ? 'Kennzeichen formatfüllend und gerade aufnehmen. Ist die Anmeldung grün, ist das Fahrzeug sofort „da“ und die Besatzung eingecheckt.' : 'Kennzeichen formatfüllend und gerade aufnehmen. Ein bekanntes Fahrzeug wird sofort als „ist da“ markiert.') + '</p>';
    }
    h += '<form id="ank-form" class="zeile" style="align-items:end"><label class="feld" for="ank-kz" style="flex:1;min-width:200px"><span>Kennzeichen oder Anmelde-Nr. (oder eintippen)</span><input id="ank-kz" type="text" class="mono" autocomplete="off" autocapitalize="characters" value="' + esc(ank.text) + '" placeholder="GT-RD 9012 oder 17" style="font-size:1.3rem"></label><button class="knopf haupt" type="submit">Prüfen</button></form>' +
      (ank.ocr ? '<p class="leise" role="status">' + esc(ank.ocr) + '</p>' : '') + '</section>';
    if (ank.ergebnis) h += ankunftErgebnis(z);
    return h;
  }

  function crewListe(z, pr) {
    return '<ul class="crew">' + pr.personen.map(p => '<li><span class="' + (p.gefunden && !p.doppeltNr ? 'ok' : 'nein') + '" aria-hidden="true">' + (p.gefunden && !p.doppeltNr ? '✓' : '!') + '</span><div><b>' + esc(p.name) + '</b><small>' +
      (p.gefunden ? 'Klasse ' + esc(p.klasse || '–') + ' · ' + esc(p.traeger || 'ohne Träger') : 'nicht in der Schülerliste') + (p.doppeltNr ? ' · auch in Nr. ' + p.doppeltNr : '') + '</small></div>' + (p.darfFahren ? '<span class="pille gut">darf fahren</span>' : '') + '</li>').join('') + '</ul>';
  }

  // Ein Fall der roten Spur: alles, was die Orga dort klären kann
  function anmeldungKarte(z, a) {
    const pr = C.anmeldungPruefen(z, a), f = pr.fahrzeug, offen = ui.einOffen === a.id;
    const klassen = [...new Set(z.personen.map(p => p.klasse).filter(Boolean))].sort();
    let h = '<article class="fall' + (pr.gruen ? ' gruen' : '') + '"><header><b>Nr. ' + a.nr + '</b>' + typ(a.typ) + kz(a.kennzeichen) + '<span>' + esc(a.traeger || 'Träger fehlt') + '</span><span class="leise">' + zeitKurz(a.erstellt) + '</span>' +
      (f ? frnChip(f.funkrufname, f.wache) : '<span class="pille schlecht">ohne Kennung</span>') + '</header>';
    if (pr.gruende.length) h += '<ul class="gruende">' + pr.gruende.map(g => '<li>' + esc(g) + '</li>').join('') + '</ul>';
    else h += '<div class="hinweis gruen">Alles geklärt. Das Fahrzeug kann durchfahren.</div>';
    // Besatzung
    h += '<ul class="crew">' + pr.personen.map((p, i) => {
      let zeile = '<li><span class="' + (p.gefunden && !p.doppeltNr ? 'ok' : 'nein') + '" aria-hidden="true">' + (p.gefunden && !p.doppeltNr ? '✓' : '!') + '</span><div><b>' + esc(p.name) + '</b><small>' +
        (p.gefunden ? 'Klasse ' + esc(p.klasse || '–') + ' · ' + esc(p.traeger || 'ohne Träger') + (p.lj !== 3 ? ' · ' + p.lj + '. LJ' : '') : 'nicht in der Schülerliste') + (p.doppeltNr ? ' · auch in Nr. ' + p.doppeltNr : '') + '</small></div>' +
        (p.darfFahren ? '<span class="pille gut">darf fahren</span>' : '');
      const k = a.id + '-' + i, au = ui.aufnahme[k] || { klasse: '', lj: 3 };
      if (!p.gefunden) zeile += '<div class="zeile fall-aktion"><select data-act="auf-klasse" data-k="' + k + '" aria-label="Klasse"><option value="">Klasse …</option>' + klassen.map(c => '<option' + (au.klasse === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
        '<select data-act="auf-lj" data-k="' + k + '" aria-label="Ausbildungsjahr">' + [3, 2, 1].map(n => '<option value="' + n + '"' + (Number(au.lj) === n ? ' selected' : '') + '>' + n + '. LJ</option>').join('') + '</select>' +
        '<button class="knopf klein" data-act="rot-aufnehmen" data-aid="' + a.id + '" data-i="' + i + '">Aufnehmen</button><button class="knopf klein" data-act="rot-entfernen" data-aid="' + a.id + '" data-i="' + i + '">Entfernen</button></div>';
      else if (p.doppeltNr) zeile += '<button class="knopf klein" data-act="rot-entfernen" data-aid="' + a.id + '" data-i="' + i + '">Hier entfernen</button>';
      return zeile + '</li>';
    }).join('') + '</ul>';
    if (offen) {
      h += '<div class="fall-suche">' + namenSuche('rot', 'Person hinzufügen', 'Vor- oder Nachname', 'Hinzufügen');
      const st = nsZustand('rot');
      if (st.geladen && C.suchNorm(st.q).length >= 3) h += '<button class="knopf klein" data-act="rot-frei" data-aid="' + a.id + '">„' + esc(st.q.trim()) + '“ als neue Person eintragen</button>';
      h += '</div>';
    }
    // Fahrzeug
    if (!f) {
      const alleTraeger = [...new Set(z.fahrzeuge.map(x => x.traeger).filter(Boolean))].sort();
      h += '<div class="option-gruppe"><b>Fahrzeug zuordnen</b>';
      if (!a.traeger) h += '<label class="feld"><span>Träger</span><select data-act="rot-traeger" data-aid="' + a.id + '"><option value="">Bitte wählen …</option>' + alleTraeger.map(t => '<option>' + esc(t) + '</option>').join('') + '</select></label>';
      else {
        const o = C.ankunftOptionen(z, a.typ, a.traeger);
        const kn = (art, text, sub, empf, fid) => '<button class="option' + (empf ? ' empfohlen' : '') + '" data-act="rot-fz" data-aid="' + a.id + '" data-art="' + art + '"' + (fid ? ' data-fid="' + fid + '"' : '') + '><b>' + text + '</b><span>' + sub + '</span>' + (empf ? '<em>Empfohlen</em>' : '') + '</button>';
        h += '<span class="leise">' + esc(a.traeger) + ' hat ' + o.gemeldet + ' ' + a.typ + ' zugesagt, ' + o.da + ' sind da.' + (o.fehlendePlaetze > 0 ? ' Es fehlen ' + o.fehlendePlaetze + ' Sitzplätze.' : '') + '</span><div class="optionen">' +
          (o.freierPlatz ? kn('platz', 'Bekommt ' + esc(o.freierPlatz.funkrufname), 'Vorgeplanter Platz von ' + esc(a.traeger) + '.', true, o.freierPlatz.id) : '') +
          kn('zusatz', 'Zusätzlich einplanen als ' + esc(o.zusatz.funkrufname), 'Danach ab dem nächsten Durchgang neu planen.', !o.freierPlatz && o.empfehlung === 'zusatz') +
          kn('reserve', 'Als Reserve bereitstellen', 'Wird nicht eingeplant, lässt sich später aktivieren.', !o.freierPlatz && o.empfehlung === 'reserve') + '</div>';
        if (o.fremdeOffen.length) h += '<span class="leise">Oder Platz eines fehlenden Fahrzeugs übernehmen:</span><div class="zeile">' + o.fremdeOffen.slice(0, 10).map(x => '<button class="knopf klein" data-act="rot-fz" data-aid="' + a.id + '" data-art="uebernehmen" data-fid="' + x.id + '">' + frnChip(x.funkrufname, x.wache) + ' <span class="leise">' + esc(x.traeger) + '</span></button>').join('') + '</div>';
      }
      h += '</div>';
    } else if (!f.fahrerExtern && pr.personen.some(p => p.gefunden) && !pr.personen.some(p => p.darfFahren)) {
      h += '<div class="zeile"><button class="knopf" data-act="rot-extern" data-aid="' + a.id + '" data-fid="' + f.id + '">Fahrer:in kommt vom Träger (nicht aus dem Kurs)</button></div>';
    } else if (f.fahrerExtern) h += '<p class="leise">Fahrer:in kommt vom Träger. <button class="knopf klein" data-act="rot-extern" data-aid="' + a.id + '" data-fid="' + f.id + '">zurücknehmen</button></p>';
    h += '<footer class="zeile"><button class="knopf ' + (pr.gruen ? 'haupt' : '') + '" data-act="anm-durch" data-aid="' + a.id + '">' + (pr.gruen ? 'Durchfahren lassen' : 'Trotzdem durchfahren lassen') + '</button>' +
      (offen ? '' : '<button class="knopf" data-act="rot-offen" data-aid="' + a.id + '">Person hinzufügen</button>') + '<button class="knopf klein" data-act="anm-storno" data-aid="' + a.id + '">Anmeldung löschen</button></footer>';
    return h + '</article>';
  }

  function einfahrtRot(z, rot, wartet) {
    let h = '<div class="zeile" style="justify-content:space-between"><p>' + (rot.length ? rot.length + ' Fahrzeug(e) brauchen Klärung.' : 'Gerade ist niemand in der roten Spur.') + (wartet ? ' ' + wartet + ' grüne Anmeldung(en) warten noch auf die Fastlane.' : '') + '</p>' +
      '<a class="knopf" href="#anmeldung">Anmeldung für ein Fahrzeug erfassen</a></div>';
    // gerade geklärte Fälle bleiben sichtbar, bis sie durch sind
    if (ui.einOffen) ui.rotSichtbar.add(ui.einOffen);
    const liste = rot.slice();
    (z.anmeldungen || []).forEach(a => { if (ui.rotSichtbar.has(a.id) && a.status === 'offen' && !liste.includes(a)) liste.unshift(a); });
    h += liste.map(a => anmeldungKarte(z, a)).join('');
    h += '<section class="flaeche"><h3>QR-Code für die rote Spur und die Warteschlange</h3><div class="zeile" style="align-items:start;gap:20px"><div class="qr" data-qr="' + esc(zugangUrl('anmeldung')) + '"></div><div style="display:grid;gap:6px;min-width:0"><p>Darüber melden Besatzungen ihr Fahrzeug selbst an oder melden Leute nach. Als Schild drucken: <a href="#zettel">Zettel → QR-Schilder</a>.</p><p class="mono leise" style="word-break:break-all">' + esc(zugangUrl('anmeldung')) + '</p></div></div></section>';
    return h;
  }

  function einfahrtListe(z, anm) {
    const statusPille = a => { if (a.status === 'durch') return '<span class="pille gut">durch ' + zeitKurz(a.durch) + '</span>'; return C.anmeldungPruefen(z, a).gruen ? '<span class="pille">grün, wartet</span>' : '<span class="pille schlecht">rote Spur</span>'; };
    let h = '<section class="flaeche"><h3>Anmeldungen</h3>' + (anm.length ? '<div class="tabelle-box"><table><thead><tr><th>Nr.</th><th>Zeit</th><th>Kennzeichen</th><th>Kennung</th><th>Träger</th><th>Besatzung</th><th>Status</th></tr></thead><tbody>' +
      anm.slice().sort((a, b) => b.nr - a.nr).map(a => { const f = a.fid && z.fahrzeuge.find(x => x.id === a.fid); return '<tr><td class="mono">' + a.nr + '</td><td class="mono">' + zeitKurz(a.erstellt) + '</td><td>' + kz(a.kennzeichen) + '</td><td>' + (f ? frnChip(f.funkrufname, f.wache) : '–') + '</td><td>' + esc(a.traeger) + '</td><td class="mono">' + a.personen.length + '</td><td>' + statusPille(a) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' : '<p class="leise">Noch keine Anmeldungen.</p>') + '</section>';
    const tu = traegerUebersicht(z).filter(t => t.offen.length);
    h += '<section class="flaeche"><h3>Noch erwartet</h3>' + (tu.length ? '<div class="tabelle-box"><table><thead><tr><th>Träger</th><th>Fehlt noch</th></tr></thead><tbody>' +
      tu.map(t => '<tr><td>' + esc(t.traeger) + '</td><td><div class="zeile" style="gap:4px 14px">' + t.offen.map(f => '<span title="' + esc(f.typ + (f.kennzeichen ? ' ' + f.kennzeichen : '')) + '">' + frnChip(f.funkrufname, f.wache) + (f.anmeldung ? ' <span class="pille">angemeldet</span>' : '') + '</span>').join('') + '</div></td></tr>').join('') + '</tbody></table></div>'
      : '<p>Alle zugesagten Fahrzeuge sind da.</p>') + '</section>';
    return h;
  }

  function kennungKachel(f) {
    return '<div class="kennung" style="--wf:' + wfarbe(f.wache) + ';--wt:' + wtext(f.wache) + '"><small>' + (f.wache ? 'Wache ' + f.wache : 'Reserve') + '</small><b>' + esc(f.funkrufname) + '</b></div>';
  }

  function ankunftErgebnis(z) {
    const er = ank.ergebnis;
    const gelesenHinweis = (soll) => er.gelesen && soll && C.kzNorm(er.gelesen) !== C.kzNorm(soll) ? '<div class="leise">Gelesen: <span class="mono">' + esc(er.gelesen) + '</span>, zugeordnet zu <span class="mono">' + esc(soll) + '</span>.</div>' : '';
    if (er.art === 'gruen' || er.art === 'rot') {
      const a = (z.anmeldungen || []).find(x => x.id === er.aid); if (!a) return '';
      const pr = C.anmeldungPruefen(z, a), f = pr.fahrzeug;
      if (er.art === 'gruen') {
        return '<section class="ampel gruen"><div class="ampel-kopf"><b>' + (er.schonDurch ? 'War schon durch' : 'Durchfahren') + '</b><span>Nr. ' + a.nr + (er.schonDurch ? ' · ' + zeitKurz(a.durch) + ' Uhr' : ' · Fahrzeug ist da, Besatzung eingecheckt') + '</span></div>' +
          '<div class="zeile" style="gap:18px;align-items:center">' + (f ? kennungKachel(f) : '') + '<div style="display:grid;gap:6px;min-width:0"><div class="zeile">' + typ(a.typ) + kz((f && f.kennzeichen) || a.kennzeichen) + '<span>' + esc((f && f.traeger) || a.traeger) + '</span></div>' + gelesenHinweis((f && f.kennzeichen) || a.kennzeichen) +
          (f ? '<div class="leise">Zettel <b>' + esc(f.funkrufname) + '</b> hinter die Windschutzscheibe.</div>' : '') + '</div></div>' +
          '<p class="leise">Kurz vergleichen, ob diese Leute im Fahrzeug sitzen:</p>' + crewListe(z, pr) +
          '<div class="zeile">' + (er.schonDurch ? '' : '<button class="knopf klein" data-act="anm-zurueck" data-aid="' + a.id + '">Rückgängig</button>') + '<button class="knopf haupt" data-act="ank-neu">Nächstes Fahrzeug</button></div>' + (C.planVeraltet(z) ? planStatus() : '') + '</section>';
      }
      return '<section class="ampel rot"><div class="ampel-kopf"><b>Rote Spur</b><span>Nr. ' + a.nr + ' · bitte in die rote Spur fahren</span></div>' +
        '<ul class="gruende">' + pr.gruende.map(g => '<li>' + esc(g) + '</li>').join('') + '</ul>' + (f ? '<div class="zeile">' + kennungKachel(f) + '</div>' : '') + gelesenHinweis(a.kennzeichen) + crewListe(z, pr) +
        '<div class="zeile"><button class="knopf haupt" data-act="rot-klaeren" data-aid="' + a.id + '">Jetzt in der roten Spur klären</button><button class="knopf" data-act="anm-durch" data-aid="' + a.id + '">Trotzdem durchlassen</button><button class="knopf klein" data-act="ank-neu">Nächstes Fahrzeug</button></div></section>';
    }
    if (er.art === 'ohne') {
      const f = er.fid && z.fahrzeuge.find(x => x.id === er.fid);
      return '<section class="ampel rot"><div class="ampel-kopf"><b>Rote Spur</b><span>Keine Selbstanmeldung zu ' + esc(er.kennzeichen) + '</span></div>' +
        (f ? '<div class="zeile" style="gap:18px;align-items:center">' + kennungKachel(f) + '<div style="display:grid;gap:6px"><div class="zeile">' + typ(f.typ) + kz(f.kennzeichen) + '<span>' + esc(f.traeger) + '</span></div>' + gelesenHinweis(f.kennzeichen) + '<div class="leise">Fahrzeug steht in der Vorplanung, die Besatzung hat sich aber nicht angemeldet.</div></div></div>' : '<p>Das Kennzeichen steht nicht in der Vorplanung und es gibt keine Anmeldung dazu.</p>') +
        '<p>In der roten Spur scannt die Besatzung den QR-Code und meldet Fahrzeug und Leute an. Danach erscheint der Fall unter „Rote Spur“.</p>' +
        '<div class="zeile">' + (f ? '<button class="knopf" data-act="ank-ohne" data-fid="' + f.id + '">Ohne Anmeldung als „da“ erfassen</button>' : '<button class="knopf" data-act="ank-zuordnen">Fahrzeug trotzdem zuordnen</button>') + '<button class="knopf klein" data-act="ank-neu">Nächstes Fahrzeug</button></div></section>';
    }
    if (er.art === 'fertig') {
      const f = z.fahrzeuge.find(x => x.id === er.fid); if (!f) return '';
      return '<section class="flaeche ank-ok"><div class="zeile" style="gap:18px;align-items:center">' + kennungKachel(f) + '<div style="display:grid;gap:6px;min-width:0">' +
        '<div class="ok-gross" style="font-size:1.6rem">' + (er.schonDa ? 'War schon da' : f.status === 'reserve' ? 'Als Reserve erfasst' : '✓ Ist da') + '</div>' +
        '<div class="zeile">' + typ(f.typ) + kz(f.kennzeichen) + '<span>' + esc(f.traeger) + '</span></div>' +
        (er.gelesen && C.kzNorm(er.gelesen) !== C.kzNorm(f.kennzeichen) ? '<div class="leise">Gelesen: <span class="mono">' + esc(er.gelesen) + '</span>, zugeordnet zu <span class="mono">' + esc(f.kennzeichen) + '</span>.</div>' : '') +
        '<div class="leise">' + (f.status === 'reserve' ? 'Fährt in den Bereitstellungsraum und wird nicht eingeplant.' : 'Zettel <b>' + esc(f.funkrufname) + '</b> hinter die Windschutzscheibe.') + '</div>' +
        '<div class="zeile">' + (er.schonDa ? '' : '<button class="knopf klein" data-act="ank-undo">Rückgängig</button>') + '<button class="knopf klein" data-act="ank-neu">Nächstes Fahrzeug</button></div></div></div>' +
        (C.planVeraltet(z) ? planStatus() : '') + '</section>';
    }
    // Unbekanntes Kennzeichen: Typ und Träger wählen, dann Möglichkeiten
    const vorschlag = C.traegerVorschlag(z, er.kennzeichen);
    const alleTraeger = [...new Set(z.fahrzeuge.map(f => f.traeger).filter(Boolean))].sort();
    if (!ank.traeger && vorschlag.length === 1) ank.traeger = vorschlag[0];
    let h = '<section class="flaeche"><h3>' + kz(er.kennzeichen) + ' steht nicht in der Vorplanung</h3>' +
      '<div class="zeile">' + C.TYPEN.map(t => '<button class="knopf gross" data-act="ank-typ" data-typ="' + t + '" aria-pressed="' + (ank.typ === t) + '">' + t + '</button>').join('') + '</div>' +
      '<div class="feld"><span>Träger</span><div class="zeile">' + [...new Set(vorschlag.concat(alleTraeger))].slice(0, 16).map(t => '<button class="knopf klein" data-act="ank-traeger" data-v="' + esc(t) + '" aria-pressed="' + (ank.traeger === t) + '">' + (vorschlag.includes(t) ? '★ ' : '') + esc(t) + '</button>').join('') + '</div>' +
      '<input id="ank-tr" type="text" list="traeger-liste2" value="' + esc(ank.traeger) + '" placeholder="anderer Träger" aria-label="Träger"><datalist id="traeger-liste2">' + alleTraeger.map(t => '<option value="' + esc(t) + '"></option>').join('') + '</datalist></div>';
    if (!ank.traeger) return h + '<p class="leise">Träger wählen, dann zeigt die App, welche Kennung das Fahrzeug bekommt.</p></section>';
    const o = C.ankunftOptionen(z, ank.typ, ank.traeger);
    const knopf = (art, text, sub, empf, fid) => '<button class="option' + (empf ? ' empfohlen' : '') + '" data-act="ank-option" data-art="' + art + '"' + (fid ? ' data-fid="' + fid + '"' : '') + '><b>' + text + '</b><span>' + sub + '</span>' + (empf ? '<em>Empfohlen</em>' : '') + '</button>';
    if (o.freierPlatz) {
      h += '<p>' + esc(ank.traeger) + ' hat ' + o.gemeldet + ' ' + ank.typ + ' zugesagt, ' + o.da + ' sind da.</p>' +
        knopf('platz', 'Bekommt ' + esc(o.freierPlatz.funkrufname), 'Vorgeplanter Platz von ' + esc(ank.traeger) + ', Wache ' + o.freierPlatz.wache + '. Wird sofort als „ist da“ markiert.', true, o.freierPlatz.id);
    } else {
      h += '<div class="hinweis"><b>' + (o.gemeldet ? esc(ank.traeger) + ' hat ' + o.gemeldet + ' ' + ank.typ + ' zugesagt, dies ist Nummer ' + (o.da + 1) + '.' : esc(ank.traeger) + ' hat keinen ' + ank.typ + ' zugesagt.') + '</b> ' +
        (o.fehlendePlaetze > 0 ? 'Es fehlen ' + o.fehlendePlaetze + ' Sitzplätze für die Teilnehmenden, ein zusätzliches Fahrzeug hilft.' : 'Alle Teilnehmenden haben schon einen Platz.') + '</div>' +
        '<div class="optionen">' + knopf('zusatz', 'Zusätzlich einplanen als ' + esc(o.zusatz.funkrufname), 'Wache ' + o.zusatz.wache + '. Danach ab dem nächsten Durchgang neu planen.', o.empfehlung === 'zusatz') +
        knopf('reserve', 'Als Reserve bereitstellen', 'Bekommt eine R-Kennung, wird nicht eingeplant. Lässt sich später aktivieren.', o.empfehlung === 'reserve');
      if (o.fremdeOffen.length) {
        h += '<div class="option-gruppe"><b>Platz eines fehlenden Fahrzeugs übernehmen</b><span class="leise">Nur wenn sicher ist, dass das andere nicht mehr kommt. Der Plan bleibt dann unverändert.</span><div class="zeile">' +
          o.fremdeOffen.slice(0, 12).map(f => '<button class="knopf klein" data-act="ank-option" data-art="uebernehmen" data-fid="' + f.id + '">' + frnChip(f.funkrufname, f.wache) + ' <span class="leise">' + esc(f.traeger) + '</span></button>').join('') + '</div></div>';
      }
      h += '</div>';
    }
    return h + '</section>';
  }

  async function ankunftPruefen(text, gelesen) {
    ank.text = text; ank.traeger = ''; ank.ergebnis = null;
    if (!C.kzNorm(text)) { ank.ocr = 'Kein Kennzeichen erkannt. Bitte eintippen.'; return render(); }
    const z = await Store.voll();
    gelesen = gelesen || text;
    if (z.einstellungen.selbstanmeldung !== false) {
      const t = C.einfahrtSuchen(z, text), a = t && t.anmeldung;
      if (a) {
        if (a.status === 'durch') { ank.ergebnis = { art: 'gruen', aid: a.id, schonDurch: true, gelesen }; return neu(); }
        if (C.anmeldungPruefen(z, a).gruen) {
          const ok = await Store.aendern(zz => { const x = C.findeAnmeldung(zz, a.id); return x && C.anmeldungPruefen(zz, x).gruen ? C.anmeldungDurch(zz, a.id) : null; });
          ank.ergebnis = { art: ok ? 'gruen' : 'rot', aid: a.id, gelesen }; ank.ocr = ''; return neu();
        }
        ank.ergebnis = { art: 'rot', aid: a.id, gelesen }; return neu();
      }
      ank.ergebnis = { art: 'ohne', fid: t && t.fahrzeug ? t.fahrzeug.id : null, kennzeichen: text, gelesen }; return neu();
    }
    const t = C.fahrzeugZuKennzeichen(z, text);
    if (t) {
      const f = t.fahrzeug;
      if (f.status === 'da' || f.status === 'reserve') { ank.ergebnis = { art: 'fertig', fid: f.id, schonDa: true, gelesen }; await neu(); return; }
      await Store.aendern(zz => C.ankunftBestaetigen(zz, { art: 'treffer', fid: f.id }));
      ank.ergebnis = { art: 'fertig', fid: f.id, gelesen, vorher: f.status };
      ank.ocr = ''; await neu(); return;
    }
    ank.ergebnis = { art: 'unbekannt', kennzeichen: text };
    await neu();
  }

  /* ---- Kamera und Texterkennung (Tesseract, liegt auf dem eigenen Server) ---- */
  let ocrWorker = null;
  function skriptLaden(src) {
    return new Promise((ok, nein) => { if (window.Tesseract) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = nein; document.head.appendChild(s); });
  }
  async function ocrBereit() {
    if (ocrWorker) return ocrWorker;
    const basis = new URL('vendor/ocr/', document.baseURI).href;
    await skriptLaden(basis + 'tesseract.min.js');
    // Sprachdaten selbst laden: auf dem Server als .gz, in der Demo als Base64-Text
    let daten = null;
    try { const r = await fetch(basis + 'eng.traineddata.gz'); if (r.ok) daten = new Uint8Array(await r.arrayBuffer()); } catch (e) { /* weiter */ }
    if (!daten || daten[0] !== 31) {
      const r = await fetch(basis + 'eng.traineddata.b64.txt'); if (!r.ok) throw new Error('Sprachdaten fehlen');
      const bin = atob((await r.text()).trim()); daten = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) daten[i] = bin.charCodeAt(i);
    }
    ocrWorker = await window.Tesseract.createWorker([{ code: 'eng', data: daten }], 1, { workerPath: basis + 'worker.min.js', corePath: basis, workerBlobURL: false });
    await ocrWorker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ', preserve_interword_spaces: '1' });
    return ocrWorker;
  }

  function aufbereiten(quelle, sw, sh, ausschnitt) {
    // Ausschnitt [x,y,b,h] in Anteilen; Graustufen und Kontrast strecken, auf ~1400 px Breite skalieren
    const [ax, ay, ab, ah] = ausschnitt || [0, 0, 1, 1];
    const bx = sw * ax, by = sh * ay, bb = sw * ab, bh = sh * ah;
    const f = Math.min(3, 1400 / bb);
    const c = document.createElement('canvas'); c.width = Math.round(bb * f); c.height = Math.round(bh * f);
    const g = c.getContext('2d'); g.drawImage(quelle, bx, by, bb, bh, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    let min = 255, max = 0;
    for (let i = 0; i < p.length; i += 4) { const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; p[i] = v; if (v < min) min = v; if (v > max) max = v; }
    const sp = Math.max(1, max - min);
    for (let i = 0; i < p.length; i += 4) { const v = (p[i] - min) * 255 / sp; p[i] = p[i + 1] = p[i + 2] = v; }
    g.putImageData(d, 0, 0);
    return c;
  }

  const KZ_MUSTER = /\b([A-ZÄÖÜ]{1,3})[\s-]+([A-Z]{1,2})[\s-]*(\d{1,4})\s?([EH]?)\b/;
  function besterTreffer(texte) {
    const z = voll;
    const zeilen = texte.flatMap(t => String(t || '').toUpperCase().split(/\n/)).map(t => t.replace(/[^A-Z0-9ÄÖÜ\- ]/g, ' ').replace(/\s+/g, ' ').trim()).filter(t => t.length >= 4);
    for (const zl of zeilen) { const t = z && C.einfahrtSuchen(z, zl); if (t) return zl; }
    for (const zl of zeilen) { const m = zl.match(KZ_MUSTER); if (m) return m[1] + '-' + m[2] + ' ' + m[3] + m[4]; }
    return zeilen.sort((a, b) => b.length - a.length)[0] || '';
  }

  async function erkennen(bild, sw, sh, nurRahmen) {
    ank.ocr = 'Erkenne Kennzeichen …'; ank.ergebnis = null; render();
    try {
      const w = await ocrBereit();
      const texte = [];
      if (nurRahmen) {
        texte.push((await w.recognize(aufbereiten(bild, sw, sh, [0.1, 0.39, 0.8, 0.22]), { tessedit_pageseg_mode: '7' })).data.text);
      } else {
        texte.push((await w.recognize(aufbereiten(bild, sw, sh, [0.05, 0.3, 0.9, 0.4]))).data.text);
        if (!C.kzNorm(besterTreffer(texte))) texte.push((await w.recognize(aufbereiten(bild, sw, sh))).data.text);
      }
      const kzText = besterTreffer(texte);
      ank.ocr = kzText ? 'Gelesen: ' + kzText : 'Kein Kennzeichen erkannt. Bitte näher ran oder eintippen.';
      if (kzText) await ankunftPruefen(kzText, kzText); else render();
    } catch (e) {
      ank.ocr = 'Die Texterkennung ist hier nicht verfügbar. Bitte das Kennzeichen eintippen.'; render();
    }
  }

  async function kameraStart() {
    try {
      ank.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      ank.kamera = 'an'; render();
      const v = document.getElementById('kamera-video'); if (v) { v.srcObject = ank.stream; await v.play().catch(() => {}); }
    } catch (e) {
      ank.kamera = null; ank.ocr = 'Kamera nicht verfügbar. Nimm „Foto“ oder tippe das Kennzeichen ein.'; render();
    }
  }
  function kameraStopp() { if (ank.stream) ank.stream.getTracks().forEach(t => t.stop()); ank.stream = null; ank.kamera = null; }
  function kameraNachRender() { const v = document.getElementById('kamera-video'); if (v && ank.stream && v.srcObject !== ank.stream) { v.srcObject = ank.stream; v.play().catch(() => {}); } }

  /* ================= Kennungs-Zettel ================= */
  function viewZettel() {
    if (!Store.orga) { ui.orgaTab = 'lage'; return viewOrga(); }
    if (!voll) return '<p class="leise">Lade Daten …</p>';
    const z = voll, e = z.einstellungen, S = e.stationen.length;
    const aus = ui.zettelAuswahl || 'alle', fmt = ui.zettelFormat || 'a4';
    const liste = z.fahrzeuge.filter(f => f.status !== 'abgemeldet' && f.status !== 'defekt')
      .filter(f => aus === 'alle' || (aus === 'da' ? f.status === 'da' : aus === 'R' ? f.status === 'reserve' : f.wache === Number(aus)))
      .sort((a, b) => (a.wache || 99) - (b.wache || 99) || ['RTW', 'KTW', 'NEF'].indexOf(a.typ) - ['RTW', 'KTW', 'NEF'].indexOf(b.typ) || a.nr - b.nr);
    const art = ui.zettelArt || 'kennung';
    let h = '<div class="seitenkopf nicht-drucken"><div><div class="eyebrow">Zum Ausdrucken</div><h1>' + (art === 'schilder' ? 'QR-Schilder' : 'Kennungs-Zettel') + '</h1></div><p>' + (art === 'schilder' ? 'Schilder für Warteschlange, rote Spur und Eingang. Die QR-Codes enthalten den Zugangsschlüssel.' : 'Ein Zettel pro Fahrzeug für die Windschutzscheibe. Die Farbe steht für die Wache.') + '</p></div>';
    h += '<div class="tabs nicht-drucken" role="tablist">' + [['kennung', 'Kennungs-Zettel'], ['schilder', 'QR-Schilder']].map(([v, t]) => '<button role="tab" data-act="zettel-art" data-v="' + v + '" aria-selected="' + (art === v) + '">' + t + '</button>').join('') + '</div>';
    if (art === 'schilder') return h + qrSchilder(e);
    h += '<section class="flaeche nicht-drucken"><div class="zeile"><span class="leise">Welche:</span>' +
      [['alle', 'Alle'], ['da', 'Nur angekommene']].concat(Array.from({ length: S }, (_, i) => [String(i + 1), 'Wache ' + (i + 1)])).concat([['R', 'Reserve']])
        .map(([v, t]) => '<button class="knopf klein" data-act="zettel-aus" data-v="' + v + '" aria-pressed="' + (aus === v) + '">' + (/^\d$/.test(v) ? '<i class="wpunkt" style="background:' + wfarbe(Number(v)) + '"></i>' : '') + t + '</button>').join('') + '</div>' +
      '<div class="zeile"><span class="leise">Inhalt:</span><button class="knopf klein" data-act="zettel-blanko" aria-pressed="' + !!ui.zettelBlanko + '">Träger und Kennzeichen leer lassen (zum Ausfüllen)</button></div>' +
      '<div class="zeile"><span class="leise">Format:</span><button class="knopf klein" data-act="zettel-fmt" data-v="a4" aria-pressed="' + (fmt === 'a4') + '">A4 quer, 1 pro Blatt</button><button class="knopf klein" data-act="zettel-fmt" data-v="a5" aria-pressed="' + (fmt === 'a5') + '">A5, 2 pro Blatt</button></div>' +
      '<div class="zeile">' + (window.SIMTAG_DEMO ? '<span class="leise">Drucken geht in der Demo nicht, auf dem SimTag-Server schon.</span>' : '<button class="knopf haupt" data-act="drucken">' + liste.length + ' Zettel drucken</button>') +
      '<span class="leise">Farben: ' + Array.from({ length: S }, (_, i) => '<i class="wpunkt" style="background:' + wfarbe(i + 1) + '"></i>Wache ' + (i + 1) + ' ' + WACHE_NAMEN[i]).join(' · ') + '</span></div>' +
      '<p class="leise">Im Druckdialog „Hintergrundgrafiken“ einschalten, damit die Farben mitgedruckt werden.</p></section>';
    h += '<div class="zettel-bogen ' + fmt + '">' + liste.map(f => {
      const w = f.wache;
      return '<article class="zettel" style="--wf:' + wfarbe(w) + ';--wt:' + wtext(w) + '"><header>' + (w ? 'WACHE ' + w + ' · ' + WACHE_NAMEN[(w - 1) % WACHE_NAMEN.length].toUpperCase() : 'RESERVE') + '<span>' + esc(e.titel) + '</span></header>' +
        '<div class="zettel-kennung">' + esc(f.funkrufname) + '</div>' +
        '<footer><span class="zettel-typ">' + esc(f.typ) + '</span><span>Träger: <b>' + esc((!ui.zettelBlanko && f.traeger) || '____________________') + '</b></span><span>Kennzeichen: <b>' + esc((!ui.zettelBlanko && f.kennzeichen) || '________________') + '</b></span></footer></article>';
    }).join('') + '</div>';
    return h;
  }

  function qrSchilder(e) {
    const schild = (farbe, titel, schritte, route, unten) => '<article class="schild" style="--sf:' + farbe + '"><header>' + esc(e.titel) + '</header><h2>' + titel + '</h2><div class="schild-mitte"><div class="qr" data-qr="' + esc(zugangUrl(route)) + '" data-qr-groesse="520"></div>' +
      '<ol>' + schritte.map(x => '<li>' + x + '</li>').join('') + '</ol></div><footer>' + unten + '</footer></article>';
    let h = '<section class="flaeche nicht-drucken"><div class="zeile">' + (window.SIMTAG_DEMO ? '<span class="leise">Drucken geht in der Demo nicht, und die QR-Codes zeigen hier auf die Demo. Auf dem SimTag-Server führen sie auf die echte Seite.</span>' : '<button class="knopf haupt" data-act="drucken">Schilder drucken</button><span class="leise">A4 hoch, ein Schild pro Blatt.</span>') + '</div></section>';
    h += '<div class="schilder">' +
      schild('#1f6f3a', 'Fahrzeug anmelden', ['QR-Code mit dem Handy scannen', 'Fahrzeug und alle Personen im Fahrzeug eintragen', 'Bildschirm an der Kontrolle zeigen', 'Grün: Fastlane. Rot: rote Spur.'], 'anmeldung', 'Warteschlange an der Einfahrt') +
      schild('#c62828', 'Rote Spur: nachmelden', ['QR-Code scannen', 'Fehlendes Fahrzeug oder fehlende Personen eintragen', 'Wer schon angemeldet ist: „Fahrzeug oder Besatzung ändern“', 'Die Orga klärt den Rest mit euch'], 'anmeldung', 'Rote Spur') +
      schild('#15212c', 'Mein Plan und Check-in', ['QR-Code scannen', 'Namen eintippen und auswählen', '„Ich bin da“ antippen', 'Vor jedem Durchgang noch einmal reinschauen'], 'plan', 'Eingang, Mimen und Beobachtung') + '</div>';
    return h;
  }

  /* ================= Rendern ================= */
  async function laden() {
    pub = await Store.oeffentlich();
    if (Store.orga) { try { voll = await Store.voll(); } catch (e) { if (e.status === 401) Store.abmelden(); voll = null; } } else voll = null;
    if (ui.route === 'plan' && ui.ich) { try { mein = (await Store.meinId(ui.ich)) || false; } catch (e) { mein = e.status === 404 ? false : null; } } else mein = null;
    if (ui.route === 'anmeldung' && meineAnm) {
      try { anmBest = await Store.anmeldungLaden(meineAnm.id, meineAnm.token); }
      catch (e) { if (e.status === 404) { meineAnm = null; ls.del('simtag-anmeldung'); anmBest = null; } }
    } else if (!meineAnm) anmBest = null;
  }

  function render() {
    const fokus = document.activeElement && document.activeElement.id;
    const sel = fokus && document.activeElement.selectionStart;
    const view = { plan: viewPlan, lage: viewLage, stationen: viewStationen, checkin: viewCheckin, anmeldung: viewAnmeldung, orga: viewOrga, ankunft: viewAnkunft, zettel: viewZettel }[ui.route] || viewPlan;
    document.getElementById('app').innerHTML = rahmen(view());
    if (fokus) { const el = document.getElementById(fokus); if (el) { el.focus(); try { if (sel != null && el.setSelectionRange) el.setSelectionRange(sel, sel); } catch (e) { /* egal */ } } }
    kameraNachRender();
    if (window.QRCode) document.querySelectorAll('[data-qr]').forEach(el => {
      const g = Number(el.dataset.qrGroesse) || 180;
      el.innerHTML = ''; new window.QRCode(el, { text: el.dataset.qr, width: g, height: g, correctLevel: window.QRCode.CorrectLevel.M });
    });
  }

  async function neu() { await laden(); render(); }

  function route() {
    ui.checkinMeldung = ''; ui.fzMeldung = '';
    const h = (location.hash || '').replace('#', '').split(/[/?]/)[0];
    if (h !== 'ankunft') kameraStopp();
    ui.route = ROUTEN.some(r => r[0] === h) ? h : 'plan';
    neu();
  }

  function waehleIch(id) { ui.ich = id; ls.set('simtag-ich', id); nsZuruecksetzen('plan'); return neu(); }

  /* ================= Ereignisse ================= */
  document.addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      if (f.id === 'plan-suche') { const st = nsZustand('plan'); if (st.treffer.length === 1) waehleIch(st.treffer[0].id); return; }
      if (f.id === 'anf-form') return anmeldungAbschicken();
      if (f.id === 'checkin-form') {
        const w = ui.checkinWahl; if (!w) { const st = nsZustand('checkin'); if (st.treffer.length === 1) { ui.checkinWahl = st.treffer[0]; render(); } return; }
        const r = await Store.eincheckenId(w.id).catch(() => null);
        ui.checkinMeldung = r ? '<div class="hinweis gruen"><div class="ok-gross">✓ Willkommen, ' + esc(r.name.split(' ')[0]) + '</div>' + (r.neu ? 'Du bist eingecheckt.' : 'Du warst schon eingecheckt.') + ' <a href="#plan">Zu deinem Plan</a></div>'
          : '<div class="hinweis rot">Das hat nicht geklappt. Bitte den QR-Code noch einmal scannen oder am Eingang nachfragen.</div>';
        if (r) { ui.ich = r.id; ls.set('simtag-ich', r.id); ui.checkinWahl = null; nsZuruecksetzen('checkin'); }
        render();
      }
      if (f.id === 'login-form') {
        try { await Store.anmelden($('#pw').value); await neu(); } catch (e) { $('#login-fehler').innerHTML = '<div class="hinweis rot">' + esc(e.message || 'Anmeldung fehlgeschlagen') + '</div>'; }
      }
      if (f.id === 'ank-form') { const t = $('#ank-kz').value.trim(); ank.ocr = ''; return ankunftPruefen(t, null); }
      if (f.id === 'vp-form') {
        const tr = $('#vp-tr').value.trim(); if (!tr) return toast('Bitte einen Träger eintragen.');
        const anz = {}; C.TYPEN.forEach(t => { anz[t] = Number($('#vp-' + t).value) || 0; });
        const r = await Store.aendern(z => C.vorplanungSetzen(z, tr, anz));
        ui.fzMeldung = '<div class="hinweis gruen">' + esc(tr) + ': ' + C.TYPEN.map(t => anz[t] + ' ' + t).join(', ') + ' gespeichert (' + r.neu + ' neu, ' + r.entfernt + ' entfernt).</div>';
        return neu();
      }
      if (f.id === 'einst-form') {
        const num = id => Number($('#' + id).value);
        await Store.aendern(z => {
          const e = z.einstellungen;
          e.datum = $('#e-datum').value; e.ort = $('#e-ort').value; e.ersteWelle = num('e-welle'); e.nefPosition = num('e-nef'); e.anfahrtMin = num('e-anfahrt');
          e.alarmRaster = $('#e-raster').value.split(/[,; ]+/).map(Number).filter(n => !isNaN(n));
          e.schminkenVorher = num('e-schminken'); e.treffenVorher = num('e-treffen');
          C.TYPEN.forEach(t => { const a = num('b-' + t + '-0'), b = num('b-' + t + '-1'); e.besatzung[t] = [Math.min(a, b), Math.max(a, b)]; });
          e.durchgaenge.forEach((d, i) => { d.start = $('#d-' + i + '-s').value; d.ende = $('#d-' + i + '-e').value; });
          e.stationen.forEach((s, i) => { s.name = $('#s-' + i + '-n').value; s.patienten = num('s-' + i + '-p'); });
          e.fahrgruppen = C.fahrgruppenAusText($('#e-fahrgruppen').value);
          e.selbstanmeldung = $('#e-selbst').checked;
        });
        toast('Einstellungen gespeichert'); await neu();
      }
    } catch (e) { toast(e.message || 'Das hat nicht geklappt.'); }
  });

  document.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (b.tagName === 'SELECT' || (b.tagName === 'INPUT' && b.type === 'checkbox')) return;
    try {
      if (act === 'ns-wahl') {
        const ctx = b.dataset.ctx, wahl = { id: b.dataset.id, name: b.dataset.name, klasse: b.dataset.klasse, lj: b.dataset.lj };
        if (ctx === 'plan') return waehleIch(wahl.id);
        if (ctx === 'checkin') { ui.checkinWahl = wahl; ui.checkinMeldung = ''; return render(); }
        if (ctx === 'anm') { if (!anf.personen.some(x => x.id === wahl.id)) anf.personen.push(wahl); nsZuruecksetzen('anm'); render(); const i = $('#ns-anm'); if (i) i.focus(); return; }
        if (ctx === 'rot') { const aid = ui.einOffen; await Store.aendern(z => { const a = C.findeAnmeldung(z, aid); if (a && !a.personen.some(x => x.pid === wahl.id)) a.personen.push({ pid: wahl.id }); }); nsZuruecksetzen('rot'); toast(wahl.name + ' hinzugefügt'); return neu(); }
        return;
      }
      if (act === 'ich-weg') { ui.ich = ''; ls.del('simtag-ich'); mein = null; nsZuruecksetzen('plan'); return render(); }
      if (act === 'selbst-checkin') { await Store.eincheckenId(ui.ich); toast('Du bist eingecheckt'); return neu(); }
      if (act === 'checkin-anders') { ui.checkinWahl = null; nsZuruecksetzen('checkin'); render(); const i = $('#ns-checkin'); if (i) i.focus(); return; }
      // Fahrzeug-Anmeldung (Handy der Besatzung)
      if (act === 'anf-typ') { anf.typ = b.dataset.typ; return render(); }
      if (act === 'anf-weg') { anf.personen.splice(Number(b.dataset.i), 1); return render(); }
      if (act === 'anf-frei') { const q = nsZustand('anm').q.replace(/\s+/g, ' ').trim(); if (q) anf.personen.push({ name: q }); nsZuruecksetzen('anm'); return render(); }
      if (act === 'anf-bearbeiten') {
        const x = anmBest; anf = anfLeer(); anf.bearbeiten = true; anf.typ = x.typ; anf.kennzeichen = x.kennzeichen || '';
        anf.traeger = (pub.traeger || []).includes(x.traeger) ? x.traeger : (x.traeger ? '__anders' : ''); anf.traegerFrei = (pub.traeger || []).includes(x.traeger) ? '' : x.traeger || '';
        anf.personen = x.personen.map(q => (q.id ? { id: q.id, name: q.name, klasse: q.klasse } : { name: q.name }));
        return render();
      }
      if (act === 'anf-abbrechen') { anf = anfLeer(); return render(); }
      if (act === 'anf-neu') { if (!confirm('Neue Anmeldung für ein anderes Fahrzeug? Die bisherige bleibt bei der Orga bestehen.')) return; meineAnm = null; anmBest = null; ls.del('simtag-anmeldung'); anf = anfLeer(); return render(); }
      // Einfahrt
      if (act === 'ein-tab') { ui.einTab = id; return render(); }
      if (act === 'anm-durch') {
        const aid = b.dataset.aid;
        await Store.aendern(z => C.anmeldungDurch(z, aid));
        if (ui.einOffen === aid) ui.einOffen = null;
        ank.ergebnis = { art: 'gruen', aid }; ui.einTab = 'fastlane'; toast('Durchgefahren'); return neu();
      }
      if (act === 'anm-zurueck') { await Store.aendern(z => C.anmeldungZurueck(z, b.dataset.aid)); ank.ergebnis = null; toast('Rückgängig gemacht'); return neu(); }
      if (act === 'anm-storno') { if (!confirm('Anmeldung löschen?')) return; await Store.aendern(z => C.anmeldungStornieren(z, b.dataset.aid)); toast('Anmeldung gelöscht'); return neu(); }
      if (act === 'rot-klaeren') { ui.einTab = 'rot'; ui.einOffen = b.dataset.aid; ui.rotSichtbar.add(b.dataset.aid); nsZuruecksetzen('rot'); return render(); }
      if (act === 'rot-offen') { ui.einOffen = b.dataset.aid; nsZuruecksetzen('rot'); render(); const i = $('#ns-rot'); if (i) i.focus(); return; }
      if (act === 'rot-entfernen') { ui.rotSichtbar.add(b.dataset.aid); await Store.aendern(z => C.anmeldungPersonEntfernen(z, b.dataset.aid, Number(b.dataset.i))); return neu(); }
      if (act === 'rot-aufnehmen') {
        const k = b.dataset.aid + '-' + b.dataset.i, au = ui.aufnahme[k] || { klasse: '', lj: 3 };
        ui.rotSichtbar.add(b.dataset.aid);
        const pn = await Store.aendern(z => C.anmeldungPersonAufnehmen(z, b.dataset.aid, Number(b.dataset.i), au));
        toast(pn ? pn.name + ' aufgenommen (' + pn.lj + '. LJ' + (pn.klasse ? ', ' + pn.klasse : '') + ')' : 'Nicht möglich'); return neu();
      }
      if (act === 'rot-frei') { const q = nsZustand('rot').q.replace(/\s+/g, ' ').trim(), aid = b.dataset.aid; if (!q) return; await Store.aendern(z => { const a = C.findeAnmeldung(z, aid); if (a) a.personen.push({ frei: q }); }); nsZuruecksetzen('rot'); return neu(); }
      if (act === 'rot-extern') { if (b.dataset.aid) ui.rotSichtbar.add(b.dataset.aid); await Store.aendern(z => { const f = z.fahrzeuge.find(x => x.id === b.dataset.fid); if (f) f.fahrerExtern = !f.fahrerExtern; }); return neu(); }
      if (act === 'rot-fz') {
        const aid = b.dataset.aid, art = b.dataset.art, fid = b.dataset.fid;
        await Store.aendern(z => { const a = C.findeAnmeldung(z, aid); if (!a) return; const f = C.ankunftBestaetigen(z, { art, fid, typ: a.typ, traeger: a.traeger, kennzeichen: a.kennzeichen }); if (f) C.anmeldungFahrzeugSetzen(z, aid, f.id); });
        ui.einOffen = aid; toast('Fahrzeug zugeordnet'); return neu();
      }
      if (act === 'ank-ohne') {
        const fid = b.dataset.fid;
        await Store.aendern(z => C.ankunftBestaetigen(z, { art: 'treffer', fid }));
        ank.ergebnis = { art: 'fertig', fid, gelesen: ank.ergebnis && ank.ergebnis.gelesen }; return neu();
      }
      if (act === 'ank-zuordnen') { ank.ergebnis = { art: 'unbekannt', kennzeichen: ank.ergebnis.kennzeichen }; return render(); }
      if (act === 'station') { ui.station = id; return render(); }
      if (act === 'tab') { ui.orgaTab = id; return render(); }
      if (act === 'abmelden') { Store.abmelden(); voll = null; return render(); }
      if (act === 'lj') { ui.filterLj = Number(b.dataset.lj); return render(); }
      if (act === 'plan-d') { ui.planD = Number(b.dataset.i); return render(); }
      if (act === 'fz-filter') { ui.fzFilter = b.dataset.v; return render(); }
      if (act === 'vp-import') {
        const zeilen = $('#vp-import').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        const n = await Store.aendern(z => { let k = 0; zeilen.forEach(l => { const t = l.split(/[;\t]/).map(x => x.trim()); if (!t[0] || /^tr(ä|ae)ger$/i.test(t[0])) return; C.vorplanungSetzen(z, t[0], { RTW: t[1], KTW: t[2], NEF: t[3] }); k++; }); return k; });
        toast(n + ' Träger übernommen'); return neu();
      }
      if (act === 'kamera-start') return kameraStart();
      if (act === 'kamera-stopp') { kameraStopp(); return render(); }
      if (act === 'kamera-foto') {
        const v = $('#kamera-video'); if (!v || !v.videoWidth) return;
        const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
        return erkennen(c, c.width, c.height, true);
      }
      if (act === 'ank-typ') { ank.typ = b.dataset.typ; return render(); }
      if (act === 'ank-traeger') { ank.traeger = b.dataset.v; return render(); }
      if (act === 'ank-neu') { ank.ergebnis = null; ank.text = ''; ank.ocr = ''; ank.traeger = ''; render(); const i = $('#ank-kz'); if (i) i.focus(); return; }
      if (act === 'ank-option') {
        const art = b.dataset.art, fid = b.dataset.fid, kzT = ank.ergebnis && ank.ergebnis.kennzeichen;
        const f = await Store.aendern(z => C.ankunftBestaetigen(z, { art, fid, typ: ank.typ, traeger: ank.traeger, kennzeichen: kzT }));
        ank.ergebnis = { art: 'fertig', fid: f.id, neuAngelegt: art === 'zusatz' || art === 'reserve' };
        return neu();
      }
      if (act === 'ank-undo') {
        const er = ank.ergebnis;
        await Store.aendern(z => {
          const f = z.fahrzeuge.find(x => x.id === er.fid); if (!f) return;
          if (er.neuAngelegt) z.fahrzeuge.splice(z.fahrzeuge.indexOf(f), 1); else { f.status = 'gemeldet'; f.registriert = null; }
        });
        ank.ergebnis = null; toast('Rückgängig gemacht'); return neu();
      }
      if (act === 'zettel-aus') { ui.zettelAuswahl = b.dataset.v; return render(); }
      if (act === 'zettel-blanko') { ui.zettelBlanko = !ui.zettelBlanko; return render(); }
      if (act === 'zettel-fmt') { ui.zettelFormat = b.dataset.v; return render(); }
      if (act === 'drucken') { window.print(); return; }
      if (act === 'fz-typ') { ui.fzTyp = b.dataset.typ; document.querySelectorAll('[data-act="fz-typ"]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); return; }
      if (act === 'planen') {
        const ab = Number(b.dataset.ab);
        await Store.aendern(z => C.planen(z, ab));
        toast(ab > 0 ? 'Ab Durchgang ' + (ab + 1) + ' neu geplant' : 'Plan erstellt'); return neu();
      }
      if (act === 'p-checkin' || act === 'p-checkout') {
        await Store.aendern(z => { const p = z.personen.find(x => x.id === id); if (p) p.eingecheckt = act === 'p-checkin' ? new Date().toISOString() : null; });
        return neu();
      }
      if (act === 'zugang-neu') {
        if (!confirm('Neuen Schlüssel erzeugen? Alle bisher verteilten Links und QR-Codes funktionieren dann nicht mehr.')) return;
        await Store.aendern(z => { z.zugang = C.zufallsText(10); }); toast('Neuer Schlüssel erzeugt. QR-Schilder neu drucken.'); return neu();
      }
      if (act === 'zettel-schilder') { ui.zettelArt = 'schilder'; return; }
      if (act === 'zettel-art') { ui.zettelArt = b.dataset.v; return render(); }
      if (act === 'import') {
        const zeilen = $('#import').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const n = await Store.aendern(z => {
          const codes = new Set(z.personen.map(p => p.code)); let k = 0;
          zeilen.forEach(l => {
            const t = l.split(/[;\t]/).map(s => s.trim());
            if (!t[0] || /^name$/i.test(t[0])) return;
            const lj = Number(t[2]) || 3;
            z.personen.push({ id: C.uid('p'), name: t[0], klasse: t[1] || '', lj: [1, 2, 3].includes(lj) ? lj : 3, traeger: t[3] || '', code: C.neuerCode(codes), eingecheckt: null, status: 'angemeldet' });
            k++;
          });
          C.wachenVerteilen(z, true); C.gruppenVerteilen(z, 2); C.gruppenVerteilen(z, 1);
          return k;
        });
        toast(n + ' Personen eingefügt'); return neu();
      }
      if (act === 'wachen-neu') {
        await Store.aendern(z => { C.wachenVerteilen(z, false); C.gruppenVerteilen(z, 2); C.gruppenVerteilen(z, 1); C.planen(z, 0); });
        toast('Wachen und Gruppen neu verteilt, Plan neu erstellt'); return neu();
      }
      if (act === 'codes-csv') {
        const z = voll;
        const csv = 'Name;Klasse;LJ;Träger;Wache/Gruppe;Code\n' + z.personen.map(p => [p.name, p.klasse, p.lj, p.traeger, p.lj === 3 ? 'Wache ' + p.wache : 'Gruppe ' + gruppeBuchst(p.gruppe), p.code].join(';')).join('\n');
        return datei('simtag-codes.csv', '﻿' + csv, 'text/csv');
      }
      if (act === 'export') return datei('simtag-daten-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(voll, null, 1), 'application/json');
      if (act === 'demo-reset') { Store.demoZuruecksetzen(); toast('Demo-Daten neu erzeugt'); return neu(); }
      if (act === 'karte-weg') { await Store.aendern(z => { delete z.einstellungen.karteBild; }); return neu(); }
    } catch (e) { toast(e.message || 'Das hat nicht geklappt.'); }
  });

  document.addEventListener('change', async ev => {
    const el = ev.target, act = el.dataset.act;
    try {
      if (act === 'fz-status') {
        await Store.aendern(z => {
          const f = z.fahrzeuge.find(x => x.id === el.dataset.id); if (!f) return;
          if (f.status === 'reserve' && el.value !== 'reserve') { C.reserveAktivieren(z, f.id); f.status = el.value; return; }
          f.status = el.value; if (el.value === 'da') f.registriert = new Date().toISOString();
        });
        return neu();
      }
      if (act === 'fz-kz') { await Store.aendern(z => { const f = z.fahrzeuge.find(x => x.id === el.dataset.id); if (f) f.kennzeichen = el.value.trim().toUpperCase(); }); return neu(); }
      if (el.id === 'ank-tr') { ank.traeger = el.value.trim(); return render(); }
      if (el.id === 'anf-tr') { anf.traeger = el.value; return render(); }
      if (act === 'auf-klasse' || act === 'auf-lj') { const k = el.dataset.k; ui.aufnahme[k] = Object.assign({ klasse: '', lj: 3 }, ui.aufnahme[k], act === 'auf-klasse' ? { klasse: el.value } : { lj: Number(el.value) }); return; }
      if (act === 'rot-traeger' && el.value) { const aid = el.dataset.aid; await Store.aendern(z => { const a = C.findeAnmeldung(z, aid); if (a) { a.traeger = el.value; C.fahrzeugVerknuepfen(z, a); } }); ui.einOffen = aid; return neu(); }
      if (act === 'fz-extern') { await Store.aendern(z => { const f = z.fahrzeuge.find(x => x.id === el.dataset.id); if (f) f.fahrerExtern = el.checked; }); return neu(); }
      if (el.id === 'kz-foto' && el.files[0]) {
        const url = URL.createObjectURL(el.files[0]); const img = new Image();
        img.onload = () => { erkennen(img, img.naturalWidth, img.naturalHeight, false); URL.revokeObjectURL(url); };
        img.onerror = () => { ank.ocr = 'Das Foto ließ sich nicht öffnen.'; render(); };
        img.src = url; return;
      }
      if (act === 'p-status') { await Store.aendern(z => { const p = z.personen.find(x => x.id === el.dataset.id); if (p) p.status = el.value; }); return neu(); }
      if (act === 'nur-eingecheckte') { await Store.aendern(z => { z.einstellungen.nurEingecheckte = el.checked; }); return neu(); }
      if (el.id === 'karte-bild' && el.files[0]) {
        const bild = await verkleinern(el.files[0], 1600);
        await Store.aendern(z => { z.einstellungen.karteBild = bild; }); toast('Lageplan gespeichert'); return neu();
      }
    } catch (e) { toast(e.message || 'Das hat nicht geklappt.'); }
  });

  document.addEventListener('input', ev => {
    if (ev.target.id === 'simzeit') {
      ui.simZeit = Number(ev.target.value);
      const t = $('#simzeit-text'); if (t) t.textContent = C.minZuZeit(ui.simZeit);
      if (ui.route === 'lage' || ui.route === 'plan') { clearTimeout(ui.tz); ui.tz = setTimeout(render, 30); }
    }
    if (ev.target.id === 'fz-suche') { ui.fzSuche = ev.target.value; clearTimeout(ui.ts); ui.ts = setTimeout(render, 200); }
    const ctx = ev.target.dataset && ev.target.dataset.ns;
    if (ctx) { const st = nsZustand(ctx); st.q = ev.target.value; st.geladen = false; clearTimeout(st.t); st.t = setTimeout(() => nsSuchen(ctx), 220); }
    if (ev.target.id === 'anf-kz') anf.kennzeichen = ev.target.value;
    if (ev.target.id === 'anf-tr-frei') anf.traegerFrei = ev.target.value;
    if (ev.target.id === 'ank-kz') ank.text = ev.target.value;
    if (ev.target.id === 'suche') { ui.suche = ev.target.value; clearTimeout(ui.ts); ui.ts = setTimeout(render, 200); }
  });

  function verkleinern(file, maxB) {
    return new Promise((ok, nein) => {
      const r = new FileReader();
      r.onload = () => {
        const img = new Image();
        img.onload = () => {
          const f = Math.min(1, maxB / img.width), c = document.createElement('canvas');
          c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          ok(c.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = nein; img.src = r.result;
      };
      r.onerror = nein; r.readAsDataURL(file);
    });
  }

  // Ziehen auf der Lagekarte (nur Orga)
  document.addEventListener('pointerdown', ev => {
    const g = ev.target.closest('[data-ziehen]'); if (!g || !Store.orga || ui.route !== 'lage') return;
    const svg = g.closest('svg'); ui.ziehen = { was: g.dataset.ziehen, svg, g };
    g.setPointerCapture && g.setPointerCapture(ev.pointerId); ev.preventDefault();
  });
  document.addEventListener('pointermove', ev => {
    if (!ui.ziehen) return;
    const r = ui.ziehen.svg.getBoundingClientRect();
    const x = Math.max(0.03, Math.min(0.97, (ev.clientX - r.left) / r.width)), y = Math.max(0.05, Math.min(0.95, (ev.clientY - r.top) / r.height));
    ui.ziehen.pos = { x, y };
    ui.ziehen.g.setAttribute('transform', 'translate(' + ((x - start(ui.ziehen.was).x) * KW) + ' ' + ((y - start(ui.ziehen.was).y) * KH) + ')');
  });
  function start(was) { const e = pub.einstellungen; if (was === 'eingang') return e.eingang; if (was === 'bereitstellung') return e.bereitstellung; return e.stationen[Number(was.split(':')[1])]; }
  document.addEventListener('pointerup', async () => {
    const z = ui.ziehen; ui.ziehen = null; if (!z || !z.pos) return;
    await Store.aendern(st => {
      const e = st.einstellungen, ziel = z.was === 'eingang' ? e.eingang : z.was === 'bereitstellung' ? e.bereitstellung : e.stationen[Number(z.was.split(':')[1])];
      ziel.x = Math.round(z.pos.x * 1000) / 1000; ziel.y = Math.round(z.pos.y * 1000) / 1000;
    }).catch(e => toast(e.message));
    neu();
  });

  /* ================= Start ================= */
  (async function startApp() {
    await Store.init();
    const q = new URLSearchParams(location.search);
    if (q.get('z')) { Store.zugang = q.get('z').toUpperCase().replace(/[^A-Z0-9]/g, ''); ls.set('simtag-zugang', Store.zugang); }
    if (q.get('c')) { try { const m = await Store.mein(q.get('c')); if (m) { ui.ich = m.id; ls.set('simtag-ich', m.id); } } catch (e) { /* egal */ } }
    if (q.get('z') || q.get('c')) { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* egal */ } }
    if (Store.modus === 'demo') ui.simZeit = 622;
    else { try { const p0 = await Store.oeffentlich(); if (p0.demo) ui.simZeit = 622; } catch (e) { /* egal */ } }
    Store.abonnieren(() => { if (!ui.ziehen) neu(); });
    window.addEventListener('hashchange', route);
    route();
    // Lagekarte und „läuft“-Anzeige mitlaufen lassen
    setInterval(() => { if (ui.route === 'lage' && ui.simZeit == null && !ui.ziehen) render(); }, 10000);
  })();
})();
