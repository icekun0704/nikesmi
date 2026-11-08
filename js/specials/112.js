/* ラプンツェル：ピュアグレイス (id 112 / org 136)
 *
 * 原文のうちパーサで表現できていない部分。
 *
 *  スキル1: フルチャージ状態を1秒以上維持した場合、自分がバリア適用状態の時に限り、
 *          味方全体に「スキル発動者の最終最大HPの20.59%の共用バリア」（持続）
 *  スキル2: 同じ条件で、自分に「バリアHP回復3.16%（1秒間隔・持続）」
 *
 * 「共用バリア」はチームで1本のプールという説と各員に同額という説があり、
 * 原文からは決められない。ここでは各員に同額を配る（攻撃を受けた人数ぶん
 * 減る）という素直な解釈にしている。
 */
(function () {
  var CHARGE_HOLD = 60;      // 1秒
  var SHIELD_PCT = 20.59;    // 発動者の最終最大HP比
  var HEAL_PCT = 3.16;       // 1秒ごと

  (window.SPECIALS = window.SPECIALS || {})[112] = {
    init: function (u, E) {
      u.rpg = { chargeTicks: 0, lastTick: -1 };
    },

    tick: function (u, E, frame) {
      var st = u.rpg;
      var charging = u.firing.nextFrame - frame > 1;

      if (!charging) { st.chargeTicks = 0; return; }
      st.chargeTicks += 1;

      if (st.chargeTicks < CHARGE_HOLD) return;
      if (u.shield <= 0) return;              // バリア適用状態のときだけ
      if (frame - st.lastTick < 60) return;   // 1秒間隔
      st.lastTick = frame;

      // 味方全体に共用バリア
      var team = E.team(u);
      var amount = u.hpMax * SHIELD_PCT / 100;
      for (var i = 0; i < team.length; i++) {
        var a = team[i];
        if (!a.alive) continue;
        if (a.shield < amount) a.shield = amount;
      }

      // 自分にバリアHP回復（1秒ごと）
      E.heal(u, 0, frame);                    // 何もしない（HP回復ではない）
      u.shield = Math.min(u.hpMax * 0.5, u.shield + u.hpMax * HEAL_PCT / 100);
    }
  };
})();
