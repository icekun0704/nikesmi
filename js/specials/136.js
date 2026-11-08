/* モリー (136 / org 153)
 *
 * パーサで表現できていない部分だけを実装する。
 *
 * 「必死の抵抗」= バリア（u.shield）が残っている状態、という状態機械を組む。
 *
 * 実装:
 *   1. スキル1「必死の抵抗が終了した時、自分に・最大HP5.06%▲：5スタック：持続」
 *      … バリアが 0 になった瞬間を tick で検出してスタックを積む（最大5）。
 *   2. バースト「自分が必死の抵抗状態なら自分に・バリアHP15.04%回復」
 *      … バリアが残っていれば最大HPの15.04%ぶんバリアを戻す。
 *   3. バースト「自分が必死の抵抗状態でなければ自分に・最大HP10.09%▲：10秒間維持」
 *      … バリアが無いときだけ10秒の最大HPバフ。
 *
 * 未実装（理由）:
 *   - スキル1の「バーストスキルを使用した時、必死の抵抗状態でなければバリア」
 *     … パーサが条件抜きで毎バースト発動させている。こちらからは打ち消せない。
 *   - スキル2「通常攻撃が60回命中した時、自分が必死の抵抗状態なら対象に挑発」…
 *     パーサが条件抜きで毎回発動させている。こちらからは打ち消せない。
 *   - スキル2「パーツを破壊した時」… アリーナにパーツが無い。
 */
(function () {
  'use strict';

  (window.SPECIALS = window.SPECIALS || {})[136] = {
    init: function (u, E) {
      u._mollyShieldPrev = u.shield || 0;
    },

    tick: function (u, E, frame) {
      var now = u.shield || 0;
      if (u._mollyShieldPrev > 0 && now <= 0) {
        /* 必死の抵抗が終了 → 最大HP5.06%▲ を5スタックまで */
        E.buff(u, 'molly-desp', 'maxHpPct', 5.06, 'up', Infinity, { maxStacks: 5 });
      }
      u._mollyShieldPrev = now;
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) {
      var hasBarrier = (u.shield || 0) > 0;
      if (hasBarrier) {
        /* バリアHPをスキル発動者の最終最大HPの15.04%ぶん回復 */
        u.shield = (u.shield || 0) + u.hpMax * 0.1504;
      } else {
        E.buff(u, 'molly-burst-hp', 'maxHpPct', 10.09, 'up', frame + 10 * E.FPS, {});
      }
    }
  };
})();
