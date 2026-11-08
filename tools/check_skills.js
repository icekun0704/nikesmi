/* スキル解釈の健全性チェック.
 *
 *   node tools/check_skills.js
 *
 * パーサを触ったときに、静かに壊れやすい箇所を機械的に見つける。
 * ここが赤くなったままにしないこと。
 */
global.window = {};
require('../js/data.js');
require('../js/skills.js');

var C = window.CHARACTERS;
var DB = window.SKILL_DB;
var SLOTS = ['skill1', 'skill2', 'burst'];

/* エンジンが発動できるトリガー */
var TRIGGERS = {
  always: 1, battleStart: 1, periodic: 1, counter: 1, burst: 1, burstStage: 1,
  fullBurst: 1, fullBurstEnd: 1, allyBurst: 1, enemyDeath: 1, allyDeath: 1,
  selfDeath: 1, lastBullet: 1, reload: 1, fullChargeShot: 1, hitTaken: 1,
  attack: 1, never: 1, unknown: 1
};

var problems = [];

function report(kind, detail) {
  problems.push(kind + ': ' + detail);
}

/* 1. 全キャラがスキル定義を持っているか */
C.forEach(function (c) {
  var key = String(c.orgId) + (c.treasure ? '*' : '');
  if (!DB[key]) report('missing-skill', c.name + ' (key ' + key + ')');
});

/* 2. トリガーの種類がエンジンの知っているものか */
Object.keys(DB).forEach(function (key) {
  SLOTS.forEach(function (slot) {
    var blocks = (DB[key][slot] || {}).blocks || [];
    blocks.forEach(function (b, i) {
      var t = b.trigger || {};
      if (!TRIGGERS[t.kind]) {
        report('bad-trigger', key + ' ' + slot + '#' + i + ' = ' + t.kind);
      }
      /* 3. 条件はトリガーではなく conditions に入っていること */
      if (t.kind === 'selfHpAbove' || t.kind === 'selfHpBelow') {
        report('condition-as-trigger', key + ' ' + slot + '#' + i + ' ' + b.raw);
      }
      /* 4. ダメージだけの常時ブロックは発動しない（意図しない取りこぼし） */
      var eff = b.effects || [];
      if (t.kind === 'always' && eff.length &&
          eff.every(function (e) { return e.op === 'damage'; })) {
        report('dead-damage-block', key + ' ' + slot + '#' + i + ' ' + b.raw);
      }
      /* 5. 回数指定だけ残って本体が常時のブロック（回数が無視される） */
      if (t.nth && t.kind === 'always') {
        report('nth-without-trigger', key + ' ' + slot + '#' + i + ' ' + b.raw);
      }
    });
  });
});

/* 6. 数値が壊れていないか */
Object.keys(DB).forEach(function (key) {
  SLOTS.forEach(function (slot) {
    ((DB[key][slot] || {}).blocks || []).forEach(function (b, i) {
      (b.effects || []).forEach(function (e) {
        if (e.value != null && !isFinite(e.value)) {
          report('nan-value', key + ' ' + slot + '#' + i + ' ' + (e.raw || ''));
        }
        if (e.value != null && Math.abs(e.value) > 100000) {
          report('huge-value', key + ' ' + slot + '#' + i + ' ' + e.value + ' ' + (e.raw || ''));
        }
      });
    });
  });
});

if (problems.length) {
  console.log('問題 ' + problems.length + ' 件');
  problems.slice(0, 60).forEach(function (p) { console.log('  ' + p); });
  process.exitCode = 1;
} else {
  console.log('スキル解釈チェック: 問題なし (' + C.length + ' 体 / ' + Object.keys(DB).length + ' 定義)');
}
