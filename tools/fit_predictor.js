/* 実戦記録から勝敗予測モデルを作り、未知の対戦相手で評価する.
 *
 *   node tools/fit_predictor.js <matchups...json>
 *
 * モデル:
 *   score(team) = Σ キャラ重み + Σ ペア相性 + Σ 位置補正
 *   P(A勝ち) = sigmoid(score(A) - score(B))
 *
 * L2 正則化つきのロジスティック回帰を勾配降下で学習する。
 * 評価は「同じ2プレイヤーの組が学習とテストに分かれない」ように分割する。
 */
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/fit_predictor.js <matchups.json...>');
  process.exit(1);
}

const matches = [];
for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const arr = Array.isArray(raw) ? raw : raw.matchups || [];
  matches.push(...arr);
}
const seen = new Set();
const uniq = [];
for (const m of matches) {
  const k = m.canonical_attacker + '|' + m.canonical_defender + '|' + (m.winner_is_attacker ? 1 : 0);
  if (seen.has(k)) continue;
  seen.add(k);
  uniq.push(m);
}

const pairKey = (m) =>
  Math.min(m.attacker_player_id, m.defender_player_id) + '-' +
  Math.max(m.attacker_player_id, m.defender_player_id);

/* 対戦相手の組で分割する（同じ組が両側に入らないように） */
const groups = {};
uniq.forEach((m) => { (groups[pairKey(m)] = groups[pairKey(m)] || []).push(m); });
const keys = Object.keys(groups);
const train = [], test = [];
keys.forEach((k, i) => { ((i % 3 === 0) ? test : train).push(...groups[k]); });

/* ---- 特徴量 ---- */
const charIdx = new Map();
const pairIdx = new Map();
const posIdx = new Map();
function register(rows) {
  for (const m of rows) {
    for (const team of [m.attacker_team, m.defender_team]) {
      team.forEach((id, pos) => {
        const c = Number(id);
        if (!charIdx.has(c)) charIdx.set(c, charIdx.size);
        const pk = c + '#' + pos;
        if (!posIdx.has(pk)) posIdx.set(pk, posIdx.size);
      });
      const ids = team.map(Number).sort((a, b) => a - b);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const k = ids[i] + '_' + ids[j];
          if (!pairIdx.has(k)) pairIdx.set(k, pairIdx.size);
        }
      }
    }
  }
}
register(train);

const nC = charIdx.size, nP = pairIdx.size, nPos = posIdx.size;
const wC = new Float64Array(nC);
const wP = new Float64Array(nP);
const wPos = new Float64Array(nPos);

function featureIdx(m, side) {
  const team = side === 'A' ? m.attacker_team : m.defender_team;
  const c = [], p = [], q = [];
  team.forEach((id, pos) => {
    const ch = Number(id);
    const ci = charIdx.get(ch); if (ci !== undefined) c.push(ci);
    const pi = posIdx.get(ch + '#' + pos); if (pi !== undefined) q.push(pi);
  });
  const ids = team.map(Number).sort((a, b) => a - b);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const k = pairIdx.get(ids[i] + '_' + ids[j]);
      if (k !== undefined) p.push(k);
    }
  }
  return { c, p, q };
}

function score(f) {
  let s = 0;
  for (const i of f.c) s += wC[i];
  for (const i of f.p) s += wP[i];
  for (const i of f.q) s += wPos[i];
  return s;
}

/* ---- 学習 ---- */
const L2 = 0.06;
const LR = 0.03;
const EPOCHS = 800;
const feats = train.map((m) => ({ m, a: featureIdx(m, 'A'), b: featureIdx(m, 'B'), y: m.winner_is_attacker ? 1 : 0 }));

for (let ep = 0; ep < EPOCHS; ep++) {
  for (const f of feats) {
    const z = score(f.a) - score(f.b);
    const p = 1 / (1 + Math.exp(-z));
    const g = f.y - p;
    for (const i of f.a.c) wC[i] += LR * (g - L2 * wC[i]);
    for (const i of f.b.c) wC[i] += LR * (-g - L2 * wC[i]);
    for (const i of f.a.p) wP[i] += LR * (g - L2 * wP[i]);
    for (const i of f.b.p) wP[i] += LR * (-g - L2 * wP[i]);
    for (const i of f.a.q) wPos[i] += LR * (g - L2 * wPos[i]);
    for (const i of f.b.q) wPos[i] += LR * (-g - L2 * wPos[i]);
  }
}

/* ---- 評価 ---- */
const testF = test.map((m) => {
  const team = m.attacker_team, teamB = m.defender_team;
  const mk = (t) => {
    const c = [], p = [], q = [];
    t.forEach((id, pos) => {
      const ch = Number(id);
      const ci = charIdx.get(ch); if (ci !== undefined) c.push(ci);
      const pi = posIdx.get(ch + '#' + pos); if (pi !== undefined) q.push(pi);
    });
    const ids = t.map(Number).sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = pairIdx.get(ids[i] + '_' + ids[j]);
        if (k !== undefined) p.push(k);
      }
    }
    return { c, p, q };
  };
  return { a: mk(team), b: mk(teamB), y: m.winner_is_attacker ? 1 : 0 };
});

function accuracy(usePairs, usePos) {
  let ok = 0, n = 0;
  for (const f of testF) {
    let sa = 0, sb = 0;
    for (const i of f.a.c) sa += wC[i];
    for (const i of f.b.c) sb += wC[i];
    if (usePairs) { for (const i of f.a.p) sa += wP[i]; for (const i of f.b.p) sb += wP[i]; }
    if (usePos) { for (const i of f.a.q) sa += wPos[i]; for (const i of f.b.q) sb += wPos[i]; }
    const z = sa - sb;
    if (Math.abs(z) < 1e-9) continue;
    n++;
    if ((z > 0 ? 1 : 0) === f.y) ok++;
  }
  return (100 * ok / n).toFixed(1) + '% (n=' + n + ')';
}

console.log('train', train.length, 'test', test.length);
console.log('features: char', nC, 'pair', nP, 'pos', nPos);
console.log('キャラのみ        :', accuracy(false, false));
console.log('キャラ＋位置      :', accuracy(false, true));
console.log('キャラ＋ペア      :', accuracy(true, false));
console.log('キャラ＋ペア＋位置:', accuracy(true, true));

/* ---- 書き出し ---- */
const outPath = process.env.PREDICTOR_OUT || '';
if (outPath) {
  const dump = {
    characters: {}, pairs: {}, positions: {}, n: uniq.length
  };
  for (const [c, i] of charIdx) dump.characters[c] = Math.round(wC[i] * 1000) / 1000;
  for (const [k, i] of pairIdx) dump.pairs[k] = Math.round(wP[i] * 1000) / 1000;
  for (const [k, i] of posIdx) dump.positions[k] = Math.round(wPos[i] * 1000) / 1000;
  fs.writeFileSync(outPath, 'window.PREDICTOR = ' + JSON.stringify(dump) + ';' + String.fromCharCode(10));
  console.log('wrote', outPath);
}
