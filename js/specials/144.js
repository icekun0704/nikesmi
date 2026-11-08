/* ジュリア（宝物） (id 144 / org 96)
 *
 * クリティカル命中の回数で進む2つの効果。
 *   通常攻撃が6回クリティカル命中した時、自分に
 *     クレッシェンド（クリティカルダメージ24.79%▲）：5スタックまで：15秒
 *   通常攻撃が8回クリティカル命中した時、対象に
 *     マルカート：最終攻撃力の88% の追加ダメージ
 *   マルカートがクリティカル命中した時、同じ敵に
 *     最終攻撃力の100% の追加ダメージ
 *   バースト時、クレッシェンドがフルスタックなら同じ敵に 544.5% を追加
 */
(function () {
  (window.SPECIALS = window.SPECIALS || {})[144] = {
    init: function (u, E) { u.julia = { crits: 0, stacks: 0, marcato: false }; },

    onShot: function (u, E, frame) {
      var st = u.julia;
      if (!u._lastCrit) return;
      st.crits += 1;
      var t = u._lastTarget;
      if (!t || !t.alive) return;

      // マルカートがクリティカル命中した時、さらに100%
      if (st.marcato) {
        st.marcato = false;
        E.damage(u, t, frame, { multiplierPct: 100 });
      }

      if (st.crits % 6 === 0 && st.stacks < 5) {
        st.stacks += 1;
        E.buff(u, 'julia-cresc', 'critDmgPct', 24.79 * st.stacks, 'up', frame + 15 * E.FPS);
      }
      if (st.crits % 8 === 0) {
        st.marcato = true;
        E.damage(u, t, frame, { multiplierPct: 88 });
      }
    },

    onBurst: function (u, E, frame) {
      if (u.julia.stacks < 5) return;
      var t = E.pickTarget(u, frame);
      if (!t) return;
      E.damage(u, t, frame, { multiplierPct: 544.5 });
    }
  };
})();
