/* エヌ：ミラクルフェアリー (id 40, RL, B2)
 *
 * パーサで表現できなかった部分:
 *   - スキル2「自分のHPが90%以上の時のみ味方全体に 受けるHP回復量23.46%▲：持続」
 *     trigger:unknown（条件 selfHpAbove 90）なので一度も発動しない。
 *     自分のHPが90%以上の間だけ味方全体にオーラとして付与する。
 *   - バースト「戦闘不能状態の火力型の味方ランダムに1機に HP99%で復活：
 *     戦闘中1回発動」も trigger:unknown。
 *     engine の resolveTargets は生存者しか対象にできないため、
 *     死亡した味方を直接蘇生する（1戦闘1回）。
 *
 * 実装していないもの:
 *   - 「ランダムに1機」の乱数。再現性を保つため、対象は編成順で最初の
 *     戦闘不能な火力型にする（同時に複数死亡しているケースのみ差が出る）。
 */
(function () {
  'use strict';

  function st(u) {
    if (!u.nFairy) u.nFairy = { reviveUsed: false };
    return u.nFairy;
  }

  (window.SPECIALS = window.SPECIALS || {})[40] = {
    init: function (u, E) {
      st(u);
    },

    tick: function (u, E, frame) {
      var s = st(u);

      // 自分のHPが90%以上の間だけ、味方全体へ 受けるHP回復量 +23.46%
      if (u.hpMax > 0 && (u.hp / u.hpMax) >= 0.90) {
        var team = E.team(u) || [];
        for (var i = 0; i < team.length; i++) {
          var a = team[i];
          if (!a.alive) continue;
          E.buff(a, 'nfairy-heal-aura', 'recoveryTakenPct', 23.46, 'up', frame + 1, { aura: true });
        }
      }
    },

    onBurst: function (u, E, frame) {
      var s = st(u);
      if (s.reviveUsed) return;

      var team = E.team(u) || [];
      var target = null;
      for (var i = 0; i < team.length; i++) {
        var a = team[i];
        if (a === u || a.alive) continue;
        if (!a.char || a.char.classType !== '火力型') continue;
        if (!target || a.pos < target.pos) target = a;
      }
      if (!target) return;

      s.reviveUsed = true;
      target.alive = true;
      target.deathFrame = -1;
      target.revived = true;
      target.hp = Math.round(target.hpMax * 0.99);
      target.invulnUntil = -1;
      E.event({
        frame: frame, kind: 'revive', side: u.side, unit: u.name,
        target: target.name, pos: target.pos
      });
    }
  };
})();
