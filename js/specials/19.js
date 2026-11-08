/* メイデン (19 / org 93)
 *
 * パーサで表現できていない部分だけを実装する。
 *
 * 実装:
 *   1. スキル1「20回攻撃を受けた時、自分に・復讐：攻撃力26.66%▲：20秒間持続」
 *      … パーサは duration を拾えず「持続（永続）」にしてしまっている。
 *      付与済みバフの until を「付与時 + 20秒」に直し、復讐の残り時間も持つ。
 *      （バフを新しく積むわけではないので二重計上にはならない）
 *   2. バースト「自分が復讐状態なら同じ対象に・最終攻撃力の457.87%の追加ダメージ」
 *      … trigger=unknown で落ちているので、バースト時に復讐中かを見て敵全体へ。
 *
 * 未実装: なし（スキル2の定期効果はパーサが periodic で処理済み）。
 */
(function () {
  'use strict';

  var ATK_VALUE = 26.66;   /* 原文: 攻撃力26.66%▲ */
  var DURATION = 20;       /* 原文: 20秒間持続 */
  var EXTRA_PCT = 457.87;  /* 原文: 最終攻撃力の457.87% */

  (window.SPECIALS = window.SPECIALS || {})[19] = {
    init: function (u, E) {
      u._maidenRevengeUntil = -1;
    },

    tick: function (u, E, frame) {
      var buffs = u.buffs;
      if (!buffs) return;
      for (var i = 0; i < buffs.length; i++) {
        var b = buffs[i];
        if (b.stat !== 'atkPct') continue;
        if (Math.abs((b.value || 0) - ATK_VALUE) > 0.001) continue;
        /* 「20秒間持続」を反映（パーサは永続にしている） */
        if (b.until === Infinity) {
          b.until = (b.refreshed == null ? frame : b.refreshed) + DURATION * E.FPS;
        }
        if (b.until >= frame && b.until > u._maidenRevengeUntil) {
          u._maidenRevengeUntil = b.until;
        }
      }
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) {
      if (frame > u._maidenRevengeUntil) return;
      var enemies = E.alive(E.enemies(u));
      for (var i = 0; i < enemies.length; i++) {
        E.damage(u, enemies[i], frame, { multiplierPct: EXTRA_PCT });
      }
    }
  };
})();
