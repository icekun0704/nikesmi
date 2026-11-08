/* Headless smoke test: node tools/test_engine.js */
require('./_env');
require('../js/data.js');
require('../js/stat_data.js');
require('../js/skills.js');
require('../js/gauge.js');
require('../js/stats.js');
require('../js/engine.js');
Object.assign(global, window);

const C = window.CHARACTERS;
const byName = {};
C.forEach(c => { if (!byName[c.name]) byName[c.name] = c; });

function team(names) {
  return names.map(n => {
    const c = byName[n];
    if (!c) throw new Error('unknown: ' + n);
    return c;
  });
}

function show(label, ta, tb, trials) {
  const r = window.Engine.runMany(ta, tb, {}, trials || 40);
  if (r.error) { console.log(label, r.error); return; }
  console.log(
    label.padEnd(40),
    'A ' + (100 * r.winsA / r.trials).toFixed(0) + '%',
    'B ' + (100 * r.winsB / r.trials).toFixed(0) + '%',
    'draw ' + (100 * r.draws / r.trials).toFixed(0) + '%',
    'median ' + (r.medianFrames / 60).toFixed(1) + 's'
  );
}

const T1 = team(['リター', 'ノア', '紅蓮', 'アニス：スター', 'ノワール']);
const T2 = team(['リター', 'ノア', '紅蓮', 'アニス：スター', 'ノワール']);

show('mirror (should be ~50/50)', T1, T2, 40);

const jackal = team(['ジャッカル', 'ノイズ', 'ドレイク', 'ブラン', 'ルピー']);
const meta = team(['リター', 'ノア', '紅蓮', 'アニス：スター', 'ノワール']);
show('jackal vs meta', jackal, meta, 40);

// detail of one run
const r = window.Engine.run(T1, T2, { seed: 7 });
console.log('\nwinner', r.winner, 'frames', r.frames, '(' + (r.frames / 60).toFixed(1) + 's)');
console.log('bursts', r.bursts.slice(0, 9).map(b => b.name + '@' + (b.frame / 60).toFixed(2) + 's ' + b.stage).join(' | '));
console.log('deaths', r.events.filter(e => e.kind === 'death').map(e => e.unit + '@' + (e.frame / 60).toFixed(1)).join(' '));
const u = r.teams.A[0];
console.log('unit0', u.name, 'hp', Math.round(u.hp), '/', u.hpMax, 'dmgDealt', Math.round(u.damageDealt), 'shots', u.shots);
console.log('hpRatio', r.hpRatio);

/* ---- バースト速度の回帰チェック ----
 * 参照実装（work/charge_sim.js --region global）と 1 フレーム以内で一致すること。
 *   gateway 152F で満タン -> B1 178F / B2 210F / B3 242F
 * ここがずれたら、ゲージかスケジュールのどちらかを壊している。
 */
const ref = window.Engine.run(T1, T2, { seed: 7 });
const own = ref.bursts.filter(b => b.side === 'A').slice(0, 3).map(b => b.frame);
const expect = [178, 210, 242];
let drift = 0;
if (own.length >= 3) {
  for (let i = 0; i < 3; i++) drift = Math.max(drift, Math.abs(own[i] - expect[i]));
}
if (own.length < 3) {
  console.log('\n[NG] バーストが3段階そろっていません:', own);
  process.exitCode = 1;
} else if (drift > 1) {
  console.log('\n[NG] バースト速度が参照実装から ' + drift + 'F ずれています:', own, '期待', expect);
  process.exitCode = 1;
} else {
  console.log('\n[OK] バースト速度 参照実装との差 ' + drift + 'F (' + own.join(', ') + ')');
}
