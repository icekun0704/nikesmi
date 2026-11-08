/* ラプンツェル (id 34, RL, B1, 支援型) — 宝物なし
 *
 * パーサで表現できなかった部分:
 *   - burst「戦闘不能状態の攻撃力が最も高い味方1機に HP81.67%で復活」が
 *     trigger=unknown。engine の op revive は『自分が死んだ時に復活する』
 *     自分自身用の仕組みで、死んでいる味方を選んで復活させることはできない。
 *     ここで戦闘不能の味方から最終攻撃力が最も高い1機を選び、HP81.67%で復活させる。
 *   - burst「自分のHPが30%以下なら敵全体に 気絶：1秒間維持」も trigger=unknown。
 *     バースト発動時点の自分のHPで判定し、敵全体を1秒気絶させる。
 *
 * 不明点:
 *   - 復活は「バースト発動時点で死んでいる味方」を対象とする（原文に時系列の
 *     指定は無い）。バーストの回復（40.83%）より先に復活させるため、
 *     復活した味方も同じバーストの回復対象に入る。
 *   - 復活時の遮蔽物HPは原文に記述が無いので触らない。
 */
(function () {
  'use strict';

  var FPS = 60;
  var REVIVE_PCT = 81.67;    // HP81.67%で復活
  var STUN_SECONDS = 1;      // 気絶：1秒間維持
  var HP_THRESHOLD = 30;     // 自分のHPが30%以下なら

  (window.SPECIALS = window.SPECIALS || {})[34] = {
    init: function (u, E) {
      u.rapunzel = {};
    },

    tick: function (u, E, frame) {},

    onShot: function (u, E, frame, shot) {},

    onBurst: function (u, E, frame) {
      // 戦闘不能状態の攻撃力が最も高い味方1機を HP81.67% で復活
      var team = E.team(u);
      var dead = [];
      for (var i = 0; i < team.length; i++) {
        if (team[i] !== u && !team[i].alive) dead.push(team[i]);
      }
      if (dead.length) {
        dead.sort(function (a, b) { return E.atkEff(b) - E.atkEff(a); });
        var r = dead[0];
        r.alive = true;
        r.deathFrame = -1;
        r.revived = true;
        r.hp = Math.max(1, Math.round(r.hpMax * REVIVE_PCT / 100));
        E.event({ frame: frame, kind: 'revive', side: u.side, unit: u.name,
                  target: r.name, pos: r.pos, hpPct: REVIVE_PCT });
      }

      // 自分のHPが30%以下なら敵全体に気絶1秒
      if (u.hpMax > 0 && (u.hp / u.hpMax) * 100 <= HP_THRESHOLD) {
        var foes = E.alive(E.enemies(u));
        var until = frame + STUN_SECONDS * FPS;
        for (var k = 0; k < foes.length; k++) {
          var f = foes[k];
          f.stunUntil = Math.max(f.stunUntil == null ? -1 : f.stunUntil, until);
        }
        E.event({ frame: frame, kind: 'rapunzel-stun', side: u.side, unit: u.name,
                  targets: foes.length });
      }
    }
  };
})();
