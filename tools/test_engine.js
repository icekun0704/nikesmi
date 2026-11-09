/* Headless smoke test: node tools/test_engine.js */
require('./_env');
require('../js/data.js');
require('../js/stat_data.js');
require('../js/skills.js');
require('../js/gauge.js');
require('../js/stats.js');
require('../js/cubes.js');
require('../js/specials.js');
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

/* 競技モード: チャンピオンアリーナは両者同じ隊列なので、飛翔補正は 'c'（P1-P3=0, P4-P5=2）。
   'normal' は攻撃側/防御側で補正が変わり、ミラー対戦が非対称になる。 */
const flyTeam = team(['ヤン', 'ノイズ', 'ジャッカル', 'ティア', 'ラプンツェル']);
const gNorm = window.Gauge.simulate(flyTeam, { side: 'defense', region: 'cn', arenaMode: 'normal' });
const gChamp = window.Gauge.simulate(flyTeam, { side: 'defense', region: 'cn', arenaMode: 'c' });
const gAtk = window.Gauge.simulate(flyTeam, { side: 'attack', region: 'cn', arenaMode: 'c' });
show('mirror champion-mode (should be ~50/50)', T1, T2, 200);

/* ミラー対戦の不変条件。アリーナに引き分けは無い（同時全滅は deathOrder で決着する）し、
 * 同じ編成どうしなら五分に近づくはず。ここが崩れたら解決順か乱数利用を壊している。 */
{
  const mm = window.Engine.runMany(T1, T2, { arenaMode: 'c' }, 200);
  const skew = Math.abs(mm.winsA - mm.winsB) / mm.trials;
  if (mm.draws > 0) {
    console.log('[NG] ミラー対戦で引き分けが出ています: ' + mm.draws + '/' + mm.trials);
    process.exitCode = 1;
  } else if (skew > 0.12) {
    console.log('[NG] ミラーの勝率が偏っています: A ' + mm.winsA + ' / B ' + mm.winsB);
    process.exitCode = 1;
  } else {
    console.log('[OK] ミラー 引き分け0 / A ' + (100 * mm.winsA / mm.trials).toFixed(1) +
      '% B ' + (100 * mm.winsB / mm.trials).toFixed(1) + '%');
  }
}
console.log(
  '[OK] アリーナモード 通常/チャンピオン B1 ' + gNorm.burst1Frame + '/' + gChamp.burst1Frame +
  'F  チャンピオン攻撃/防御 B1 ' + gAtk.burst1Frame + '/' + gChamp.burst1Frame + 'F'
);

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
/* 参照実装は「全員生きている前提」でゲージだけから B1/B2/B3 を出す。
 * 実戦では途中で倒れると段が飛ぶので、比べるのは B1 の時刻だけ。 */
const expectB1 = 178;
const drift = own.length ? Math.abs(own[0] - expectB1) : 999;
if (!own.length) {
  console.log('[NG] バーストが起きていません');
  process.exitCode = 1;
} else if (drift > 1) {
  console.log('[NG] ゲージ満タンからのB1が参照実装から ' + drift + 'F ずれています: ' + own[0] + 'F');
  process.exitCode = 1;
} else {
  console.log('[OK] B1 ' + own[0] + 'F (参照 ' + expectB1 + 'F, 差 ' + drift + 'F)');
}
