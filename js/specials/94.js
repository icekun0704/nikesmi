/* ベロータ (id 94 / org 67, RL, B2, 火力型, 電撃)
 *
 * 原文の状態機械:
 *   skill1
 *     フルチャージして攻撃した時、自分に 爆発範囲9.55%▲：5秒間維持  ← パーサ済み
 *   skill2
 *     通常攻撃した時、4機以上同時に命中した場合は対象に
 *       防御力3.52%▼：5秒間維持
 *       最終攻撃力の14.96%の追加ダメージ
 *   burst
 *     攻撃範囲内の敵に 最終攻撃力の192%のダメージ／
 *       味方全体に チャージ速度2.82%▲：10秒                ← どちらもパーサ済み
 *
 * パーサの扱い:
 *   - skill2 は trigger:unknown（「4機以上同時に命中した場合」）。
 *     engine の通常攻撃は RL の爆発範囲内（slotsInRange）に当たるので、
 *     同じ範囲を計算し直して4機以上のときだけ効果を適用する。
 *
 * 実装しないもの:
 *   - なし（原文の効果はこれだけ）。
 */
(function () {
  'use strict';

  var FPS = 60;
  var NEED_TARGETS = 4;          /* 4機以上同時に命中した場合 */
  var DEF_DOWN_PCT = 3.52;       /* 防御力3.52%▼：5秒 */
  var EXTRA_PCT = 14.96;         /* 最終攻撃力の14.96%の追加ダメージ */
  var DEF_SEC = 5;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  (window.SPECIALS = window.SPECIALS || {})[94] = {
    init: function (u, E) { },

    tick: function (u, E, frame) { },

    onShot: function (u, E, frame, shot) {
      if (u.weapon !== 'RL') return;
      var enemies = E.enemies(u);
      var primary = E.pickTarget(u, enemies, frame);
      if (!primary) return;

      /* engine と同じ爆発範囲（爆発範囲%バフを含む） */
      var range = (u.char.rlExplosionRange == null ? 1 : u.char.rlExplosionRange);
      range += Math.round(range * E.sumStat(u, 'explosionRangePct') / 100);
      var targets = E.slotsInRange(enemies, primary.pos, range);
      if (targets.length < NEED_TARGETS) return;

      var def = DEF_DOWN_PCT * scaleOf(u, 'skill2');
      var dmg = EXTRA_PCT * scaleOf(u, 'skill2');
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        E.buff(t, 'belorta-def:' + u.pos + ':' + t.pos, 'defPct', def, 'down',
          frame + DEF_SEC * FPS, {});
        E.damage(u, t, frame, { multiplierPct: dmg });
      }
      E.event({ frame: frame, kind: 'belorta-multi', side: u.side, unit: u.name,
                targets: targets.length });
    },

    onBurst: function (u, E, frame) { }
  };
})();
