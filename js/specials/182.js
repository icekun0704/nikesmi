/* レム (id 182 / org 115)
 *
 * スキル1の条件「自分が鬼の気状態なら」が読めず、15回命中の効果が発動しない。
 * 鬼の気はバーストで自分に付く（クリティカル確率37.8%▲：10秒）。
 * バースト後10秒のあいだだけ、通常攻撃15回ごとに攻撃力4.22%を30スタックまで積む。
 */
(function () {
  (window.SPECIALS = window.SPECIALS || {})[182] = {
    init: function (u, E) { u.rem = { oniUntil: -1, hits: 0, stacks: 0 }; },

    onBurst: function (u, E, frame) {
      u.rem.oniUntil = frame + 10 * E.FPS;
      u.rem.hits = 0;
      u.rem.stacks = 0;
    },

    onShot: function (u, E, frame) {
      var st = u.rem;
      if (frame > st.oniUntil) return;
      st.hits += 1;
      if (st.hits % 15 !== 0) return;
      if (st.stacks >= 30) return;
      st.stacks += 1;
      E.buff(u, 'rem-oni', 'atkPct', 4.22 * st.stacks, 'up', frame + 10 * E.FPS);
    }
  };
})();
