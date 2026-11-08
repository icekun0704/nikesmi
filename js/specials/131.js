/* ギロチン：ウィンタースレイヤー (id 131 / org 141)
 *
 * パーサが表現できていない部分だけを実装する。
 *  - 通常攻撃6ヒットごとの「経験値」→ 10スタックごとの勇者レベルアップ（最大11）
 *  - レベルアップ時の自分回復 2.44% と、水冷コードの味方全体への
 *    有利コード与ダメ 1.16%×レベル / 攻撃力 0.91%×レベル（スキル発動者基準）
 *  - 勇者レベル2以上のときの自分の有利コード与ダメ 7.46%
 *  - バーストの「最終攻撃力の20.87%×勇者レベル数」持続ダメージ（1秒間隔・10秒）
 *
 * パーサ側が既に動かしているもの（経験値の攻撃力バフ、バーストの味方バフ）は
 * ここでは触らない。弾丸チャージはエンジンに概念が無いので実装しない。
 */
(function () {
  function pick(u, E, frame) {
    var es = E.alive(E.enemies(u));
    if (!es.length) return null;
    var taunt = es.filter(function (x) { return x.tauntUntil >= frame; });
    if (taunt.length) {
      taunt.sort(function (a, b) { return a.pos - b.pos; });
      return taunt[0];
    }
    var right = u.weapon === 'SR';
    es.sort(function (a, b) { return right ? b.pos - a.pos : a.pos - b.pos; });
    return es[0];
  }

  function grantLevel(u, E, frame, lv) {
    // 勇者レベルアップ効果：スキル発動者の最終最大HPに比例して2.44%回復
    E.heal(u, u.hpMax * 0.0244, frame);

    // 勇者レベルアップ時、水冷コードの味方全体に
    // ・有利コードの攻撃ダメージ1.16%×勇者レベル数分▲：持続
    // ・スキル発動者基準で攻撃力0.91%×勇者レベル数分▲：持続
    var team = E.team(u);
    for (var i = 0; i < team.length; i++) {
      var a = team[i];
      if (!a.alive || a.element !== '水冷') continue;
      E.buff(a, 'gw-elem-' + lv + '-' + a.pos, 'elementDmgPct', 1.16 * lv, 'up', Infinity);
      E.buff(a, 'gw-atk-' + lv + '-' + a.pos, 'atkFlat',
        E.atkEff(u) * 0.0091 * lv, 'up', Infinity);
    }

    // 自分の勇者レベルが2以上の時のみ自分に 有利コードの攻撃ダメージ7.46%▲
    if (lv >= 2 && !u.gwState.lv2) {
      u.gwState.lv2 = true;
      E.buff(u, 'gw-lv2', 'elementDmgPct', 7.46, 'up', Infinity);
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[131] = {
    init: function (u, E) {
      u.gwState = { exp: 0, rem: 0, lv: 1, lv2: false, dots: [] };
    },

    tick: function (u, E, frame) {
      var st = u.gwState;
      if (!st) return;
      for (var i = st.dots.length - 1; i >= 0; i--) {
        var d = st.dots[i];
        if (frame > d.until) { st.dots.splice(i, 1); continue; }
        if (frame < d.next) continue;
        if (d.target && d.target.alive) {
          E.damage(u, d.target, frame, { multiplierPct: d.mult, isSustained: true });
        }
        d.next += 60;
      }
    },

    onShot: function (u, E, frame, shot) {
      var st = u.gwState;
      if (!st || !shot) return;
      st.rem += (shot.hits || 0);
      // 通常攻撃が6回命中した時、経験値1スタック（最大100スタック）
      while (st.rem >= 6 && st.exp < 100) {
        st.rem -= 6;
        st.exp += 1;
      }
      // 経験値10スタックごとに勇者レベルアップ（開始レベル1・最大11）
      var lv = Math.min(11, 1 + Math.floor(st.exp / 10));
      while (st.lv < lv) {
        st.lv += 1;
        grantLevel(u, E, frame, st.lv);
      }
    },

    onBurst: function (u, E, frame) {
      var st = u.gwState;
      if (!st) return;
      var es = E.alive(E.enemies(u));
      if (!es.length) return;
      // 最終最大HPが最も高い敵1機
      es.sort(function (a, b) { return b.hpMax - a.hpMax; });
      st.dots.push({
        target: es[0],
        mult: 20.87 * st.lv,        // 最終攻撃力の20.87%×勇者レベル数
        next: frame + 60,           // 1秒間隔
        until: frame + 600          // 10秒間維持
      });
    }
  };
})();
