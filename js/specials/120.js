/* ユルハ (id 120 / org 75)
 *
 * 実装する状態機械: 平常心（30回攻撃を受けると20秒間）と、その状態中のburst追加ダメージ
 *
 * 原文 skill1:
 *   30回攻撃を受けた時、自分に ・平常心：クリティカル確率24.53%▲：20秒間維持
 * 原文 burst:
 *   敵全体に ・最終攻撃力の457.87%のバーストスキルダメージ
 *   自分が平常心状態なら同じ対象に ・最終攻撃力の457.87%の追加ダメージ
 *
 * パーサ側の扱い:
 *   - 平常心そのもの（30ヒット毎のクリティカル確率+24.53%/20秒）は counter トリガーで
 *     パーサが付与済み。ここでは状態の期間だけを同じ条件で追跡する。
 *   - burst の追加ダメージは trigger=unknown で未実装。ここで実装する。
 */
(function () {
  'use strict';

  var HITS_PER_MIND = 30;
  var MIND_FRAMES = 20 * 60;
  var EXTRA_DMG = 457.87;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  (window.SPECIALS = window.SPECIALS || {})[120] = {
    init: function (u, E) {
      u.yulha = { mark: 0, mindUntil: -1 };
    },

    tick: function (u, E, frame) {
      var y = u.yulha;
      if (!y) return;
      /* 30回攻撃を受けた時 → 平常心（20秒間） */
      var n = Math.floor((u.counters.hitsTaken || 0) / HITS_PER_MIND);
      if (n > y.mark) {
        y.mark = n;
        y.mindUntil = frame + MIND_FRAMES;
      }
    },

    onShot: function (u, E, frame, shot) {
      /* 通常攻撃そのものの処理は無し */
    },

    onBurst: function (u, E, frame) {
      var y = u.yulha;
      if (!y) return;
      if (frame > y.mindUntil) return;

      /* 自分が平常心状態なら同じ対象に 457.87% の追加ダメージ */
      var enemies = E.alive(E.enemies(u));
      var dmg = EXTRA_DMG * scaleOf(u, 'burst');
      for (var i = 0; i < enemies.length; i++) {
        E.damage(u, enemies[i], frame, { multiplierPct: dmg, isBurst: true });
      }
    }
  };
})();
