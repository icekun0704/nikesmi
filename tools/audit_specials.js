/* 固有スキルに書かれた数値が、そのキャラのスキル本文に存在するか照合する.
 *
 *   node tools/audit_specials.js
 *
 * js/specials/*.js は並列で書いたので、転記ミスや創作した数値が混ざりうる。
 * 本文に無い数値は「要確認」として並べる（すべてが誤りとは限らない）。
 */
require('./_env');
require('../js/data.js');
require('../js/skills.js');

var fs = require('fs');
var path = require('path');

var C = window.CHARACTERS;
var byId = {};
C.forEach(function (c) { if (!byId[String(c.id)]) byId[String(c.id)] = c; });

var dir = path.join(__dirname, '..', 'js', 'specials');
var files = fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); });

var suspects = [];

files.forEach(function (file) {
  var id = file.replace(/\.js$/, '').replace(/star$/, '');
  var c = byId[id];
  if (!c) return;

  /* 本文（宝物の行も含む）を1つの文字列に */
  var text = '';
  ['skill1', 'skill2', 'burst'].forEach(function (k) {
    (c.skillText && c.skillText[k] || []).forEach(function (line) { text += line + '\n'; });
  });
  /* タグを落とす */
  var plain = text.replace(/<[^>]+>/g, '');

  var src = fs.readFileSync(path.join(dir, file), 'utf8');
  /* ダメージ倍率だけを見る（フレーム数などの定数は対象外） */
  var nums = {};
  var re = /multiplierPct\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
  var m;
  while ((m = re.exec(src))) nums[m[1]] = true;
  /* バフの数値（E.buff の第4引数が数値リテラルのときだけ） */
  var re3 = /E\.buff\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([0-9]+(?:\.[0-9]+)?)/g;
  while ((m = re3.exec(src))) nums[m[1]] = true;
  /* 定数定義（var X = 123.45）も、本文にあるべき数値として扱う */
  var re4 = /var\s+[A-Z][A-Z0-9_]*\s*=\s*([0-9]+\.[0-9]+)/g;
  while ((m = re4.exec(src))) nums[m[1]] = true;

  Object.keys(nums).forEach(function (v) {
    var n = Number(v);
    if (!isFinite(n) || n < 1) return;           /* 1未満は比率・確率なので対象外 */
    if (plain.indexOf(v) >= 0) return;           /* 本文にそのまま載っている */
    /* 小数第2位までに丸めた形で載っているか */
    var one = String(Math.round(n * 10) / 10);
    if (one !== v && plain.indexOf(one) >= 0) return;
    var two = String(Math.round(n * 100) / 100);
    if (two !== v && plain.indexOf(two) >= 0) return;
    /* 250% を 2.5 として持つような単位変換も許す */
    var pct = String(Math.round(n * 100));
    if (plain.indexOf(pct) >= 0) return;
    suspects.push({ name: c.name, file: file, value: v });
  });
});

var byName = {};
suspects.forEach(function (s) { (byName[s.name] = byName[s.name] || []).push(s.value); });
var keys = Object.keys(byName);

console.log('本文に見当たらない数値を持つ固有スキル: ' + keys.length + ' キャラ / ' + suspects.length + ' 件');
keys.slice(0, 40).forEach(function (n) {
  console.log('  ' + n + ' : ' + byName[n].join(', '));
});
if (keys.length > 40) console.log('  ...ほか ' + (keys.length - 40) + ' キャラ');
