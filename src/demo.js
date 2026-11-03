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
    z.demo = true;
    return z;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = demoZustand; else root.demoZustand = demoZustand;
})(typeof window !== 'undefined' ? window : globalThis);
