/* Validate the engine against real Champion Arena matchups.
 *
 *   node tools/validate.js [corpus] [limit] [trials] [arenaMode] [rev]
 *
 * corpus: c6..c10 (default c10). Reads ../work/matchups_<corpus>.json
 *
 * これは勝敗予測の精度を測るものではなく、物理モデルの妥当性チェック。
 *
 * 2026-11-10 追記: 実戦ログの id は js/data.js の id と**別体系**で、以前は
 * まったく別のキャラ同士を戦わせていた（43%＝ほぼ無相関の原因）。名前で
 * 突き合わせるよう直したあとの実測（各300件・チャンピオンモード・3試行）:
 *   c6 55.7% / c7 52.7% / c8 56.3% / c9 58.7% / c10 56.7%
 * 装備OP・スキルLv・コレクションが実データに無いことを考えれば、この水準が妥当。
 * 65% を超えたら過剰適合を疑う。
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

/* 実戦ログの id は js/data.js の id と別体系。対応表は tools/nk_map.js に一元化し、
 * test_validate_map.js で壊れていないか確認できるようにしている。 */
const NKMAP = require('./nk_map.js');
const mapped2 = NKMAP.build(C, NKMAP.loadNK());
const nkToEngine = mapped2.map;
if (mapped2.problems.length) {
  console.log('名前の対応に ' + mapped2.problems.length + ' 件の問題:');
  mapped2.problems.slice(0, 15).forEach(m => console.log('  ' + m));
}

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
    let c = nkToEngine[id];
    if (!c) return null;
    const col = (collections || [])[i] || '';
    const baseId = c.id;
    if (col.indexOf('treasure') >= 0 && treasureOf[baseId]) c = treasureOf[baseId];
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

const acc = 100 * correct / Math.max(1, total);
if (total >= 100 && acc < 50) {
  console.log('[NG] 精度が ' + acc.toFixed(1) + '% まで落ちています（対応表かエンジンが壊れています）');
  process.exitCode = 1;
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
