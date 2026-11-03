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
  const DEMO_KEY = 'simtag2027-demo-v1';
  const DEMO_PASSWORT = 'simtag2027';
  const Store = {
    modus: 'demo', schluessel: null, hoerer: [], demoZ: null,
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
    async einchecken(code) {
      if (this.modus === 'server') return this.api('checkin', { method: 'POST', body: { code } });
      const r = C.einchecken(this.demoZ, code); if (r) { this.demoZ.version++; this.speichereDemo(); this.melden(); } return r;
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
    route: 'plan', code: ls.get('simtag-code') || '', station: 'S1', orgaTab: 'lage', planD: 0,
    filterLj: 3, suche: '', simZeit: null, ziehen: null, fzTyp: 'RTW', meldung: null
  };
  let pub = null, voll = null, mein = null;

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
  const kz = k => k ? '<span class="kz"><b>' + esc(k) + '</b></span>' : '<span class="leise">ohne Kennzeichen</span>';
  const typ = t => '<span class="typ ' + esc(t) + '">' + esc(t) + '</span>';
  const station = (e, id) => e.stationen.find(s => s.id === id) || { id, name: id, kurz: id };
  const ljName = { 3: '3. Ausbildungsjahr', 2: '2. Ausbildungsjahr', 1: '1. Ausbildungsjahr' };
  const ljRolle = { 3: 'Besatzung RTW/KTW/NEF', 2: 'Verletztendarstellung', 1: 'Reserve und Beobachtung' };
  const gruppeBuchst = g => String.fromCharCode(64 + (g || 0));
  const datumLang = d => { try { return new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return d; } };

  /* ================= Rahmen ================= */
  const ROUTEN = [['plan', 'Mein Plan'], ['lage', 'Lagekarte'], ['stationen', 'Stationen'], ['checkin', 'Check-in'], ['orga', 'Orga']];
  function rahmen(inhalt) {
    const e = pub.einstellungen;
    const demo = Store.modus === 'demo' || pub.demo;
    const zeit = ui.simZeit != null ? ui.simZeit : 622;
    return '<header class="kopf"><div class="kopf-innen"><div class="marke"><i></i><b>' + esc(e.titel) + '</b><span>' + esc(datumLang(e.datum)) + ' · ' + esc(e.ort) + '</span></div><nav aria-label="Bereiche">' +
      ROUTEN.map(([id, t]) => '<a href="#' + id + '"' + (ui.route === id ? ' aria-current="page"' : '') + '>' + t + '</a>').join('') + '</nav></div></header>' +
      (demo ? '<div class="demo-band"><div><span>Demo mit erfundenen Daten. Nichts davon sind echte Personen.</span>' +
        '<label for="simzeit">Simulierte Uhrzeit <input id="simzeit" type="range" min="420" max="1080" step="1" value="' + Math.round(zeit) + '"> <b class="mono" id="simzeit-text">' + C.minZuZeit(zeit) + '</b></label></div></div>' : '') +
      '<main id="inhalt">' + inhalt + '</main>';
  }

  /* ================= Mein Plan ================= */
  function viewPlan() {
    const e = pub.einstellungen;
    let h = '<div class="seitenkopf"><div><div class="eyebrow">Persönlicher Ablauf</div><h1>Mein Plan</h1></div>' +
      '<p>Gib deinen persönlichen Code ein. Er steht auf deiner Teilnahmekarte.</p></div>';
    h += '<form class="flaeche" id="code-form"><div class="zeile"><label class="feld" for="code"><span>Dein Code</span>' +
      '<input id="code" class="code-eingabe" type="text" maxlength="8" autocomplete="off" autocapitalize="characters" value="' + esc(ui.code) + '" placeholder="ABC123"></label>' +
      '<button class="knopf haupt" type="submit">Plan anzeigen</button>' + (ui.code ? '<button class="knopf" type="button" data-act="code-weg">Code vergessen</button>' : '') + '</div>';
    if (Store.modus === 'demo') {
      const z = Store.demoZ, bsp = [3, 2, 1].map(l => z.personen.find(p => p.lj === l && p.status !== 'krank'));
      h += '<div class="zeile leise">Beispielcodes zum Ausprobieren: ' + bsp.map(p => '<button class="knopf klein" type="button" data-act="bsp" data-code="' + p.code + '">' + p.code + ' · ' + p.lj + '. LJ</button>').join('') + '</div>';
    }
    h += '</form>';
    if (ui.code && mein === false) h += '<div class="hinweis rot">Zu diesem Code gibt es keinen Eintrag. Prüfe die Schreibweise (0 und O, 1 und I gibt es nicht).</div>';
    if (mein) h += meinAblauf(e, mein);
    return h;
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
          '<div class="zeile">' + typ(z.typ) + '<span class="frn">' + esc(z.funkrufname) + '</span>' + kz(z.kennzeichen) + '<span class="leise">' + esc(z.traeger) + '</span></div>' +
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
    const url = checkinUrl();
    let h = '<div class="seitenkopf"><div><div class="eyebrow">Am Eingang</div><h1>Check-in</h1></div><p>Bestätige mit deinem Code, dass du da bist. Erst dann wirst du am Tag fest eingeplant.</p></div>';
    h += '<form class="flaeche" id="checkin-form"><div class="zeile"><label class="feld" for="checkin-code"><span>Dein Code</span><input id="checkin-code" class="code-eingabe" type="text" maxlength="8" autocomplete="off" value="' + esc(ui.code) + '" placeholder="ABC123"></label>' +
      '<button class="knopf haupt gross" type="submit">Ich bin da</button></div><div id="checkin-ergebnis">' + (ui.checkinMeldung || '') + '</div></form>';
    if (Store.orga) h += '<section class="flaeche"><h3>QR-Code für den Eingang</h3><p class="leise">Ausdrucken und am Eingang aufhängen. Er führt direkt auf diese Seite.</p><div class="qr" id="qr-eingang"></div><p class="mono leise">' + esc(url) + '</p></section>';
    return h;
  }
  function checkinUrl() {
    const basis = location.href.split('#')[0].split('?')[0];
    return basis + '#checkin';
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
        h += '<tr class="' + (f.erste ? 'erste' : '') + '"><td class="mono">' + C.minZuZeit(start + f.minute) + '</td><td class="mono">+' + f.minute + '</td><td class="frn">' + esc(f.funkrufname) + '</td><td>' + typ(f.typ) + '</td><td>' + kz(f.kennzeichen) + '</td><td>' + esc(f.traeger) + '</td><td>' + esc(bes) + '</td></tr>';
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
      '<label class="zeile" for="nur-ein"><input id="nur-ein" type="checkbox" data-act="nur-eingecheckte"' + (e.nurEingecheckte ? ' checked' : '') + '> Nur eingecheckte Teilnehmende einplanen (am SimTag einschalten)</label></section>';
    h += '<section class="flaeche"><h3>Fahrzeuge</h3><div class="raster" style="grid-template-columns:repeat(3,1fr)">' + kart(k.RTW, 'RTW') + kart(k.KTW, 'KTW') + kart(k.NEF, 'NEF') + '</div>' +
      '<p class="leise">' + z.fahrzeuge.filter(f => f.status === 'da').length + ' vor Ort angemeldet, ' + z.fahrzeuge.filter(f => f.status === 'gemeldet').length + ' nur vorab gemeldet, ' + z.fahrzeuge.filter(f => f.status === 'defekt' || f.status === 'abgemeldet').length + ' fallen aus.</p></section>';
    const proD = Math.min(k.tn, k.max);
    h += '<section class="flaeche"><h3>Rechnung je Durchgang</h3><p>' + k.tn + ' Teilnehmende im 3. LJ, ' + k.min + ' bis ' + k.max + ' Sitzplätze. ' +
      (k.tn > k.max ? 'Pro Durchgang fahren ' + proD + ', ' + (k.tn - k.max) + ' beobachten.' : k.tn < k.min ? '<b>Zu wenige Leute:</b> einige Fahrzeuge bleiben unbesetzt.' : 'Alle fahren in jedem Durchgang.') + '</p>' +
      '<p class="leise">Erste Welle: ' + k.ersteSitze + ' Plätze über den Tag. ' + (k.ersteSitze >= k.tn ? 'Das reicht, damit jede Person mindestens einmal vorne fährt.' : 'Das reicht nicht für alle. Erste Welle in den Einstellungen vergrößern.') + '</p></section>';
    h += '</div>';
    h += '<section class="flaeche"><h3>Check-in am Eingang</h3><div class="zeile" style="align-items:start;gap:20px"><div class="qr" id="qr-eingang"></div><div style="display:grid;gap:8px;min-width:0"><p>Diesen QR-Code am Eingang aufhängen. Teilnehmende scannen ihn und geben ihren Code ein.</p><p class="mono leise" style="word-break:break-all">' + esc(checkinUrl()) + '</p>' +
      '<label class="feld" for="orga-checkin"><span>Für jemanden einchecken (Code)</span><input id="orga-checkin" type="text" class="mono" maxlength="8" placeholder="ABC123"></label><button class="knopf" data-act="orga-checkin">Einchecken</button></div></div></section>';
    return h;
  }

  function orgaFahrzeuge() {
    const z = voll;
    const traeger = [...new Set(z.fahrzeuge.map(f => f.traeger).concat(z.personen.map(p => p.traeger)).filter(Boolean))].sort();
    let h = planStatus();
    h += '<form class="flaeche" id="fz-form"><h3>Fahrzeug anmelden</h3><div class="zeile">' + C.TYPEN.map(t => '<button type="button" class="knopf gross" data-act="fz-typ" data-typ="' + t + '" aria-pressed="' + (ui.fzTyp === t) + '">' + t + '</button>').join('') + '</div>' +
      '<div class="raster"><label class="feld" for="fz-kz"><span>Kennzeichen</span><input id="fz-kz" type="text" autocomplete="off" placeholder="GT-RD 9012" class="mono"></label>' +
      '<label class="feld" for="fz-tr"><span>Träger</span><input id="fz-tr" type="text" list="traeger-liste" autocomplete="off" placeholder="Kreis Gütersloh"></label></div>' +
      '<datalist id="traeger-liste">' + traeger.map(t => '<option value="' + esc(t) + '"></option>').join('') + '</datalist>' +
      '<div class="zeile"><button class="knopf haupt" type="submit">Fahrzeug ist da</button><span class="leise">Die App ordnet es einer Wache zu und vergibt den Funkrufnamen.</span></div><div id="fz-ergebnis">' + (ui.fzMeldung || '') + '</div></form>';
    const liste = z.fahrzeuge.slice().sort((a, b) => a.wache - b.wache || a.typ.localeCompare(b.typ) || a.nr - b.nr);
    h += '<section class="flaeche"><h3>Alle Fahrzeuge (' + liste.length + ')</h3><div class="tabelle-box"><table><thead><tr><th>Funkrufname</th><th>Typ</th><th>Kennzeichen</th><th>Träger</th><th>Wache</th><th>Status</th></tr></thead><tbody>' +
      liste.map(f => '<tr class="' + (f.status === 'defekt' || f.status === 'abgemeldet' ? 'aus' : '') + '"><td class="frn">' + esc(f.funkrufname) + '</td><td>' + typ(f.typ) + '</td><td>' + kz(f.kennzeichen) + '</td><td>' + esc(f.traeger) + '</td><td>' + f.wache + '</td><td>' +
        '<select data-act="fz-status" data-id="' + f.id + '" aria-label="Status ' + esc(f.funkrufname) + '">' + [['gemeldet', 'vorab gemeldet'], ['da', 'vor Ort'], ['defekt', 'defekt'], ['abgemeldet', 'abgemeldet']].map(([v, t]) => '<option value="' + v + '"' + (f.status === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></td></tr>').join('') +
      '</tbody></table></div></section>';
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
      liste.map(p => '<tr class="' + (p.status === 'krank' || p.status === 'abgemeldet' ? 'aus' : '') + '"><td>' + esc(p.name) + '</td><td>' + esc(p.klasse) + '</td><td>' + esc(p.traeger) + '</td><td>' + (p.lj === 3 ? p.wache || '–' : gruppeBuchst(p.gruppe)) + '</td><td class="mono">' + esc(p.code) + '</td><td>' +
        '<select data-act="p-status" data-id="' + p.id + '" aria-label="Status ' + esc(p.name) + '">' + [['angemeldet', 'angemeldet'], ['krank', 'krank'], ['abgemeldet', 'abgemeldet']].map(([v, t]) => '<option value="' + v + '"' + (p.status === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></td><td>' +
        (p.eingecheckt ? '<button class="knopf klein" data-act="p-checkout" data-id="' + p.id + '">✓ ' + new Date(p.eingecheckt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + '</button>' : '<button class="knopf klein" data-act="p-checkin" data-id="' + p.id + '">einchecken</button>') + '</td></tr>').join('') +
      '</tbody></table></div></section>';
    h += '<section class="flaeche"><h3>Teilnehmende einfügen</h3><p class="leise">Aus Excel kopieren und hier einfügen, eine Person pro Zeile: <span class="mono">Name; Klasse; Ausbildungsjahr; Träger</span>. Codes werden automatisch vergeben.</p>' +
      '<textarea id="import" placeholder="Muster, Lena;24A;3;Kreis Gütersloh"></textarea><div class="zeile"><button class="knopf haupt" data-act="import">Einfügen</button>' +
      (window.SIMTAG_DEMO ? '' : '<button class="knopf" data-act="codes-csv">Codeliste herunterladen (CSV)</button>') + '<button class="knopf" data-act="wachen-neu">Wachen und Gruppen neu verteilen</button></div>' +
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
        ei.fahrzeuge.map(f => '<tr class="' + (f.erste ? 'erste' : '') + '"><td class="mono">' + C.minZuZeit(start + f.minute) + '</td><td><span class="frn">' + esc(f.funkrufname) + '</span></td><td>' + kz(f.kennzeichen) + '</td><td>' + esc(name(f.fahrer)) + (f.fahrerFremd ? ' <span class="pille warn" title="Niemand aus der Besatzung kommt vom Träger des Fahrzeugs">fremder Träger</span>' : '') + '</td><td>' + f.besatzung.filter(x => x !== f.fahrer).map(name).map(esc).join(', ') + '</td></tr>').join('') +
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
    h += '<p class="leise">So verteilt die App: Wer bisher am wenigsten gefahren ist, fährt zuerst. Die Plätze der ersten Welle bekommen die, die am seltensten vorne waren. Die NEF-Plätze bekommen die, die noch nie NEF hatten. Fahrer:in wird möglichst jemand vom Träger des Fahrzeugs. Niemand sitzt zweimal auf demselben Fahrzeug, wenn es sich vermeiden lässt.</p>';
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
    h += '<div class="zeile"><button class="knopf haupt" type="submit">Einstellungen speichern</button><span class="leise">Danach den Plan neu erstellen.</span></div></form>';
    h += '<section class="flaeche"><h3>Lageplan des Geländes</h3><p class="leise">Ein Bild vom LAFP-Gelände (Screenshot aus einer Karte oder ein Lageplan) als Hintergrund der Lagekarte. Danach Stationen auf der Lagekarte an die richtige Stelle ziehen.</p>' +
      '<div class="zeile"><input id="karte-bild" type="file" accept="image/*" aria-label="Lageplan hochladen">' + (e.karteBild ? '<button class="knopf klein" data-act="karte-weg">Bild entfernen</button>' : '') + '</div></section>';
    h += '<section class="flaeche"><h3>Daten</h3><div class="zeile">' + (window.SIMTAG_DEMO ? '' : '<button class="knopf" data-act="export">Alles als Datei sichern (JSON)</button>') +
      (Store.modus === 'demo' ? '<button class="knopf" data-act="demo-reset">Demo-Daten neu erzeugen</button>' : '') + '</div></section>';
    return h;
  }

  /* ================= Rendern ================= */
  async function laden() {
    pub = await Store.oeffentlich();
    if (Store.orga) { try { voll = await Store.voll(); } catch (e) { if (e.status === 401) Store.abmelden(); voll = null; } } else voll = null;
    if (ui.route === 'plan' && ui.code) { try { mein = (await Store.mein(ui.code)) || false; } catch (e) { mein = false; } } else mein = null;
  }

  function render() {
    const fokus = document.activeElement && document.activeElement.id;
    const sel = fokus && document.activeElement.selectionStart;
    const view = { plan: viewPlan, lage: viewLage, stationen: viewStationen, checkin: viewCheckin, orga: viewOrga }[ui.route] || viewPlan;
    document.getElementById('app').innerHTML = rahmen(view());
    if (fokus) { const el = document.getElementById(fokus); if (el) { el.focus(); try { if (sel != null && el.setSelectionRange) el.setSelectionRange(sel, sel); } catch (e) { /* egal */ } } }
    const qr = document.getElementById('qr-eingang');
    if (qr && window.QRCode) { qr.innerHTML = ''; new window.QRCode(qr, { text: checkinUrl(), width: 180, height: 180, correctLevel: window.QRCode.CorrectLevel.M }); }
  }

  async function neu() { await laden(); render(); }

  function route() {
    ui.checkinMeldung = ''; ui.fzMeldung = '';
    const h = (location.hash || '').replace('#', '');
    ui.route = ROUTEN.some(r => r[0] === h) ? h : 'plan';
    neu();
  }

  /* ================= Ereignisse ================= */
  document.addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      if (f.id === 'code-form') { ui.code = $('#code').value.trim().toUpperCase(); ls.set('simtag-code', ui.code); await neu(); }
      if (f.id === 'checkin-form') {
        const code = $('#checkin-code').value.trim().toUpperCase();
        const r = await Store.einchecken(code).catch(() => null);
        ui.checkinMeldung = r ? '<div class="hinweis gruen"><div class="ok-gross">✓ Willkommen, ' + esc(r.name.split(' ')[0]) + '</div>' + (r.neu ? 'Du bist eingecheckt.' : 'Du warst schon eingecheckt.') + ' <a href="#plan">Zu deinem Plan</a></div>'
          : '<div class="hinweis rot">Code nicht gefunden. Prüfe die Schreibweise oder frag am Eingang nach.</div>';
        if (r) { ui.code = code; ls.set('simtag-code', code); }
        render();
      }
      if (f.id === 'login-form') {
        try { await Store.anmelden($('#pw').value); await neu(); } catch (e) { $('#login-fehler').innerHTML = '<div class="hinweis rot">' + esc(e.message || 'Anmeldung fehlgeschlagen') + '</div>'; }
      }
      if (f.id === 'fz-form') {
        const kzW = $('#fz-kz').value.trim(), tr = $('#fz-tr').value.trim();
        if (!kzW || !tr) { ui.fzMeldung = '<div class="hinweis rot">Bitte Kennzeichen und Träger eintragen.</div>'; return render(); }
        const typW = ui.fzTyp;
        const fz = await Store.aendern(z => {
          const da = z.fahrzeuge.find(x => C.norm(x.kennzeichen) === C.norm(kzW));
          if (da) { da.status = 'da'; da.registriert = new Date().toISOString(); da.typ = typW; da.traeger = tr; return da; }
          return C.fahrzeugHinzufuegen(z, { typ: typW, kennzeichen: kzW, traeger: tr, status: 'da' });
        });
        ui.fzMeldung = '<div class="hinweis gruen">' + typ(fz.typ) + ' ' + kz(fz.kennzeichen) + ' ist angemeldet als <b class="frn" style="font-size:1.2rem">' + esc(fz.funkrufname) + '</b> (Wache ' + fz.wache + '). Plan danach neu erstellen.</div>';
        await neu();
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
      if (act === 'bsp') { ui.code = b.dataset.code; ls.set('simtag-code', ui.code); return neu(); }
      if (act === 'code-weg') { ui.code = ''; ls.del('simtag-code'); mein = null; return render(); }
      if (act === 'selbst-checkin') { await Store.einchecken(ui.code); toast('Du bist eingecheckt'); return neu(); }
      if (act === 'station') { ui.station = id; return render(); }
      if (act === 'tab') { ui.orgaTab = id; return render(); }
      if (act === 'abmelden') { Store.abmelden(); voll = null; return render(); }
      if (act === 'lj') { ui.filterLj = Number(b.dataset.lj); return render(); }
      if (act === 'plan-d') { ui.planD = Number(b.dataset.i); return render(); }
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
      if (act === 'orga-checkin') {
        const code = $('#orga-checkin').value; const r = await Store.einchecken(code);
        toast(r ? r.name + ' ist eingecheckt' : 'Code nicht gefunden'); return neu();
      }
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
      if (act === 'fz-status') { await Store.aendern(z => { const f = z.fahrzeuge.find(x => x.id === el.dataset.id); if (f) f.status = el.value; }); return neu(); }
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
    if (q.get('c')) { ui.code = q.get('c').toUpperCase(); ls.set('simtag-code', ui.code); }
    if (Store.modus === 'demo') ui.simZeit = 622;
    else { try { const p0 = await Store.oeffentlich(); if (p0.demo) ui.simZeit = 622; } catch (e) { /* egal */ } }
    Store.abonnieren(() => { if (!ui.ziehen) neu(); });
    window.addEventListener('hashchange', route);
    route();
    // Lagekarte und „läuft“-Anzeige mitlaufen lassen
    setInterval(() => { if (ui.route === 'lage' && ui.simZeit == null && !ui.ziehen) render(); }, 10000);
  })();
})();
