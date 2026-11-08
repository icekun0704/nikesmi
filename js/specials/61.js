/* ギルティ (61 / org 49)
 *
 * パーサで表現できていない部分だけを実装する。
 *
 * 実装:
 *   スキル1「通常攻撃で6回攻撃した時、自分に
 *   ・借りていくよぉ⋯：攻撃力が最も高い味方1機の攻撃力のコピー8.81%：5スタック：10秒間維持」
 *   … 攻撃力が最も高い味方の最終攻撃力 × 8.81% を固定攻撃力として5スタックまで積む。
 *   engine の sumFlat はスタック数を掛けないので、5本ぶんの別キーで持つ。
 *
 * 未実装（理由）:
 *   - スキル2「スタック可能バフ効果のスタック量1個▲」… engine に対象を絞った
 *     スタック上限の概念が無く、パーサも op=stackBoost のまま捨てている。
 *   - バースト「借りていくよぉ⋯がフルスタック状態なら同じ敵に
 *     防御力20.25%▼／277.71%追加ダメージ」… パーサが条件抜きで毎回発動させており、
 *     こちらから打ち消せない（二重計上を避けるため触らない）。
 */
(function () {
  'use strict';

  var COPY_PCT = 8.81;    /* 原文のコピー率 */
  var STACKS = 5;         /* 原文: 5スタック */
  var DURATION = 10;      /* 原文: 10秒間維持 */

  function highestAtkAlly(u, E) {
    var team = E.alive(E.team(u));
    var best = null, bestAtk = -1;
    for (var i = 0; i < team.length; i++) {
      var a = E.atkEff(team[i]);
      if (a > bestAtk) { bestAtk = a; best = team[i]; }
    }
    return best;
  }

  (window.SPECIALS = window.SPECIALS || {})[61] = {
    init: function (u, E) {
      u._guiltyUntil = [];
      for (var i = 0; i < STACKS; i++) u._guiltyUntil.push(0);
    },

    tick: function (u, E, frame) { },

    onShot: function (u, E, frame, shot) {
      if (!u.counters || u.counters.attackShots % 6 !== 0) return;
      var src = highestAtkAlly(u, E);
      if (!src) return;
      var amount = E.atkEff(src) * COPY_PCT / 100;

      /* 一番早く切れるスロットを使い回す（最大5スタック） */
      var slot = 0;
      for (var i = 1; i < STACKS; i++) {
        if (u._guiltyUntil[i] < u._guiltyUntil[slot]) slot = i;
      }
      var until = frame + DURATION * E.FPS;
      u._guiltyUntil[slot] = until;
      E.buff(u, 'guilty-borrow-' + slot, 'atkFlat', amount, 'up', until, {});
    },

    onBurst: function (u, E, frame) { }
  };
})();
