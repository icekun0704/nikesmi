/* マナ (id 53 / org 143)
 *
 * パーサが表現できていない部分だけを実装する。
 *  - マターガンマ（攻撃力58.08%▲）／マターシグマ（バーストゲージ70.4%▲）の
 *    状態を持ち、解除条件で実際にバフを外す
 *  - 味方が戦闘不能になった時、マターガンマ状態なら
 *    自分を除く戦闘不能の最終攻撃力が最も高い味方1機をHP96%で復活
 *  - フルバーストタイム発動時、マターシグマ状態を解除
 *
 * 「基本チャージ時間が一番長い味方1機にチャージ時間0.18秒▼」は、エンジンが
 * 単位ごとの動的チャージ時間を持たないため実装できない。
 * スキル1の10回攻撃回復はパーサが動かしているので触らない。
 */
(function () {
  function removePrefix(unit, prefix) {
    if (!unit || !unit.buffs) return;
    for (var i = unit.buffs.length - 1; i >= 0; i--) {
      if (String(unit.buffs[i].key).indexOf(prefix) === 0) unit.buffs.splice(i, 1);
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[53] = {
    init: function (u, E) {
      var team = E.team(u), alive = [];
      for (var i = 0; i < team.length; i++) alive.push(team[i].alive);
      u.mana = {
        gamma: true,     // 戦闘開始時にマターガンマ
        sigma: true,     // 戦闘開始時にマターシグマ
        alive: alive,
        lastBurstFrame: -1,
        fbFrame: -1,
        fbApplied: false
      };
    },

    tick: function (u, E, frame) {
      var st = u.mana;
      if (!st) return;
      var team = E.team(u), i;

      // 味方が戦闘不能になった時
      for (i = 0; i < team.length; i++) {
        var was = st.alive[i];
        st.alive[i] = team[i].alive;
        if (!was || team[i].alive) continue;

        // 味方が戦闘不能時、自分に マターガンマ解除
        removePrefix(u, u.side + u.pos + ':skill1:0:');

        if (!st.gamma) continue;
        st.gamma = false;

        // 自分を除く戦闘不能状態の最終攻撃力が最も高い味方1機に HP96%で復活
        var dead = team.filter(function (x) { return !x.alive && x !== u; });
        if (dead.length) {
          dead.sort(function (a, b) { return E.atkEff(b) - E.atkEff(a); });
          var r = dead[0];
          r.alive = true;
          r.hp = Math.round(r.hpMax * 0.96);
          r.deathFrame = -1;
        }
      }

      // フルバーストタイムが発動した時、自分がマターシグマ状態なら解除
      var lb = team.lastBurst;
      if (lb && lb.frame !== st.lastBurstFrame) {
        st.lastBurstFrame = lb.frame;
        if (lb.stage === 'B3') {
          st.fbFrame = lb.frame;
          st.fbApplied = false;
          if (st.sigma) {
            // マターシグマ状態なので攻撃ダメージ21.12%▲／攻撃力63.36%▲は有効。
            // 解除してバーストゲージ70.4%▲を外す。
            st.sigma = false;
            removePrefix(u, u.side + u.pos + ':skill2:0:');
          } else {
            // マターシグマ状態でないので、パーサが入れたFB時のバフを外す
            removePrefix(u, u.side + u.pos + ':skill2:1:');
          }
        }
      }

      // フルバーストタイムが終了した時、直前に自分がバーストスキルを
      // 使用していればマターシグマを再付与（パーサが常時入れるので条件で外す）
      if (st.fbFrame >= 0 && !st.fbApplied && frame >= st.fbFrame + 10 * E.FPS) {
        st.fbApplied = true;
        var usedBurst = lb && lb.stage === 'B3' && lb.unit === u;
        if (usedBurst) {
          st.sigma = true;
        } else {
          removePrefix(u, u.side + u.pos + ':skill2:3:');
        }
      }
    }
  };
})();
