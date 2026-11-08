/* エマ (id 174, MG, B1, 支援型) — 宝物なし
 *
 * パーサで表現できなかった部分:
 *   - skill1「撃たれた時、5%の確率で味方全体に スキル発動者の最終最大HPの10.77%を回復」は
 *     trigger=hitTaken だが、engine に hitTaken の発火箇所が無いため一度も動かない。
 *     被弾数（u.counters.hitsTaken）の増分を見て、ヒットごとに5%を引く。
 *     乱数は engine の rng が API に出ていないので、ユニットごとの決定的LCGを使う
 *     （同じシードのシミュレーションは常に同じ結果になる）。
 *   - skill2「自分のHPが90%以上の時のみ味方全体に 受けるHP回復量13.33%▲：持続」は
 *     trigger=unknown（条件 selfHpAbove 90 付き）で発火しない。毎フレーム条件を
 *     見て、満たしている間だけ短い期限でバフを貼り直す。
 *
 * 不明点:
 *   - 「撃たれた時」の1回の判定単位。エンジンは1射撃のヒット数をまとめて
 *     hitsTaken に加算するので、そのヒット数ぶん判定する。
 */
(function () {
  'use strict';

  var FPS = 60;
  var PROC_CHANCE = 0.05;      // 5%
  var HEAL_PCT = 10.77;        // スキル発動者の最終最大HPの10.77%
  var HP_THRESHOLD = 90;       // 自分のHPが90%以上
  var RECOVERY_TAKEN = 13.33;  // 受けるHP回復量▲

  (window.SPECIALS = window.SPECIALS || {})[174] = {
    init: function (u, E) {
      var seed = (u.id * 2654435761 + u.pos * 40503 +
                  (u.side === 'A' ? 12345 : 54321)) >>> 0;
      u.emma = { lastHits: u.counters ? (u.counters.hitsTaken || 0) : 0, seed: seed };
    },

    tick: function (u, E, frame) {
      var em = u.emma;
      if (!em) return;

      // 被弾ごとに5%で味方全体回復
      var hits = (u.counters && u.counters.hitsTaken) || 0;
      var gained = hits - em.lastHits;
      em.lastHits = hits;
      if (gained > 0) {
        var amount = u.hpMax * HEAL_PCT / 100;
        for (var i = 0; i < gained; i++) {
          em.seed = (Math.imul(em.seed, 1664525) + 1013904223) >>> 0;
          if (em.seed / 4294967296 >= PROC_CHANCE) continue;
          var allies = E.alive(E.team(u));
          for (var k = 0; k < allies.length; k++) E.heal(allies[k], amount, frame);
          E.event({ frame: frame, kind: 'emma-proc', side: u.side, unit: u.name });
        }
      }

      // HP90%以上の間だけ「受けるHP回復量13.33%▲」
      if (u.hpMax > 0 && (u.hp / u.hpMax) * 100 >= HP_THRESHOLD) {
        var team = E.alive(E.team(u));
        for (var m = 0; m < team.length; m++) {
          E.buff(team[m], 'emma-high-hp', 'recoveryTakenPct', RECOVERY_TAKEN, 'up',
                 frame + 2, { label: 'HP90%以上' });
        }
      }
    },

    onShot: function (u, E, frame, shot) {},

    onBurst: function (u, E, frame) {}
  };
})();
