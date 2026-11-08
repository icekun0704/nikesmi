/* モダニア (id 166 / org 78)
 *
 * バーストの殲滅モード。
 *   ・装弾数無限：15秒
 *   ・殲滅モード：照準範囲内のすべての敵を同時に照準（15秒）
 *
 * 通常攻撃は1体にしか当たらないので、モード中は残り全員にも同じ武器倍率で
 * 追加ダメージを与えて「全員に当たっている」状態にする。
 */
(function () {
  (window.SPECIALS = window.SPECIALS || {})[166] = {
    init: function (u, E) { u.modernia = { until: -1, baseMagazine: u.firing.magazine }; },

    onBurst: function (u, E, frame) {
      u.modernia.until = frame + 15 * E.FPS;
      u.firing.magazine = Infinity;
      u.firing.shotsInMagazine = 0;
    },

    tick: function (u, E, frame) {
      var st = u.modernia;
      if (st.until > 0 && frame > st.until) {
        st.until = -1;
        u.firing.magazine = st.baseMagazine;
        u.firing.shotsInMagazine = 0;
      }
    },

    onShot: function (u, E, frame) {
      if (u.modernia.until < frame) return;
      var mult = (u.char.stats && u.char.stats.weaponDamage) || 5.57;
      var es = E.alive(E.enemies(u));
      for (var i = 0; i < es.length; i++) {
        if (es[i] === u._lastTarget) continue;
        E.damage(u, es[i], frame, { multiplierPct: mult });
      }
    }
  };
})();
