/* 実戦ログ照合をキャラ別に集計して、実装が怪しいキャラを炙り出す。
 *
 *   node tools/validate_by_char.js [limit]
 *
 * 全体の正解率から大きく外れるキャラは、固有スキルかパーサの解釈を疑う。
 */
const fs = require('fs');
const path = require('path');
global.window = {};
['data', 'stat_data', 'skills', 'gauge', 'stats', 'engine'].forEach(f => require('../js/' + f + '.js'));
Object.assign(global, window);

const C = window.CHARACTERS;
const byId = {};
C.forEach(c => { byId[c.id] = c; });
const treasureOf = {};
C.forEach(c => { if (c.treasure && byId[c.orgId]) treasureOf[byId[c.orgId].id] = c; });

const NKMAP = require('./nk_map.js');
const mapped = NKMAP.build(C, NKMAP.loadNK());
const nkToEngine = mapped.map;

const limit = parseInt(process.argv[2] || '300', 10);
const COLL_UNKNOWN = 7;

function collectibleFrom(col) {
  if (!col) return null;
  if (col.indexOf('treasure') === 0) return null;
  if (col === 'none') return { rarity: 'R', level: 0 };
  const m = /^(sr|r)_(15|0_14)$/.exec(col);
  if (!m) return null;
  return { rarity: m[1] === 'sr' ? 'SR' : 'R', level: m[2] === '15' ? 15 : COLL_UNKNOWN };
}
function build(team, collections) {
  return team.map((id, i) => {
    let c = nkToEngine[id];
    if (!c) return null;
    const col = (collections || [])[i] || '';
    if (col.indexOf('treasure') >= 0 && treasureOf[c.id]) c = treasureOf[c.id];
    return c;
  });
}
function unitOptions(team, collections, side) {
  const units = {};
  team.forEach((c, i) => {
    if (!c) return;
    const coll = collectibleFrom((collections || [])[i]);
    if (coll) units[side + '|' + i] = { stats: { collectible: coll } };
  });
  return units;
}

const stat = {};
let total = 0, correct = 0;
const corporaArg = (process.argv.find(x => x.indexOf('--corpora=') === 0) || '').split('=')[1];
const CORPORA = corporaArg ? corporaArg.split(',') : ['c6', 'c7', 'c8', 'c9', 'c10'];
CORPORA.forEach(corpus => {
  const raw = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'work', 'matchups_' + corpus + '.json'), 'utf8'));
  const arr = Array.isArray(raw) ? raw : raw.matchups || [];
  const seen = new Set();
  const cases = [];
  for (const m of arr) {
    const key = m.canonical_attacker + '|' + m.canonical_defender;
    if (seen.has(key)) continue;
    seen.add(key);
    cases.push(m);
  }
  for (const m of cases.slice(0, limit)) {
    const A = build(m.attacker_team, m.attacker_collections);
    const B = build(m.defender_team, m.defender_collections);
    if (A.some(x => !x) || B.some(x => !x)) continue;
    const opts = {
      arenaMode: 'c',
      units: Object.assign(unitOptions(A, m.attacker_collections, 'A'),
        unitOptions(B, m.defender_collections, 'B'))
    };
    const r = window.Engine.runMany(A, B, opts, 1);
    if (r.error) continue;
    const predicted = r.winRate > 0.5 ? 'A' : (r.winRate < 0.5 ? 'B' : 'draw');
    const actual = m.winner_is_attacker ? 'A' : 'B';
    total++;
    const ok = predicted === actual;
    if (ok) correct++;
    A.concat(B).forEach(c => {
      const s = stat[c.name] || (stat[c.name] = { n: 0, ok: 0 });
      s.n++;
      if (ok) s.ok++;
    });
  }
});

const base = correct / total;
console.log('全体 ' + (100 * base).toFixed(1) + '% (' + correct + '/' + total + ')');
const rows = Object.keys(stat)
  .map(k => ({ name: k, n: stat[k].n, acc: stat[k].ok / stat[k].n }))
  .filter(r => r.n >= 120)
  .sort((a, b) => a.acc - b.acc);
console.log('\n--- 正解率が低い順（120件以上） ---');
rows.slice(0, 15).forEach(r =>
  console.log('  ' + (100 * r.acc).toFixed(1).padStart(5) + '%  n=' + String(r.n).padStart(4) +
    '  (' + (100 * (r.acc - base)).toFixed(1).padStart(5) + 'pt)  ' + r.name));
console.log('\n--- 正解率が高い順 ---');
rows.slice(-8).reverse().forEach(r =>
  console.log('  ' + (100 * r.acc).toFixed(1).padStart(5) + '%  n=' + String(r.n).padStart(4) +
    '  (' + (100 * (r.acc - base)).toFixed(1).padStart(5) + 'pt)  ' + r.name));
