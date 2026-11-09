/* ナガ (id 68 / org 58)
 *
 * パーサが表現できていない部分だけを実装する。
 *  - スキル1「通常攻撃で12回攻撃した時、味方全体に 遮蔽物HP回復14.57%▲」
 *  - バースト「自分がバリア適用状態なら、追加で味方全体に
 *    スキル発動者基準で攻撃力31.02%▲：10秒間維持」の条件判定
 *    （パーサは条件を無視して常に全味方へ入れてしまうため、バリアが無ければ外す）
 *
 * 貫通特化（バースト）はエンジンに遮蔽物を貫通させる概念が無いため実装しない。
 * 「バリア適用時、味方全体にコアダメージ85.17%▲」はコアの概念が無いため実装しない。
 */
(function () {
  function removePrefix(unit, prefix) {
    if (!unit || !unit.buffs) return;
    for (var i = unit.buffs.length - 1; i >= 0; i--) {
      if (String(unit.buffs[i].key).indexOf(prefix) === 0) unit.buffs.splice(i, 1);
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[68] = {
  /* 遮蔽物の回復はここで実装している */
  suppress: { skill1: [0] },
    init: function (u, E) {
      u.naga = { shots: 0, pendingBurstCheck: false, checkFrame: -1 };
    },

    tick: function (u, E, frame) {
      var st = u.naga;
      if (!st) return;
      if (st.pendingBurstCheck && frame >= st.checkFrame) {
        st.pendingBurstCheck = false;
        // 自分がバリア適用状態でなければ、追加の攻撃力31.02%を外す
        if (!u.shield || u.shield <= 0) {
          var team = E.team(u);
          for (var i = 0; i < team.length; i++) {
            removePrefix(team[i], u.side + u.pos + ':burst:2:');
          }
        }
      }
    },

    onShot: function (u, E, frame, shot) {
      var st = u.naga;
      if (!st) return;
      st.shots += 1;
      // 通常攻撃で12回攻撃した時、味方全体に 遮蔽物HP回復14.57%▲
      if (st.shots >= 12) {
        st.shots = 0;
        var team = E.team(u);
        for (var i = 0; i < team.length; i++) {
          var a = team[i];
          if (!a.alive) continue;
          var max = a.coverMax || 0;
          if (max <= 0) continue;
          a.coverHp = Math.min(max, (a.coverHp || 0) + max * 0.1457);
        }
      }
    },

    onBurst: function (u, E, frame) {
      if (!u.naga) return;
      u.naga.pendingBurstCheck = true;
      u.naga.checkFrame = frame;
    }
  };
})();
