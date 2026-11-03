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
assert.ok(!Object.keys(g.nef).some(k => Number(k) > 1) || nefPlaetze > g.anzahl, 'NEF erst doppelt, wenn alle einmal dran waren');

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
const p = z.personen[0];
assert.ok(C.einchecken(z, p.code.toLowerCase()).neu);
assert.ok(!C.einchecken(z, p.code).neu);
assert.strictEqual(C.einchecken(z, 'XXXXXX'), null);

g = C.gerechtigkeit(z);
console.log('ok · Einsätze', g.einsaetze, '· erste Welle', g.erste, '· NEF', g.nef);
