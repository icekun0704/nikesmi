/* D (id 147, SMG, B3, 火力型) — 宝物なし
 *
 * パーサで表現できなかった部分:
 *   - skill1「初回発動時、追加で自分に 攻撃ダメージの16.5%回復：15秒間維持」が
 *     trigger=unknown で発火しない。同じ skill1 の 3.52% 側は fullBurst で
 *     エンジンが発動する（op lifesteal は継続時間を無視して永続値になる）ので、
 *     その最初の発動を検出して 16.5% を上乗せする。
 *
 * 発動しないのが正しいと判断して実装していないもの:
 *   - skill2「ターゲットが出現している場合」の2ブロック（バーストゲージ98.56%、
 *     気絶免疫36.95秒／有利コードの攻撃ダメージ91.09%）。
 *     『ターゲット』はレイド/射撃場の的で、アリーナには存在しない。
 *   - burst「自分が気絶免疫状態なら、味方全体に フルバーストタイム5.04秒▲」。
 *     気絶免疫は上のターゲット出現時しか得られず、アリーナでは常に偽。
 *     またエンジンに fullBurstExtend の処理は無い。
 *   - burst「火力型の味方全体に パーツダメージ42.38%▲」はアリーナに部位が無い。
 */
(function () {
  'use strict';

  var BASE_LIFESTEAL = 3.52;   // skill1 の常時分（パーサが fullBurst で付与）
  var EXTRA_LIFESTEAL = 16.5;  // 初回発動時の追加分

  (window.SPECIALS = window.SPECIALS || {})[147] = {
    init: function (u, E) {
      u.dUnit = { extraApplied: false };
    },

    tick: function (u, E, frame) {
      var d = u.dUnit;
      if (!d || d.extraApplied) return;
      // パーサの lifesteal 3.52% が付いた = skill1 の初回発動
      if ((u.lifestealPct || 0) >= BASE_LIFESTEAL - 1e-9) {
        d.extraApplied = true;
        u.lifestealPct = Math.max(u.lifestealPct, EXTRA_LIFESTEAL);
        E.event({ frame: frame, kind: 'd-first-lifesteal', side: u.side, unit: u.name });
      }
    },

    onShot: function (u, E, frame, shot) {},

    onBurst: function (u, E, frame) {}
  };
})();
