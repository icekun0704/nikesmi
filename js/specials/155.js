/* ミサト (id 155 / org 131, SMG, B1, 鉄甲, 支援型)
 *
 * パーサで表現できていない部分:
 *   - burst「スキル発動者の最終最大HPの5.06%持続回復：1秒間隔：5秒間維持」。
 *     パーサは heal 5.06 を1回だけ適用している（持続回復の概念が無い）。
 *     ここでは本来の 1秒間隔・5秒間（5回）の回復として実装する。
 *     二重計上を避けるため、このユニットの burst ブロックの効果は init で空にする。
 *
 *   - skill2 の状態条件。
 *     「自分が射撃マニュアル状態の時に限り、味方全体に バリアに与えるダメージ150%▲」
 *     「自分が射撃マニュアルのフルスタック状態の時のみ、自分に 与えるHP回復量30.05%▲」
 *     パーサは trigger=unknown で未発動。射撃マニュアルのスタックは
 *     skill1 が 60回攻撃ごとに付与する（最大3）ので、そのスタック数を読んで
 *     条件が満たされている間だけバフを維持する。
 *
 *   - skill1（60回 / 120回攻撃）はパーサが counter で正しく動かしているので触らない。
 *
 * 実装していないもの:
 *   - 「バリアに与えるダメージ」は engine にバリア（敵のバリア）の概念が無いため
 *     ステータスとして積むだけ。与えるHP回復量も engine の heal は
 *     受け手の recoveryTakenPct しか見ないため、数値としての効果は無い。
 */
(function () {
  'use strict';

  var HOHEAL_PCT = 5.06;   /* 原文: 最終最大HPの5.06% */
  var INTERVAL = 60;       /* 原文: 1秒間隔 */
  var TICKS = 5;           /* 原文: 5秒間維持 */
  var MANUAL_STACKS = 3;   /* 原文: 射撃マニュアル 3スタック */
  var BARRIER_DMG_PCT = 150;
  var HEAL_GIVEN_PCT = 30.05;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  /* skill1 が付ける「射撃マニュアル」の現在スタック数。 */
  function manualStacks(u) {
    var n = 0;
    for (var i = 0; i < u.buffs.length; i++) {
      var b = u.buffs[i];
      if (b.key && b.key.indexOf(':skill1:0:stat:hitRate') >= 0) {
        if (b.until >= u.now) n = Math.max(n, b.stacks || 1);
      }
    }
    return n;
  }

  (window.SPECIALS = window.SPECIALS || {})[155] = {
    init: function (u, E) {
      /* このユニット専用にスキル定義を複製し、burst の heal を消す
       * （持続回復として自分で撃ち直すため）。 */
      var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
      if (src) {
        u.skills = JSON.parse(JSON.stringify(src));
        for (var s = 0; s < u.skillState.length; s++) {
          var st = u.skillState[s];
          var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
          if (!arr) continue;
          for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
        }
        if (u.skills.burst && u.skills.burst.blocks[0]) {
          u.skills.burst.blocks[0].effects = [];
        }
      }
      u.misato = { healNext: -1, healLast: -1 };
    },

    tick: function (u, E, frame) {
      var m = u.misato;
      if (!m) return;

      /* burst の持続回復（1秒間隔・5回） */
      if (m.healNext >= 0 && frame >= m.healNext && frame <= m.healLast) {
        var amount = u.hpMax * (HOHEAL_PCT * scaleOf(u, 'burst')) / 100;
        var team = E.alive(E.team(u));
        for (var i = 0; i < team.length; i++) E.heal(team[i], amount, frame);
        m.healNext += INTERVAL;
        if (m.healNext > m.healLast) m.healNext = -1;
      }

      /* skill2: 射撃マニュアル状態の間だけ味方全体にバリアダメージ+150% */
      var stacks = manualStacks(u);
      var until = frame + 2;
      var allies = E.alive(E.team(u));
      if (stacks > 0) {
        for (var a = 0; a < allies.length; a++) {
          E.buff(allies[a], 'misato-barrier', 'barrierDmgPct', BARRIER_DMG_PCT, 'up', until, {});
        }
      }
      /* skill2: 射撃マニュアルのフルスタック時のみ、自分に与えるHP回復量+30.05% */
      if (stacks >= MANUAL_STACKS) {
        E.buff(u, 'misato-heal-given', 'recoveryGivenPct', HEAL_GIVEN_PCT, 'up', until, {});
      }
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) {
      var m = u.misato;
      if (!m) return;
      m.healNext = frame;
      m.healLast = frame + (TICKS - 1) * INTERVAL;
    }
  };
})();
