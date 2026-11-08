/* モラン (id 84 / org 17)
 *
 * 実装する状態機械: 使用武器変更（burst）と、その状態中の5ヒット追加ダメージ
 *
 * 原文 burst:
 *   自分に ・使用武器変更 最終攻撃力の14.7%のダメージ：10秒間維持
 *   追加効果 ・攻撃ダメージの36.14%回復：10秒間維持
 *          ・ヘイト：敵全体を挑発：10秒間維持
 *          ・装弾数無限：10秒間維持
 *   味方全体に ・受けるダメージ35.14%▼：10秒間維持
 *              ・スキル発動者基準で防御力14.85%▲：10秒間維持
 * 原文 skill1:
 *   戦闘開始時、自分に ・失ったHP1%につき防御力3.51%▲：持続
 *   自分が武器変更状態の場合、通常攻撃が5回命中した時、対象に
 *   ・最終攻撃力の47.18%の追加ダメージ
 *
 * パーサ側の扱い:
 *   - 武器変更の本体（weaponChange）は op としては解釈されるが engine 側に
 *     武器を差し替える仕組みが無い。ここでは「武器変更状態」の期間だけを保持し、
 *     その間に発生する 47.18% の追加ダメージ（trigger=unknown）を実装する。
 *   - 装弾数無限（infiniteMagazine）も engine に無い。
 *   - 「失ったHP1%につき防御力3.51%▲」はパーサが定数 3.51% として付与済み
 *     （HP依存の動的スケーリングは表現できていないが、二重計上を避けて触らない）。
 */
(function () {
  'use strict';

  var WEAPON_CHANGE_FRAMES = 10 * 60;
  var HIT_STEP = 5;
  var EXTRA_DMG = 47.18;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  (window.SPECIALS = window.SPECIALS || {})[84] = {
    /* E.pickTarget は README では (u, frame)、engine の実装は (u, enemies, frame)。 */
    _target: function (u, E, frame) {
      if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
      try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
    },

    init: function (u, E) {
      u.moran = { weaponUntil: -1, hits: 0 };
    },

    tick: function (u, E, frame) {
      /* 状態の期限管理のみ */
    },

    onShot: function (u, E, frame, shot) {
      var m = u.moran;
      if (!m) return;
      if (frame > m.weaponUntil) { m.hits = 0; return; }

      /* 自分が武器変更状態の場合、通常攻撃が5回命中した時 */
      m.hits += (shot && shot.hits) || 1;
      if (m.hits % HIT_STEP === 0) {
        var target = this._target(u, E, frame);
        if (target) {
          E.damage(u, target, frame, { multiplierPct: EXTRA_DMG * scaleOf(u, 'skill1') });
        }
      }
    },

    onBurst: function (u, E, frame) {
      var m = u.moran;
      if (!m) return;
      /* 使用武器変更：10秒間 */
      m.weaponUntil = frame + WEAPON_CHANGE_FRAMES;
      m.hits = 0;
    }
  };
})();
