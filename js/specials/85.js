/* ファントム (id 85 / org 133)
 *
 * 予告状と怪盗の短剣。
 *
 *  通常攻撃が命中した時、対象が予告状状態でなければ
 *    ・対象に 予告状（防御力32.19%▼）：5秒
 *    ・自分に 怪盗の短剣（命中率25.75%▲）：3スタック：5秒
 *  通常攻撃が命中した時、対象が予告状状態なら
 *    ・自分に 攻撃ダメージ75.17%▲：1発
 *  怪盗の短剣が3スタック（フル）になったら、スタックを解除して
 *    ・予告状状態の対象に 最終攻撃力の84.33% の追加ダメージ
 *    ・敵全体に 最終攻撃力の250% の分配ダメージ
 *
 * 命中率はアリーナでは効かないが、スタックの進行に必要なので数だけ数える。
 */
(function () {
  var MARK = 'fantome-mark:';
  (window.SPECIALS = window.SPECIALS || {})[85] = {
    init: function (u, E) { u.fantome = { stacks: 0, marked: [] }; },

    onShot: function (u, E, frame) {
      var st = u.fantome;
      var t = u._lastTarget;
      if (!t || !t.alive) return;

      var isMarked = st.marked.indexOf(t) >= 0;

      if (!isMarked) {
        st.marked.push(t);
        E.buff(t, MARK + u.pos + ':' + t.pos, 'defPct', 32.19, 'down', frame + 5 * E.FPS);
        st.stacks = Math.min(3, st.stacks + 1);
        E.buff(u, 'fantome-knife', 'hitRate', 25.75, 'up', frame + 5 * E.FPS);
        // 予告状は5秒で切れるので、切れたら解除扱いにする
        setTimeoutMark(st, t, frame + 5 * E.FPS);
      } else {
        E.buff(u, 'fantome-dmg', 'atkDmgPct', 75.17, 'up', frame + 1);
        st.stacks = Math.min(3, st.stacks + 1);
      }

      if (st.stacks >= 3) {
        st.stacks = 0;
        // フルスタック解除：予告状の対象に追加ダメージ、敵全体に分配ダメージ
        var markedAlive = st.marked.filter(function (x) { return x.alive; });
        if (markedAlive.length) {
          E.damage(u, markedAlive[0], frame, { multiplierPct: 84.33 });
        }
        var es = E.alive(E.enemies(u));
        for (var i = 0; i < es.length; i++) {
          E.damage(u, es[i], frame, { multiplierPct: 250, isDistributed: true });
        }
        E.buff(u, 'fantome-dist', 'distributedDmgPct', 12.86, 'up', frame + 10 * E.FPS);
      }
    },

    tick: function (u, E, frame) {
      var st = u.fantome;
      if (!st.expiries) return;
      for (var i = st.expiries.length - 1; i >= 0; i--) {
        if (frame >= st.expiries[i].until) {
          var idx = st.marked.indexOf(st.expiries[i].target);
          if (idx >= 0) st.marked.splice(idx, 1);
          st.expiries.splice(i, 1);
        }
      }
    }
  };

  function setTimeoutMark(st, target, until) {
    st.expiries = st.expiries || [];
    st.expiries.push({ target: target, until: until });
  }
})();
