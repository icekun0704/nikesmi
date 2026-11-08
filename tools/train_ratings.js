/* 実戦記録からキャラクター別の強さを推定し js/ratings.js を書き出す.
 *
 *   node tools/train_ratings.js <matchups...json> <out.js>
 *
 * 手法: 各キャラに潜在的な強さ r を持たせ、チームの勝率を
 *   P(勝ち) = 1 / (1 + exp(-(Σr_自分 - Σr_相手) / 4))
 * として最尤推定する（Bradley–Terry のチーム版）。
 *
 * 注意: これは「その大会で実際に勝っていたのは誰か」を測るもので、
 * キャラクター単体の性能ではない。同じキャラでも、強いプレイヤーの
 * 5軍に置かれていれば低く出る。理由の説明には使えない。
 */
const fs = require('fs');
const path = require('path');

const inputs = process.argv.slice(2, -1);
const outPath = process.argv[process.argv.length - 1];
if (!inputs.length) {
  console.error('usage: node tools/train_ratings.js <matchups.json...> <out.js>');
  process.exit(1);
}

const matches = [];
for (const f of inputs) {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const arr = Array.isArray(raw) ? raw : raw.matchups || [];
  for (const m of arr) {
    if (!m.attacker_team || !m.defender_team) continue;
    matches.push(m);
  }
}

/* 同じ対戦カードを何度も数えないよう、重複を落とす */
const seen = new Set();
const uniq = [];
for (const m of matches) {
  const key = m.canonical_attacker + '|' + m.canonical_defender + '|' + (m.winner_is_attacker ? 1 : 0);
  if (seen.has(key)) continue;
  seen.add(key);
  uniq.push(m);
}

const ids = new Set();
uniq.forEach((m) => m.attacker_team.concat(m.defender_team).forEach((i) => ids.add(Number(i))));

const r = {};
for (const i of ids) r[i] = 0;

const LR = 0.02;
const ITER = 600;
for (let it = 0; it < ITER; it++) {
  for (const m of uniq) {
    const sa = m.attacker_team.reduce((s, i) => s + (r[Number(i)] || 0), 0);
    const sb = m.defender_team.reduce((s, i) => s + (r[Number(i)] || 0), 0);
    const p = 1 / (1 + Math.exp(-(sa - sb) / 4));
    const g = ((m.winner_is_attacker ? 1 : 0) - p) * LR;
    m.attacker_team.forEach((i) => { r[Number(i)] += g; });
    m.defender_team.forEach((i) => { r[Number(i)] -= g; });
  }
}

/* 出現回数も持たせる（少ない標本は信用しないため） */
const games = {};
uniq.forEach((m) => {
  m.attacker_team.forEach((i) => { games[Number(i)] = (games[Number(i)] || 0) + 1; });
  m.defender_team.forEach((i) => { games[Number(i)] = (games[Number(i)] || 0) + 1; });
});

/* 出現回数が少ないキャラは極端な値に振れるので 0 方向へ縮める。
 *   r' = r × n / (n + K)
 * K=40 で、40試合のキャラは半分、400試合なら 91% が残る。 */
const SHRINK_K = 40;

const out = {
  generatedFrom: inputs.map((f) => path.basename(f)),
  matches: uniq.length,
  scale: 4,
  shrinkK: SHRINK_K,
  ratings: {},
};
for (const i of Object.keys(r)) {
  const n = games[i] || 0;
  const shrunk = n > 0 ? (r[i] * n) / (n + SHRINK_K) : 0;
  out.ratings[i] = { r: Math.round(shrunk * 1000) / 1000, n: n };
}

fs.writeFileSync(outPath, 'window.RATINGS = ' + JSON.stringify(out) + ';\n');

/* 学習データでの当てはまり */
let ok = 0;
for (const m of uniq) {
  const sa = m.attacker_team.reduce((s, i) => s + (r[Number(i)] || 0), 0);
  const sb = m.defender_team.reduce((s, i) => s + (r[Number(i)] || 0), 0);
  if ((sa > sb ? 'A' : 'B') === (m.winner_is_attacker ? 'A' : 'B')) ok++;
}
let okS = 0;
for (const m of uniq) {
  const sa = m.attacker_team.reduce((s, i) => s + out.ratings[Number(i)].r, 0);
  const sb = m.defender_team.reduce((s, i) => s + out.ratings[Number(i)].r, 0);
  if ((sa > sb ? 'A' : 'B') === (m.winner_is_attacker ? 'A' : 'B')) okS++;
}
console.log('matches', uniq.length, 'characters', Object.keys(r).length,
  'accuracy', (100 * ok / uniq.length).toFixed(1) + '% (shrunk', (100 * okS / uniq.length).toFixed(1) + '%)');
console.log('wrote', outPath);
