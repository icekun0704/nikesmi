/* ランダムな5vs5を大量に回して、例外・NaN・暴走を洗い出す。
 * sweep.js は「1キャラ vs 固定チーム」なので、編成同士の相互作用は見ていない。
 *
 *   node tools/sweep_teams.js [n]
 */
require('./_env');
['data', 'stat_data', 'skills', 'gauge', 'stats', 'cubes', 'specials', 'engine'].forEach(function (f) {
  try { require('../js/' + f + '.js'); } catch (e) { console.log('load fail', f, e.message); }
});
Object.assign(global, window);

var N = parseInt(process.argv[2] || '300', 10);
var C = window.CHARACTERS.slice();
var problems = [];
var slow = [];
var draws = 0, finished = 0;
var maxFrames = 0;

function rnd(seed) { // mulberry32
  var s = seed >>> 0;
  return function () {
    s = s + 0x6D2B79F5 | 0;
    var t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function pickTeam(r) {
  var used = {}, team = [];
  while (team.length < 5) {
    var i = Math.floor(r() * C.length);
    var c = C[i];
    if (used[c.id]) continue;
    used[c.id] = 1;
    team.push(c);
  }
  return team;
}

var t0 = Date.now();
for (var i = 0; i < N; i++) {
  var r = rnd(9001 + i * 2654435761);
  var A = pickTeam(r), B = pickTeam(r);
  var res;
  try {
    res = window.Engine.run(A, B, { seed: 7 + i, arenaMode: i % 2 ? 'c' : 'normal' });
  } catch (e) {
    problems.push('#' + i + ' 例外: ' + e.message + ' A=' + A.map(function (c) { return c.name; }).join(','));
    continue;
  }
  if (res.error) { problems.push('#' + i + ' エラー: ' + res.error); continue; }
  var units = res.teams.A.concat(res.teams.B);
  var bad = units.filter(function (u) {
    return !isFinite(u.hp) || !isFinite(u.hpMax) || !isFinite(u.damageDealt) || u.hpMax <= 0;
  });
  if (bad.length) {
    problems.push('#' + i + ' NaN: ' + bad.map(function (u) { return u.name; }).join(',') +
      ' A=' + A.map(function (c) { return c.name; }).join(','));
    continue;
  }
  finished++;
  if (res.winner === 'draw') draws++;
  if (res.frames > maxFrames) maxFrames = res.frames;
  if (res.frames > 90 * 60) {
    slow.push('#' + i + ' ' + (res.frames / 60).toFixed(0) + 's A=' + A.map(function (c) { return c.name; }).join(','));
  }
}

console.log('試行 ' + N + ' / 完走 ' + finished + ' / 引き分け ' + draws +
  ' / 最長 ' + (maxFrames / 60).toFixed(1) + 's / ' + (Date.now() - t0) + 'ms');
console.log('問題 ' + problems.length + (problems.length ? ':\n  ' + problems.slice(0, 12).join('\n  ') : ''));
if (slow.length) console.log('90秒超 ' + slow.length + ':\n  ' + slow.slice(0, 6).join('\n  '));
process.exitCode = problems.length ? 1 : 0;
