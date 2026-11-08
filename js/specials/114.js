/* ウンファ：タクティカル・アップ (114 / org 164)
 *
 * パーサで表現できていない部分だけを実装する。
 *
 * 実装:
 *   スキル2「自分が生存している限り・フォーメーションAS」
 *     「効果1：同じ部隊の味方全体にクリティカル確率8.16%▲：持続」
 *     「効果2：味方全体にチャージダメージ41.81%▲：持続」
 *   … パーサはこのブロックの対象を self にしてしまい、自分にしか配っていない。
 *     engine の buff() は キー + stat で1本にまとめるので、自分以外の味方に
 *     同じ値を配っても二重計上にはならない。
 *     （効果3の自分への攻撃力42.24%▲はパーサが正しく処理済み）
 *
 * 未実装（理由）:
 *   - スキル1「カモフラージュ：単一攻撃対象から除外／直接攻撃を受けると解除」…
 *     engine の pickTarget は pos 順で選ぶだけで、対象除外の口が無い。
 *   - スキル1「カモフラージュ状態である限り、通常攻撃が防御力無視ダメージに変化」…
 *     通常攻撃の防御力無視は engine の射撃処理側で決まっており、special から
 *     1発だけ差し替えることができない。
 *   - バースト「使用武器変更（チャージ0.3秒 / 105.6%防御力無視 / フルチャージ300% /
 *     最大装弾数1発）」… engine に武器差し替えの仕組みが無い。
 *   - スキル2「フォーメーションLT適用中、効果を追加」… LT の条件が不明。
 */
(function () {
  'use strict';

  var CRIT_RATE = 8.16;      /* 原文: クリティカル確率8.16%▲ */
  var CHARGE_DMG = 41.81;    /* 原文: チャージダメージ41.81%▲ */

  (window.SPECIALS = window.SPECIALS || {})[114] = {
    init: function (u, E) {
      var team = E.team(u);
      for (var i = 0; i < team.length; i++) {
        var m = team[i];
        if (m === u) continue;   /* 自分ぶんはパーサが配っている */
        E.buff(m, 'eunhwa-as-crit', 'critRate', CRIT_RATE, 'up', Infinity, {});
        E.buff(m, 'eunhwa-as-charge', 'chargeDmgPct', CHARGE_DMG, 'up', Infinity, {});
      }
    },
    tick: function (u, E, frame) { },
    onShot: function (u, E, frame, shot) { },
    onBurst: function (u, E, frame) { }
  };
})();
