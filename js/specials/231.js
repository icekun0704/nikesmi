/* 紅蓮：神殺 (id 231 / org 206)
 *
 * スキル1の「居合」。戦闘開始時から、
 * 通常攻撃のたびに照準線に最も近い敵1機へ 最終攻撃力の109% の追加ダメージ。
 * これはパーサでは battleStart の1回きりになってしまうので、ここで毎回にする。
 *
 * スキル2の「居合の追加ダメージ倍率が100%効果量に対し増加」は
 * バースト後、居合の倍率を +100% する（109% → 209%）。
 */
(function () {
  var IAI = 109;          // 通常時の居合ダメージ（%）
  var IAI_BOOST = 100;    // バースト後の上乗せ（%）

  (window.SPECIALS = window.SPECIALS || {})[231] = {
    init: function (u, E) { u.scarletG = { boosted: false }; },

    onBurst: function (u, E, frame) {
      u.scarletG.boosted = true;
    },

    onShot: function (u, E, frame) {
      var t = E.pickTarget(u, frame);
      if (!t) return;
      var mult = IAI + (u.scarletG.boosted ? IAI_BOOST : 0);
      E.damage(u, t, frame, { multiplierPct: mult });
    }
  };
})();
