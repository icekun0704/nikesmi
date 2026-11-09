/* 実戦ログのキャラ対応が壊れていないかを確認する。
 * ここが崩れると validate.js は「別のキャラ同士」を戦わせて静かに無意味な数字を出す。
 *
 *   node tools/test_validate_map.js
 */
const path = require('path');
require('./_env');
['data'].forEach(f => require('../js/' + f + '.js'));
const NKMAP = require('./nk_map.js');

const chars = window.CHARACTERS;
const nk = NKMAP.loadNK();
const res = NKMAP.build(chars, nk);

let fail = 0;
const nkCount = nk.filter(r => r.id !== 9999 && r.name !== '空枠').length;
const mapped = Object.keys(res.map).length;

if (res.problems.length) {
  console.log('[NG] 対応に ' + res.problems.length + ' 件の問題:');
  res.problems.forEach(p => console.log('  ' + p));
  fail = 1;
}
if (mapped < nkCount) {
  console.log('[NG] ' + nkCount + ' 体中 ' + (nkCount - mapped) + ' 体が engine に結びついていません');
  fail = 1;
}

/* 代表的な取り違えを直接確かめる（id 体系が違うことの記録）。 */
const spot = [[107, 'モラン'], [97, 'ノイズ'], [131, 'ノア'], [52, 'ジャッカル'], [129, '紅蓮']];
spot.forEach(([id, name]) => {
  const got = res.map[id];
  if (!got || got.name !== name) {
    console.log('[NG] id ' + id + ' は ' + name + ' のはずが ' + (got ? got.name : '未対応'));
    fail = 1;
  }
});

if (!fail) console.log('[OK] 実戦ログのキャラ対応 ' + mapped + '/' + nkCount + ' 体');
process.exitCode = fail;
