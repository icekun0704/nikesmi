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

/* 実戦ログ（nikkeari）の id は js/data.js の id と**別体系**。そのまま引くと
 * まったく別のキャラで戦わせてしまうので、名前で突き合わせる。
 * 照合の健全性のため、武器・属性・バースト段階が一致するかも検証する。
 * 食い違ったら engine 側（ゲーム内バンドル由来）を正とする。実測では
 * マナの属性（nikkeari 灼熱 / ゲーム内 風圧）とリリーの段階（同 B1 / B2）が
 * 実戦データ側の誤りだった。 */
const NK = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'work', 'characters.json'), 'utf8'));
const ALIAS = {
  'ネオン：ビジョン・アイ': 'ネオン：ビジョンアイ',
  'ラプンツェル:ピュアグレイス': 'ラプンツェル：ピュアグレイス',
  'ギルティ：マイティーバニー': 'ギルティ：マイティバニー',
  'クイーン（新島真）': 'クイーン（真）',
  'アヤナミレイ(仮称)': 'レイ（仮称）',
  '式波・アスカ・ラングレー': 'アスカ',
  '真希波・マリ・イラストリアス': 'マリ',
  '綾波レイ': 'レイ',
  '井ノ上たきな': 'たきな',
  '錦木千束': '千束',
  '天城雪子': '雪子',
  '葛城ミサト': 'ミサト'
};
const normName = s => String(s).replace(/[：:・\s　()（）]/g, '');
const engineByName = {};
C.forEach(c => { if (!c.treasure) engineByName[normName(c.name)] = c; });
const nkToEngine = {};
const mapProblems = [];
NK.forEach(row => {
  if (row.id === 9999 || row.name === '空枠') return;      // 空き枠
  const target = ALIAS[row.name] || row.name;
  const hit = engineByName[normName(target)];
  if (!hit) { mapProblems.push('未対応 ' + row.id + ' ' + row.name); return; }
  /* レッドフードは段階を自分で上げるので nikkeari 側が 'BA'、engine 側が 'B123'。
   * 同じ意味なので一致扱いにする。 */
  const burst = row.burst_phase === 'A' ? 'B123' : 'B' + row.burst_phase;
  if (hit.weapon !== row.weapon || hit.element !== row.element || hit.burstStage !== burst) {
    mapProblems.push('属性不一致 ' + row.name + ' → ' + hit.name +
      ' (nikkeari ' + row.weapon + '/' + row.element + '/' + burst +
      ' vs engine ' + hit.weapon + '/' + hit.element + '/' + hit.burstStage + ')');
  }
  nkToEngine[row.id] = hit;
});
if (mapProblems.length) {
  console.log('名前の対応に ' + mapProblems.length + ' 件の問題:');
  mapProblems.slice(0, 15).forEach(m => console.log('  ' + m));
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
