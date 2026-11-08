/* アリス (167 / org 74)
 *
 * パーサで表現できていない部分だけを実装する。
 *
 * 実装:
 *   スキル2「自分のHPが80%以上なら自分に・貫通特化／
 *   自分のHPが80%未満なら自分に・攻撃ダメージの8.12%を回復」
 *   … 毎フレームHP割合を見て状態を切り替える。
 *     HP80%未満のときだけ lifesteal = 8.12% にする（engine の applyDamage が
 *     与ダメージ × lifestealPct を回復に回す）。
 *
 * 未実装（理由）:
 *   - 「貫通特化」… 貫通は Gauge が生成時に char.hasPenetration から決めており、
 *     戦闘中に切り替える口が無い（ダメージ計算側も貫通を見ていない）。
 *   - スキル1／バーストの「チャージ速度▲」… パーサは chargeSpeedPct として
 *     バフを積むが、engine の射撃間隔は生成時に確定しており sumStat を見ていない。
 *     ここで engine を真似て間隔を書き換えると、engine 側が対応したときに
 *     二重に速くなるため触らない。
 */
(function () {
  'use strict';

  var LIFESTEAL_PCT = 8.12;  /* 原文: 攻撃ダメージの8.12%を回復 */
  var HP_THRESHOLD = 80;     /* 原文: HP80% */

  (window.SPECIALS = window.SPECIALS || {})[167] = {
    init: function (u, E) {
      u.lifestealPct = 0;
    },

    tick: function (u, E, frame) {
      var ratio = u.hpMax > 0 ? (u.hp / u.hpMax) * 100 : 0;
      if (ratio < HP_THRESHOLD) {
        u.lifestealPct = LIFESTEAL_PCT;
      } else {
        u.lifestealPct = 0;
      }
    },

    onShot: function (u, E, frame, shot) { },
    onBurst: function (u, E, frame) { }
  };
})();
