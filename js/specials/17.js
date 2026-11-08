/* バイパー (id 17, SG, B2, 火力型) — 宝物なし
 *
 * パーサで表現できなかった部分:
 *   - skill2「フルバーストタイムが発動した時、自分に
 *     愛嬌：単一攻撃対象から除外。攻撃を受けると解除。：10秒間維持」が unparsed。
 *     同じブロックの無敵1秒はパーサが動かしているので、その無敵の付与を
 *     フルバーストの検出に使い、愛嬌（u.hideUntil）を10秒ぶん付与する。
 *     被ダメージが増えたフレームで解除する。
 *
 * 実装上の注意:
 *   - このエンジンの pickTarget は u.hideUntil を見ていないため、現状 this 状態は
 *     ターゲット選択に影響しない（将来 engine が hideUntil を参照した時点で効く）。
 *     数値を推測して別の軽減に置き換えることはしていない。
 *
 * 発動しないのが正しいと判断して実装していないもの:
 *   - skill1「ターゲットが出現している場合、味方全体に 攻撃力25.98%▲／命中率11.13%▲」。
 *     『ターゲット』はレイド/射撃場の的のことで、アリーナには存在しない。
 *   - burst「対象がターゲットなら、同じ敵に防御力19.83%▼」も同じ理由。
 */
(function () {
  'use strict';

  var FPS = 60;
  var CHARM_SECONDS = 10;   // 愛嬌：10秒間維持

  (window.SPECIALS = window.SPECIALS || {})[17] = {
    init: function (u, E) {
      u.viper = {
        charmUntil: -1,
        lastInvuln: -1,
        lastTaken: 0
      };
    },

    tick: function (u, E, frame) {
      var v = u.viper;
      if (!v) return;

      // フルバースト時の無敵（skill2 の 1秒）が新しく付いた = フルバースト発動
      if (u.invulnUntil > frame && u.invulnUntil !== v.lastInvuln) {
        v.lastInvuln = u.invulnUntil;
        v.charmUntil = frame + CHARM_SECONDS * FPS;
        u.hideUntil = Math.max(u.hideUntil == null ? -1 : u.hideUntil, v.charmUntil);
        E.event({ frame: frame, kind: 'viper-charm', side: u.side, unit: u.name });
      }

      // 攻撃を受けると解除
      var taken = u.damageTaken || 0;
      if (v.charmUntil > frame && taken > v.lastTaken) {
        v.charmUntil = -1;
        u.hideUntil = -1;
      }
      v.lastTaken = taken;
    },

    onShot: function (u, E, frame, shot) {},

    onBurst: function (u, E, frame) {}
  };
})();
