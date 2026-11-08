/* ルージュ (89 / org 132)
 *
 * パーサで表現できていない部分だけを実装する。
 *
 * 状態: ソードコイン / シールドコイン / ダブルソードコイン。
 *   ソードコイン … 戦闘開始時に後列（P3〜P5 = pos 2〜4）に居ると成立。
 *   シールドコイン … ソードコイン状態でフルチャージ30回。
 *   ダブルソードコイン … シールドコイン状態でバースト5回。
 *   ※ パーサは各バフを条件抜きで配ってしまうため、このファイルでは
 *     「状態の管理」と「engine が counter を回していない fullCharge 系」だけを行う。
 *
 * 実装:
 *   - スキル1「フルチャージで8回攻撃した時、味方全体に
 *     最大HP5%▲（発動者基準・5秒）／バーストCT7秒▼」
 *     （engine は runCounterSkills('fullCharge') を呼ばないので未発火だった）
 *   - スキル2「フルチャージで30回攻撃した時、ソードコイン状態なら
 *     自分と両隣に・受けるダメージ15.2%▼：持続」
 *   - スキル2「バースト5回使用時、シールドコイン状態なら味方全体に
 *     最大HP15.08%▲（発動者基準・持続）」
 *   - バーストの状態分岐（ソード/シールド/ダブルソード）の最大HPバフ
 *
 * 未実装（理由）:
 *   - 各状態の付与そのもの（パーサが条件を見ずに配っているため、
 *     ここで配ると二重計上になる）。
 */
(function () {
  'use strict';

  function neighbors(team, u) {
    var out = [u];
    for (var i = 0; i < team.length; i++) {
      var m = team[i];
      if (m !== u && m.alive && Math.abs(m.pos - u.pos) === 1) out.push(m);
    }
    return out;
  }

  function hitters(u, E) {
    return E.alive(E.team(u));
  }

  (window.SPECIALS = window.SPECIALS || {})[89] = {
    init: function (u, E) {
      u._rougeFC8 = 0;
      u._rougeFC30 = 0;
      u._rougeBursts = 0;
      /* 戦闘開始時に後列（pos 2〜4）ならソードコイン */
      u._rougeSword = u.pos >= 2;
      u._rougeShield = false;
      u._rougeDouble = false;
      u._rougeDoubleGiven = false;
    },

    tick: function (u, E, frame) {
      var fc = u.counters ? u.counters.fullCharge : 0;
      var team = E.team(u);
      var i, m;

      /* フルチャージ8回ごと */
      while (fc - u._rougeFC8 >= 8) {
        u._rougeFC8 += 8;
        var all = hitters(u, E);
        for (i = 0; i < all.length; i++) {
          m = all[i];
          E.buff(m, 'rouge-hp-all', 'hpFlat', u.hpMaxBase * 0.05, 'up', frame + 5 * E.FPS, {});
          m.burstReadyAt = Math.max(0, (m.burstReadyAt || 0) - 7 * E.FPS);
        }
      }

      /* フルチャージ30回ごと（ソードコイン状態のみ） */
      while (fc - u._rougeFC30 >= 30) {
        u._rougeFC30 += 30;
        if (u._rougeSword) {
          var near = neighbors(team, u);
          for (i = 0; i < near.length; i++) {
            E.buff(near[i], 'rouge-shieldcoin', 'takenDmgPct', 15.2, 'down', Infinity, {});
          }
          u._rougeShield = true;
        }
      }
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) {
      u._rougeBursts += 1;
      var team = E.alive(E.team(u));
      var i;

      /* 5回目のバーストでダブルソードコイン（1回だけ） */
      if (u._rougeBursts >= 5 && u._rougeShield && !u._rougeDoubleGiven) {
        u._rougeDoubleGiven = true;
        u._rougeDouble = true;
        for (i = 0; i < team.length; i++) {
          E.buff(team[i], 'rouge-double-coin', 'hpFlat', u.hpMaxBase * 0.1508, 'up', Infinity, {});
        }
      }

      /* バースト時の状態別・最大HPバフ（10秒） */
      if (u._rougeSword) {
        for (i = 0; i < team.length; i++) {
          E.buff(team[i], 'rouge-burst-sword', 'hpFlat', u.hpMaxBase * 0.1015, 'up', frame + 10 * E.FPS, {});
        }
      }
      if (u._rougeShield) {
        for (i = 0; i < team.length; i++) {
          E.buff(team[i], 'rouge-burst-shield', 'hpFlat', u.hpMaxBase * 0.2010, 'up', frame + 10 * E.FPS, {});
        }
      }
      if (u._rougeDouble) {
        for (i = 0; i < team.length; i++) {
          E.buff(team[i], 'rouge-burst-double', 'hpFlat', u.hpMaxBase * 0.3002, 'up', frame + 10 * E.FPS, {});
        }
      }
    }
  };
})();
