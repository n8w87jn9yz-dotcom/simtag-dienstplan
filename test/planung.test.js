/* Prüft die Planungslogik mit erfundenen Daten: node test/planung.test.js */
const assert = require('assert');
const C = require('../src/core.js'), demo = require('../src/demo.js');

const z = demo(C);
let g = C.gerechtigkeit(z);
const spanne = v => { const k = Object.keys(v).map(Number); return Math.max(...k) - Math.min(...k); };
assert.strictEqual(g.anzahl, 170);
assert.ok(spanne(g.einsaetze) <= 1, 'Einsätze pro Person unterscheiden sich um höchstens 1');
assert.ok(g.ohneErste.length <= 3, 'fast alle sind mindestens einmal in der ersten Welle');
const nefPlaetze = z.plan.durchgaenge.flatMap(d => d.einsaetze.flatMap(e => e.fahrzeuge)).filter(f => f.typ === 'NEF').reduce((s, f) => s + f.besatzung.length, 0);
// NEF doppelt nur, wenn alle einmal dran waren – oder weil die Person das NEF fahren musste (nur ihre Fahrgruppe darf es fahren)
const nefDoppelt = Object.keys(g.statistik).filter(id => g.statistik[id].nef > 1);
assert.ok(nefPlaetze > g.anzahl || nefDoppelt.every(id => z.plan.durchgaenge.some(d => d.einsaetze.some(e => e.fahrzeuge.some(f => f.typ === 'NEF' && f.fahrer === id)))), 'NEF erst doppelt, wenn alle einmal dran waren');

// Niemand sitzt im selben Durchgang zweimal
z.plan.durchgaenge.forEach(d => {
  const ids = d.einsaetze.flatMap(e => e.fahrzeuge.flatMap(f => f.besatzung));
  assert.strictEqual(ids.length, new Set(ids).size);
});

// Umplanen am Tag: Fahrzeuge fallen aus, Leute krank – frühere Durchgänge bleiben gleich
const vorher = JSON.stringify(z.plan.durchgaenge.slice(0, 2));
z.fahrzeuge.slice(0, 3).forEach(f => { f.status = 'defekt'; });
z.personen.filter(p => p.lj === 3).slice(0, 15).forEach(p => { p.status = 'krank'; });
assert.ok(C.planVeraltet(z));
C.planen(z, 2);
assert.ok(!C.planVeraltet(z));
assert.strictEqual(JSON.stringify(z.plan.durchgaenge.slice(0, 2)), vorher);
const krank = new Set(z.personen.filter(p => p.status === 'krank').map(p => p.id));
z.plan.durchgaenge.slice(2).forEach(d => d.einsaetze.forEach(e => e.fahrzeuge.forEach(f => {
  assert.ok(!f.besatzung.some(id => krank.has(id)), 'Kranke werden nicht eingeplant');
  assert.ok(!['defekt', 'abgemeldet'].includes(z.fahrzeuge.find(x => x.id === f.fid).status), 'Defekte Fahrzeuge fahren nicht');
})));

// Öffentliche Sicht enthält keine Namen und keine Codes
const pub = JSON.stringify(C.oeffentlich(z));
assert.ok(!z.personen.some(p => pub.includes(p.name) || pub.includes('"' + p.code + '"')));

// Check-in über Code
const p = z.personen.find(x => !x.eingecheckt);
assert.ok(C.einchecken(z, p.code.toLowerCase()).neu);
assert.ok(!C.einchecken(z, p.code).neu);
assert.strictEqual(C.einchecken(z, 'XXXXXX'), null);

g = C.gerechtigkeit(z);
console.log('ok · Einsätze', g.einsaetze, '· erste Welle', g.erste, '· NEF', g.nef);

// Fahrzeug-Ankunft
{
  const z2 = demo(C);
  const mitKz = z2.fahrzeuge.find(f => f.kennzeichen);
  const gelesen = mitKz.kennzeichen.replace(/[- ]/g, '').replace(/\d$/, 'B');      // Lesefehler: 8 als B
  const t = C.fahrzeugZuKennzeichen(z2, gelesen);
  assert.ok(t && t.fahrzeug.id === mitKz.id, 'ungenau gelesenes Kennzeichen wird zugeordnet');
  C.ankunftBestaetigen(z2, { art: 'treffer', fid: mitKz.id });
  assert.strictEqual(mitKz.status, 'da');
  assert.strictEqual(C.fahrzeugZuKennzeichen(z2, 'ZZ-QQ 1'), null);

  // Träger schickt mehr Fahrzeuge als zugesagt
  const tr = mitKz.traeger;
  let o = C.ankunftOptionen(z2, 'RTW', tr), n = 0;
  while (o.freierPlatz && n < 20) { C.ankunftBestaetigen(z2, { art: 'platz', fid: o.freierPlatz.id, kennzeichen: 'XX-AA ' + n }); o = C.ankunftOptionen(z2, 'RTW', tr); n++; }
  assert.strictEqual(o.freierPlatz, null);
  assert.ok(/^\d-RTW-\d+$/.test(o.zusatz.funkrufname));
  const zus = C.ankunftBestaetigen(z2, { art: 'zusatz', typ: 'RTW', traeger: tr, kennzeichen: 'XX-ZZ 1' });
  assert.ok(zus.zusaetzlich && zus.wache >= 1);
  const res = C.ankunftBestaetigen(z2, { art: 'reserve', typ: 'RTW', traeger: tr, kennzeichen: 'XX-ZZ 2' });
  assert.ok(/^R-RTW-/.test(res.funkrufname) && !C.fzAktiv(res, z2.einstellungen));

  // Am SimTag nur angekommene Fahrzeuge einplanen
  z2.einstellungen.nurEingecheckte = true;
  C.planen(z2, 0);
  const geplant = new Set(z2.plan.durchgaenge.flatMap(d => d.einsaetze.flatMap(e => e.fahrzeuge.map(f => f.fid))));
  assert.ok([...geplant].every(id => z2.fahrzeuge.find(f => f.id === id).status === 'da'));

  // Vorplanung anpassen
  assert.deepStrictEqual(C.vorplanungSetzen(z2, 'Neuer Träger', { RTW: 2, KTW: 0, NEF: 1 }), { neu: 3, entfernt: 0 });
  assert.deepStrictEqual(C.vorplanungSetzen(z2, 'Neuer Träger', { RTW: 1, KTW: 0, NEF: 1 }), { neu: 0, entfernt: 1 });
  console.log('ok · Ankunft, Zusatzfahrzeug, Reserve, Vorplanung');
}

// Wer darf fahren? Fahrgruppen wie in der Planung 2026 (Formel „Fahrer von Orga?“)
{
  const e = C.standardEinstellungen();
  assert.strictEqual(C.fahrgruppe(e, 'gGmbH'), C.fahrgruppe(e, 'Stadt Bielefeld'));
  assert.strictEqual(C.fahrgruppe(e, ' bf bi '), C.fahrgruppe(e, 'BF Bielefeld'));
  assert.notStrictEqual(C.fahrgruppe(e, 'Kreis Gütersloh'), C.fahrgruppe(e, 'Stadt Gütersloh'));
  assert.strictEqual(C.fahrgruppe(e, 'Kreis GT'), C.fahrgruppe(e, 'Kreis Gütersloh'));
  assert.ok(C.darfFahren(e, { traeger: 'BIEKRA' }, { traeger: 'BF Bielefeld' }));
  assert.ok(!C.darfFahren(e, { traeger: 'Kreis Lippe' }, { traeger: 'BF Bielefeld' }));
  const t = C.fahrgruppenAusText('Stadt Bielefeld: BF BI, gGmbH\nKreis Lippe:');
  assert.deepStrictEqual(t, [{ name: 'Stadt Bielefeld', mitglieder: ['BF BI', 'gGmbH'] }, { name: 'Kreis Lippe', mitglieder: [] }]);

  // Im Demo-Plan fährt immer jemand aus der Fahrgruppe des Fahrzeugs
  const z3 = demo(C);
  const pruefeFahrer = zz => zz.plan.durchgaenge.forEach(d => d.einsaetze.forEach(ei => ei.fahrzeuge.forEach(f => {
    const fz = zz.fahrzeuge.find(x => x.id === f.fid);
    if (fz.fahrerExtern) return assert.strictEqual(f.fahrer, null);
    assert.ok(f.fahrer && f.besatzung[0] === f.fahrer, 'Fahrer:in sitzt vorne');
    assert.ok(C.darfFahren(zz.einstellungen, zz.personen.find(p => p.id === f.fahrer), fz), 'Fahrer:in aus der Fahrgruppe');
  })));
  pruefeFahrer(z3);

  // Alle Leute einer Fahrgruppe aus einer Wache wegnehmen: Ausgleich holt passende Leute zurück
  const fz = z3.fahrzeuge.find(f => f.status === 'gemeldet' && f.typ === 'RTW');
  const gr = C.fahrgruppe(z3.einstellungen, fz.traeger);
  const andere = (fz.wache % z3.einstellungen.stationen.length) + 1;
  z3.personen.filter(p => p.lj === 3 && p.wache === fz.wache && C.fahrgruppe(z3.einstellungen, p.traeger) === gr).forEach(p => { p.wache = andere; });
  C.planen(z3, 0);
  pruefeFahrer(z3);
  assert.ok(z3.plan.durchgaenge[0].einsaetze.find(ei => ei.wache === fz.wache).fahrzeuge.some(f => f.fid === fz.id), 'Fahrzeug bleibt besetzt');
  assert.ok(spanne(C.gerechtigkeit(z3).einsaetze) <= 1, 'Einsätze bleiben gerecht');

  // Niemand im Kurs darf fahren: Fahrzeug bleibt stehen, außer der Träger stellt die Fahrerin oder den Fahrer
  const fremd = C.fahrzeugHinzufuegen(z3, { typ: 'RTW', traeger: 'Kreis Nirgendwo', kennzeichen: 'NW-XX 1', status: 'da' });
  C.planen(z3, 0);
  const geplantFremd = () => z3.plan.durchgaenge[0].einsaetze.flatMap(ei => ei.fahrzeuge).find(f => f.fid === fremd.id);
  assert.ok(!geplantFremd());
  assert.ok(z3.plan.durchgaenge[0].einsaetze.some(ei => ei.hinweise.some(h => h.includes(fremd.funkrufname) && h.includes('darf'))));
  fremd.fahrerExtern = true;
  assert.ok(C.planVeraltet(z3));
  C.planen(z3, 0);
  assert.ok(geplantFremd() && geplantFremd().fahrer === null && geplantFremd().besatzung.length >= 2);
  pruefeFahrer(z3);
  console.log('ok · Fahrgruppen, Fahrer:in Pflicht, Ausgleich, Fahrer:in vom Träger');
}

// Namenssuche, Plan und Check-in per Auswahl
{
  const z4 = demo(C);
  const p = z4.personen.find(x => /ö|ü|ä/.test(x.name)) || z4.personen[0];
  const [vor, nach] = p.name.split(' ');
  assert.ok(C.namenSuchen(z4, vor.slice(0, 3) + ' ' + nach.slice(0, 3)).some(t => t.id === p.id));
  assert.ok(C.namenSuchen(z4, C.suchNorm(nach)).some(t => t.id === p.id), 'Umlaute egal');
  assert.deepStrictEqual(C.namenSuchen(z4, 'a'), []);
  assert.ok(C.namenSuchen(z4, 'e').length === 0 && C.namenSuchen(z4, 'le').length <= 8);
  const t = C.namenSuchen(z4, p.name)[0];
  assert.deepStrictEqual(Object.keys(t).sort(), ['id', 'klasse', 'lj', 'name'], 'Suche liefert keine Codes oder Träger');
  assert.strictEqual(C.meinPlanId(z4, p.id).name, p.name);
  assert.ok(C.eincheckenId(z4, p.id).neu && !C.eincheckenId(z4, p.id).neu);
  console.log('ok · Namenssuche');
}

// Selbstanmeldung in der Warteschlange, Fastlane, rote Spur
{
  const z5 = demo(C), e = z5.einstellungen;
  z5.anmeldungen = []; z5.personen.forEach(p => { p.eingecheckt = null; }); z5.fahrzeuge.forEach(f => { delete f.anmeldung; });
  const f = z5.fahrzeuge.find(x => x.kennzeichen && x.typ === 'RTW' && x.status === 'gemeldet');
  const fahrer = z5.personen.find(p => p.lj === 3 && C.darfFahren(e, p, f));
  const mit = z5.personen.find(p => p.lj === 3 && p !== fahrer);
  let r = C.anmeldungSpeichern(z5, { typ: 'RTW', kennzeichen: f.kennzeichen.toLowerCase(), traeger: f.traeger, personen: [{ id: fahrer.id }, { id: mit.id }, { id: mit.id }] });
  const a = r.anmeldung;
  assert.ok(r.neu && a.fid === f.id && a.personen.length === 2, 'Kennzeichen erkannt, doppelte Person nur einmal');
  let b = C.bestaetigung(z5, a);
  assert.ok(b.gruen && b.kennung === f.funkrufname && b.personen[0].darfFahren);
  assert.ok(!('token' in b), 'Bestätigung enthält kein Token');
  assert.strictEqual(C.bestaetigungLaden(z5, a.id, 'falsch'), null);
  assert.ok(C.anmeldungSpeichern(z5, { id: a.id, token: 'falsch', personen: [] }).fehler, 'Ändern nur mit eigenem Token');
  // Fastlane: ungenau gelesenes Kennzeichen oder Nummer
  assert.strictEqual(C.anmeldungFinden(z5, f.kennzeichen.replace(/[- ]/g, '')).id, a.id);
  assert.strictEqual(C.anmeldungFinden(z5, String(a.nr)).id, a.id);
  // Ähnliches Kennzeichen ohne eigene Anmeldung wird NICHT der fremden Anmeldung zugeordnet
  const nachbar = C.fahrzeugHinzufuegen(z5, { typ: 'RTW', traeger: f.traeger, kennzeichen: f.kennzeichen.replace(/\d$/, d => String((Number(d) + 1) % 10)), status: 'gemeldet' });
  const tn = C.einfahrtSuchen(z5, nachbar.kennzeichen);
  assert.ok(tn && tn.fahrzeug === nachbar && !tn.anmeldung, 'Nachbar-Kennzeichen bleibt ohne Anmeldung');
  assert.strictEqual(C.anmeldungFinden(z5, nachbar.kennzeichen), null);
  z5.fahrzeuge.splice(z5.fahrzeuge.indexOf(nachbar), 1);
  C.anmeldungDurch(z5, a.id);
  assert.ok(f.status === 'da' && fahrer.eingecheckt && mit.eingecheckt && a.status === 'durch');
  C.anmeldungZurueck(z5, a.id);
  assert.ok(f.status === 'gemeldet' && !fahrer.eingecheckt && a.status === 'offen');

  // Rote Spur: unbekannte Person, niemand darf fahren
  const f2 = z5.fahrzeuge.find(x => x.kennzeichen && x.status === 'gemeldet' && x !== f && x.typ === 'RTW');
  const nichtFahrer = z5.personen.filter(p => p.lj === 3 && !C.darfFahren(e, p, f2) && p !== fahrer && p !== mit).slice(0, 1);
  r = C.anmeldungSpeichern(z5, { typ: 'RTW', kennzeichen: f2.kennzeichen, traeger: f2.traeger, personen: nichtFahrer.map(p => ({ id: p.id })).concat([{ name: 'Neu Person' }, { id: fahrer.id }]) });
  b = C.bestaetigung(z5, r.anmeldung);
  assert.ok(!b.gruen);
  assert.ok(b.gruende.some(g => g.includes('Neu Person')) && b.gruende.some(g => g.includes('schon bei Anmeldung')) && b.gruende.some(g => g.includes('darf')));
  C.anmeldungPersonEntfernen(z5, r.anmeldung.id, 2);
  const neuP = C.anmeldungPersonAufnehmen(z5, r.anmeldung.id, 1, { klasse: '24A', lj: 3, traeger: f2.traeger });
  assert.ok(neuP && neuP.nachgemeldet && neuP.wache >= 1);
  assert.ok(C.anmeldungPruefen(z5, r.anmeldung).gruen, 'nach dem Klären grün');

  // Unbekanntes Kennzeichen: nimmt den freien Platz des Trägers und trägt das Kennzeichen ein
  const frei = z5.fahrzeuge.find(x => x.status === 'gemeldet' && !x.kennzeichen && !x.anmeldung);
  r = C.anmeldungSpeichern(z5, { typ: frei.typ, kennzeichen: 'QQ-ZZ 42', traeger: frei.traeger, personen: [{ id: z5.personen.find(p => C.darfFahren(e, p, frei) && !p.eingecheckt && !z5.anmeldungen.some(x => x.personen.some(y => y.pid === p.id))).id }] });
  assert.ok(r.anmeldung.fid && C.anmeldungPruefen(z5, r.anmeldung).fahrzeug.kennzeichen === 'QQ-ZZ 42');
  const platz = z5.fahrzeuge.find(x => x.id === r.anmeldung.fid);
  C.anmeldungStornieren(z5, r.anmeldung.id);
  assert.ok(!platz.kennzeichen && !platz.anmeldung, 'Löschen gibt den Platz wieder frei');

  // Kein freier Platz: rote Spur, Orga plant zusätzlich ein
  r = C.anmeldungSpeichern(z5, { typ: 'KTW', kennzeichen: 'QQ-ZZ 43', traeger: 'Unbekannter Träger', personen: [{ name: 'Jemand' }] });
  assert.ok(!r.anmeldung.fid && !C.anmeldungPruefen(z5, r.anmeldung).gruen);
  const zus = C.ankunftBestaetigen(z5, { art: 'zusatz', typ: 'KTW', traeger: 'Unbekannter Träger', kennzeichen: 'QQ-ZZ 43' });
  C.anmeldungFahrzeugSetzen(z5, r.anmeldung.id, zus.id);
  assert.strictEqual(C.anmeldungPruefen(z5, r.anmeldung).fahrzeug.id, zus.id);

  // Datenschutz: keine Anmeldungen, Tokens oder Zugangsschlüssel in der öffentlichen Sicht
  const o = JSON.stringify(C.oeffentlich(z5));
  assert.ok(!o.includes(z5.zugang) && !z5.anmeldungen.some(x => o.includes(x.token)) && !o.includes('anmeldungen'));
  console.log('ok · Selbstanmeldung, Fastlane, rote Spur');
}
