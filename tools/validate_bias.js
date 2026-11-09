/* キャラごとに「エンジンが買い被っているか、安く見ているか」を出す。
 *
 *   node tools/validate_bias.js [limit] [--corpora=c6,c7]
 *
 * そのキャラがいる側の「予測勝率」と「実際の勝率」を比べる。
 *   予測 > 実績  … 過大評価（実装が強すぎる／条件を無視している疑い）
 *   予測 < 実績  … 過小評価（効果を落としている疑い）
 *
 * **ただし単独では判断しないこと。** この指標は「そのキャラがどの編成に出るか」の
 * 偏りを強く受ける。c6-c8 で出した上位と c9-c10 で出した上位を比べると、
 * 大半は再現しない（トーブ宝 -22.7→圏外、ラプラス +21.8→圏外、エミリア +18.5→圏外）。
 * 両方で残ったのはスノーホワイト：HA（-21.2→-12.1）とアニス：スター（+15.4→+7.1）
 * 程度で、しかも後者は「強い編成を過大に見る」というモデル性格の可能性が高い。
 * --corpora= で分割して再現するものだけをバグとして追う。
 */
const fs = require('fs');
const path = require('path');
global.window = {};
['data', 'stat_data', 'skills', 'gauge', 'stats', 'cubes', 'specials', 'engine'].forEach(f => require('../js/' + f + '.js'));
Object.assign(global, window);

const C = window.CHARACTERS;
const byId = {};
C.forEach(c => { byId[c.id] = c; });
const treasureOf = {};
C.forEach(c => { if (c.treasure && byId[c.orgId]) treasureOf[byId[c.orgId].id] = c; });

const NKMAP = require('./nk_map.js');
const nkToEngine = NKMAP.build(C, NKMAP.loadNK()).map;

const limit = parseInt(process.argv[2] || '200', 10);
const corporaArg = (process.argv.find(x => x.indexOf('--corpora=') === 0) || '').split('=')[1];
const CORPORA = corporaArg ? corporaArg.split(',') : ['c6', 'c7', 'c8', 'c9', 'c10'];

function collectibleFrom(col) {
  if (!col) return null;
  if (col.indexOf('treasure') === 0) return null;
  if (col === 'none') return { rarity: 'R', level: 0 };
  const m = /^(sr|r)_(15|0_14)$/.exec(col);
  if (!m) return null;
  return { rarity: m[1] === 'sr' ? 'SR' : 'R', level: m[2] === '15' ? 15 : 7 };
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

const st = {};
let n = 0, predSum = 0, actSum = 0;
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
    const r = window.Engine.runMany(A, B, {
      arenaMode: 'c',
      units: Object.assign(unitOptions(A, m.attacker_collections, 'A'),
        unitOptions(B, m.defender_collections, 'B'))
    }, 1);
    if (r.error) continue;
    n++;
    predSum += r.winRate;
    actSum += m.winner_is_attacker ? 1 : 0;
    const rec = (name, pred, act) => {
      const s = st[name] || (st[name] = { n: 0, p: 0, a: 0 });
      s.n++; s.p += pred; s.a += act;
    };
    A.forEach(c => rec(c.name, r.winRate, m.winner_is_attacker ? 1 : 0));
    B.forEach(c => rec(c.name, 1 - r.winRate, m.winner_is_attacker ? 0 : 1));
  }
});

console.log('試合 ' + n + ' / 予測A勝率 ' + (100 * predSum / n).toFixed(1) + '% / 実際 ' + (100 * actSum / n).toFixed(1) + '%');
const rows = Object.keys(st).map(k => {
  const s = st[k];
  const p = s.p / s.n, a = s.a / s.n;
  return { name: k, n: s.n, p: p, a: a, bias: p - a, se: Math.sqrt(0.25 / s.n) };
}).filter(r => r.n >= 150).sort((x, y) => Math.abs(y.bias) - Math.abs(x.bias));

console.log('\n--- ズレの大きい順（150試合以上） ---');
rows.slice(0, 16).forEach(r => {
  const z = r.bias / r.se;
  console.log('  ' + (100 * r.bias >= 0 ? '+' : '') + (100 * r.bias).toFixed(1).padStart(5) + 'pt' +
    '  (z=' + z.toFixed(1).padStart(4) + ')  予測' + (100 * r.p).toFixed(0) + '% 実際' + (100 * r.a).toFixed(0) +
    '%  n=' + String(r.n).padStart(4) + '  ' + r.name);
});
