/* Erfundene Beispieldaten – keine echten Personen. */
(function (root) {
  'use strict';
  function demoZustand(Core) {
    const z = Core.leererZustand();
    const r = Core.rng(4711);
    const pick = a => a[Math.floor(r() * a.length)];
    const vor = ['Lena','Jonas','Mia','Paul','Emma','Finn','Lea','Ben','Hannah','Luca','Sophie','Elias','Marie','Noah','Lina','Tim','Clara','Jan','Anna','Moritz','Laura','Felix','Johanna','Nils','Greta','Tom','Ida','Lukas','Pia','Max','Nora','Erik','Frieda','Ole','Thea','Jakob','Carla','Henrik','Merle','David'];
    const nach = ['Brinkmann','Wessel','Kötter','Meier','Schröder','Hagedorn','Lohmann','Tiemann','Bökamp','Strothmann','Höner','Pieper','Wiemann','Kleinesudeik','Sudbrock','Upmeier','Brune','Diekmann','Ostermann','Vahle','Bergmann','Koch','Lückemeier','Niehaus','Rahe','Thiele','Venker','Wöstmann','Ahlers','Busche'];
    const traeger = ['BF Bielefeld','Kreis Gütersloh','Kreis Herford','Kreis Lippe','Kreis Höxter','Kreis Soest','BF Hamm','BF Münster','FW Herford','Rettungsdienst gGmbH','BIEKRA','FW Düsseldorf'];
    const codes = new Set();
    const klassen3 = ['24A','24B','24C','24D','24E','24F','24G'];
    const klassen2 = ['25A','25B','25C','25D','25E','25F'];
    const klassen1 = ['26A','26B','26C','26D','26E'];
    const benutzt = new Set();
    const name = () => { for (;;) { const n = pick(vor) + ' ' + pick(nach); if (!benutzt.has(n)) { benutzt.add(n); return n; } } };
    const add = (lj, klassen, n) => { for (let i = 0; i < n; i++) z.personen.push({ id: Core.uid('p'), name: name(), klasse: klassen[i % klassen.length], lj, traeger: pick(traeger), code: Core.neuerCode(codes, r), eingecheckt: null, status: 'angemeldet' }); };
    add(3, klassen3, 170); add(2, klassen2, 110); add(1, klassen1, 90);
    const kz = { 'BF Bielefeld':'BI-FW', 'Kreis Gütersloh':'GT-RD', 'Kreis Herford':'HF-RD', 'Kreis Lippe':'LIP-BS', 'Kreis Höxter':'HX-KL', 'Kreis Soest':'SO-RD', 'BF Hamm':'HAM-FW', 'BF Münster':'MS-FW', 'FW Herford':'HF-BF', 'Rettungsdienst gGmbH':'BI-RD', 'BIEKRA':'BI-KT', 'FW Düsseldorf':'D-US' };
    const fz = (typ, n) => { for (let i = 0; i < n; i++) { const t = pick(traeger); Core.fahrzeugHinzufuegen(z, { typ, traeger: t, kennzeichen: r() < 0.6 ? kz[t] + ' ' + (100 + Math.floor(r() * 900)) : '', registriert: null, status: 'gemeldet' }); } };
    fz('RTW', 32); fz('KTW', 6); fz('NEF', 10);
    Core.wachenVerteilen(z, false); Core.gruppenVerteilen(z, 2); Core.gruppenVerteilen(z, 1);
    Core.planen(z, 0);
    // Beispiel-Anmeldungen aus der Warteschlange: zwei grün, eine schon durch, zwei für die rote Spur
    const e = z.einstellungen, jetzt = Date.parse(e.datum + 'T07:05:00');
    const zeit = m => new Date(jetzt + m * 60000).toISOString();
    const mitKz = z.fahrzeuge.filter(f => f.kennzeichen && f.typ === 'RTW');
    const crew = (f, n) => z.personen.filter(p => p.lj === 3 && !z.anmeldungen.some(a => a.personen.some(x => x.pid === p.id)) && Core.darfFahren(e, p, f)).slice(0, 1)
      .concat(z.personen.filter(p => p.lj === 3 && !Core.darfFahren(e, p, f) && !z.anmeldungen.some(a => a.personen.some(x => x.pid === p.id))).slice(0, n - 1));
    const anm = (f, leute, extra, m) => Core.anmeldungSpeichern(z, { typ: f.typ, kennzeichen: f.kennzeichen, traeger: f.traeger, personen: leute.map(p => ({ id: p.id })).concat(extra || []) }, zeit(m)).anmeldung;
    if (mitKz.length >= 5) {
      Core.anmeldungDurch(z, anm(mitKz[0], crew(mitKz[0], 3), null, 0).id, zeit(4));
      anm(mitKz[1], crew(mitKz[1], 3), null, 6);
      anm(mitKz[2], crew(mitKz[2], 2), null, 8);
      anm(mitKz[3], crew(mitKz[3], 2), [{ name: 'Kim Beispielname' }], 9);
      const fremd = mitKz[4];
      Core.anmeldungSpeichern(z, { typ: 'RTW', kennzeichen: 'HX-AB 777', traeger: 'Kreis Höxter', personen: crew(fremd, 2).map(p => ({ id: p.id })) }, zeit(11));
    }
    z.demo = true;
    return z;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = demoZustand; else root.demoZustand = demoZustand;
})(typeof window !== 'undefined' ? window : globalThis);
