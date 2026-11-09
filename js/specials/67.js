/* メアリー (id 67 / org 11)
 *
 * パーサが表現できていない部分だけを実装する。
 *  - バースト「自分のHPが50%以上なら味方全体に 防御力19.8%▲：10秒間維持」
 *    （パーサはトリガー不明で落としている）
 *
 * バーストの回復はパーサが動かしているので触らない。
 */
(function () {
  (window.SPECIALS = window.SPECIALS || {})[67] = {
  /* 味方全体の防御力バフはここで実装している */
  suppress: { burst: [0] },
    init: function (u, E) {
      u.mary = {};
    },

    onBurst: function (u, E, frame) {
      if (!u.mary) return;
      if ((u.hp / u.hpMax) * 100 < 50) return;
      var team = E.team(u);
      for (var i = 0; i < team.length; i++) {
        if (!team[i].alive) continue;
        E.buff(team[i], 'mary-def-' + team[i].pos, 'defPct', 19.8, 'up',
          frame + 10 * E.FPS);
      }
    }
  };
})();
