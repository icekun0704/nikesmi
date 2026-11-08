/* 全キャラを1回ずつ戦わせて、例外・NaN・極端な値を洗い出す.
 *
 *   node tools/sweep.js [trials]
 */
require('./_env');
['data', 'stat_data', 'skills', 'gauge', 'stats', 'cubes', 'specials', 'engine'].forEach(function (f) {
  try { require('../js/' + f + '.js'); } catch (e) { console.log('load fail', f, e.message); }
});
Object.assign(global, window);

var trials = parseInt(process.argv[2] || '1', 10);
var C = window.CHARACTERS.slice();
var pool = ['リター', 'ノア', '紅蓮', 'アニス：スター', 'ノワール'].map(function (n) {
  return C.filter(function (c) { return c.name === n; })[0];
}).filter(Boolean);

var problems = [];
var worst = [];

C.forEach(function (c) {
  var teamA = [c].concat(pool.slice(0, 4));
  var teamB = pool.slice(0, 5);
  for (var t = 0; t < trials; t++) {
    var r;
    try {
      r = window.Engine.run(teamA, teamB, { seed: 31 + t * 101 });
    } catch (e) {
      problems.push(c.name + ' 例外: ' + e.message);
      break;
    }
    if (r.error) { problems.push(c.name + ' エラー: ' + r.error); break; }

    var units = r.teams.A.concat(r.teams.B);
    var nan = units.filter(function (u) {
      return !isFinite(u.hp) || !isFinite(u.hpMax) || !isFinite(u.damageDealt);
    });
    if (nan.length) { problems.push(c.name + ' NaN: ' + nan.map(function (u) { return u.name; }).join(',')); break; }

    var me = r.teams.A[0];
    var ratio = me.damageDealt / Math.max(1, me.hpMax);
    if (ratio > 50) worst.push({ name: c.name, ratio: ratio, dmg: me.damageDealt });
  }
});

console.log('対象', C.length, '体 / 問題', problems.length);
problems.slice(0, 20).forEach(function (p) { console.log('  ' + p); });

worst.sort(function (a, b) { return b.ratio - a.ratio; });
if (worst.length) {
  console.log('--- 与ダメージが自分のHPの50倍を超えたキャラ');
  worst.slice(0, 10).forEach(function (w) {
    console.log('  ' + w.name.padEnd(22) + ' x' + w.ratio.toFixed(1) + '  ' + Math.round(w.dmg));
  });
}
