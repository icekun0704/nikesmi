/* Validate the engine against real Champion Arena matchups.
 *
 *   node tools/validate.js [corpus] [limit] [trials]
 *
 * corpus: c6..c10 (default c10). Reads ../work/matchups_<corpus>.json
 */
const fs = require('fs');
const path = require('path');

global.window = {};
require('../js/data.js');
require('../js/stat_data.js');
require('../js/skills.js');
require('../js/gauge.js');
require('../js/stats.js');
require('../js/engine.js');
Object.assign(global, window);

const C = window.CHARACTERS;
const byId = {};
// the matchup data already uses the treasure form's own id when the player has
// the favourite item, so index every row.
C.forEach(c => { byId[c.id] = c; });
const treasureOf = {};
C.forEach(c => {
  if (c.treasure && byId[c.orgId]) treasureOf[byId[c.orgId].id] = c;
});

const corpus = process.argv[2] || 'c10';
const limit = parseInt(process.argv[3] || '600', 10);
const arenaMode = process.argv[5] || 'normal';
const reverseB = process.argv[6] === 'rev';
const trials = parseInt(process.argv[4] || '5', 10);

const file = path.join(__dirname, '..', '..', 'work', 'matchups_' + corpus + '.json');
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const arr = Array.isArray(raw) ? raw : raw.matchups || [];

// one entry per distinct matchup
const seen = new Set();
const cases = [];
for (const m of arr) {
  const key = m.canonical_attacker + '|' + m.canonical_defender;
  if (seen.has(key)) continue;
  seen.add(key);
  cases.push(m);
}

function build(team, collections) {
  return team.map((id, i) => {
    let c = byId[id];
    if (!c) return null;
    const col = (collections || [])[i] || '';
    if (col.indexOf('treasure') >= 0 && treasureOf[id]) c = treasureOf[id];
    return c;
  });
}

function cfgFor(collections) {
  const units = {};
  return units;
}

let correct = 0, total = 0, skipped = 0, draws = 0;
const errors = [];
const t0 = Date.now();

for (const m of cases.slice(0, limit)) {
  const A = build(m.attacker_team, m.attacker_collections);
  const B = build(reverseB ? m.defender_team.slice().reverse() : m.defender_team, m.defender_collections);
  if (A.some(x => !x) || B.some(x => !x)) {
    skipped++;
    if (skipped < 4) console.log('skip: unknown id', m.attacker_team, m.defender_team);
    continue;
  }

  const r = window.Engine.runMany(A, B, { arenaMode: arenaMode }, trials);
  if (r.error) {
    skipped++;
    if (skipped < 4) console.log('skip:', r.error);
    continue;
  }
  const predicted = r.winRate > 0.5 ? 'A' : (r.winRate < 0.5 ? 'B' : 'draw');
  const actual = m.winner_is_attacker ? 'A' : 'B';
  total++;
  if (predicted === actual) correct++;
  else if (predicted === 'draw') draws++;
  errors.push({ actual, predicted, rate: r.winRate, a: m.attacker_team.join(','), b: m.defender_team.join(',') });
}

const ms = Date.now() - t0;
console.log('corpus', corpus, 'cases', total, 'skipped', skipped);
console.log('accuracy', (100 * correct / total).toFixed(1) + '%',
  '(' + correct + '/' + total + ')', 'draws-as-wrong', draws);
{
  let predA = 0, actA = 0, hiA = 0, hiB = 0;
  for (const e of errors) {
    if (e.rate > 0.5) { predA++; if (e.rate > 0.9) hiA++; } else { if (e.rate < 0.1) hiB++; }
    if (e.actual === 'A') actA++;
  }
  console.log('predicted A', predA, '/', total, ' actual A', actA, '/', total,
    ' confidentA', hiA, 'confidentB', hiB);
}
console.log('time', (ms / 1000).toFixed(1) + 's', 'per case', (ms / total).toFixed(1) + 'ms');

// calibration: bucket by predicted confidence
const buckets = {};
for (const e of errors) {
  const conf = Math.abs(e.rate - 0.5) * 2;
  const b = Math.min(4, Math.floor(conf * 5));
  buckets[b] = buckets[b] || { n: 0, ok: 0 };
  buckets[b].n++;
  if (e.actual === e.predicted) buckets[b].ok++;
}
console.log('confidence buckets (0=coinflip .. 4=decisive):');
for (const k of Object.keys(buckets).sort()) {
  const b = buckets[k];
  console.log('  ', k, b.n, 'cases', (100 * b.ok / b.n).toFixed(1) + '% correct');
}
