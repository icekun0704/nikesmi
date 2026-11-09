/* 実戦ログ（nikkeari）のキャラ id → js/data.js のキャラ の対応表。
 *
 * 両者は id 体系が違う。107 は実戦ログではモランだが engine ではミルク。
 * 名前で突き合わせ、武器・属性・バースト段階で裏を取る。
 */
const fs = require('fs');
const path = require('path');

/* 表記ゆれ（コラボキャラのフルネーム、中黒・コロンの差）だけをここで吸収する。 */
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

/* 実戦データ側の記載が誤っていて、ゲーム内バンドルと食い違うもの。
 * engine（ゲーム内データ由来）を正とするので、対応表としては成立させる。 */
const KNOWN_BAD_SOURCE = {
  'マナ': '実戦ログは灼熱、ゲーム内は風圧',
  'リリー': '実戦ログはB1、ゲーム内はB2'
};

function normName(s) {
  return String(s).replace(/[：:・\s　()（）]/g, '');
}

function loadNK() {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'work', 'characters.json'), 'utf8'));
}

/* CHARACTERS（js/data.js）と nikkeari の配列から { map, problems } を作る。 */
function build(chars, nk) {
  const byName = {};
  chars.forEach(c => { if (!c.treasure) byName[normName(c.name)] = c; });
  const map = {};
  const problems = [];
  nk.forEach(row => {
    if (row.id === 9999 || row.name === '空枠') return;
    const target = ALIAS[row.name] || row.name;
    const hit = byName[normName(target)];
    if (!hit) { problems.push('未対応 ' + row.id + ' ' + row.name); return; }
    /* レッドフードは段階を自分で上げるので実戦ログ側が 'A'、engine 側が 'B123'。 */
    const burst = row.burst_phase === 'A' ? 'B123' : 'B' + row.burst_phase;
    if (hit.weapon !== row.weapon || hit.element !== row.element || hit.burstStage !== burst) {
      if (!KNOWN_BAD_SOURCE[row.name]) {
        problems.push('属性不一致 ' + row.name + ' → ' + hit.name +
        ' (nikkeari ' + row.weapon + '/' + row.element + '/' + burst +
          ' vs engine ' + hit.weapon + '/' + hit.element + '/' + hit.burstStage + ')');
      }
    }
    map[row.id] = hit;
  });
  return { map: map, problems: problems };
}

module.exports = { ALIAS: ALIAS, KNOWN_BAD_SOURCE: KNOWN_BAD_SOURCE, normName: normName, loadNK: loadNK, build: build };
