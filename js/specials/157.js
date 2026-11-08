/* ネロ (157 / org 38)
 *
 * パーサで表現できていない部分だけを実装する。
 *
 * 状態:
 *   ネコの恩返し（最大5スタック）… 回復効果が適用されるたびに1スタック。
 *   大きくて乱暴なネコ … ネコの恩返しがフルスタックの状態でバースト。
 *
 * 実装:
 *   1. スキル1「回復効果が適用されると対象に・受けるダメージ14.14%▼：5秒間維持」
 *      「回復効果が適用されると自分に・ネコの恩返し：受けるダメージ8.43%▼：5スタック：5秒間維持」
 *      … HPが増えた味方を回復とみなして配る（engine に回復イベントが無いため）。
 *   2. スキル2「撃たれた時、30%の確率で対象に・受けるダメージ8.26%▲：5秒間維持」
 *      … パーサは hitTaken トリガで持っているが engine は
 *      runTriggered('hitTaken') を呼ばないので、被弾を自分で検出して配る。
 *   3. スキル2「自分が大きくて乱暴なネコ状態なら、撃たれた時、30%の確率で
 *      対象に・最終攻撃力の158.05%のダメージ」
 *      … 自分がダメージを受けたフレームに、最後に殴ってきた相手へ反撃する。
 *      30% は決定的に10回中3回で近似する（engine の rng は API に出ていない）。
 *   4. バーストの「フルスタック状態なら大きくて乱暴なネコ」ゲート。
 */
(function () {
  'use strict';

  var NEKO_STACKS = 5;       /* 原文: 5スタック */
  var NEKO_PCT = 8.43;       /* 原文: 受けるダメージ8.43%▼ */
  var HEAL_TAKEN_PCT = 14.14;/* 原文: 受けるダメージ14.14%▼ */
  var HIT_TAKEN_PCT = 8.26;  /* 原文: 撃たれた時、受けるダメージ8.26%▲ */
  var STACK_SEC = 5;         /* 原文: 5秒間維持 */
  var BIG_CAT_SEC = 15;      /* バースト: 15秒間維持 */
  var COUNTER_PCT = 158.05;  /* 原文: 最終攻撃力の158.05% */

  function liveStacks(u, frame) {
    var n = 0;
    for (var i = 0; i < NEKO_STACKS; i++) {
      if (u._neroStackUntil[i] >= frame) n += 1;
    }
    return n;
  }

  function addNekoStack(u, E, frame) {
    var slot = 0;
    for (var i = 1; i < NEKO_STACKS; i++) {
      if (u._neroStackUntil[i] < u._neroStackUntil[slot]) slot = i;
    }
    var until = frame + STACK_SEC * E.FPS;
    u._neroStackUntil[slot] = until;
    E.buff(u, 'nero-neko-' + slot, 'takenDmgPct', NEKO_PCT, 'down', until, {});
  }

  (window.SPECIALS = window.SPECIALS || {})[157] = {
    init: function (u, E) {
      u._neroStackUntil = [];
      for (var i = 0; i < NEKO_STACKS; i++) u._neroStackUntil.push(0);
      u._neroPrevHp = {};
      u._neroPrevShield = {};
      u._neroBigUntil = -1;
      u._neroHitCount = 0;
      var team = E.team(u);
      for (var k = 0; k < team.length; k++) {
        u._neroPrevHp[team[k].pos] = team[k].hp;
        u._neroPrevShield[team[k].pos] = team[k].shield || 0;
      }
    },

    tick: function (u, E, frame) {
      var team = E.team(u);
      for (var i = 0; i < team.length; i++) {
        var m = team[i];
        var prev = u._neroPrevHp[m.pos];
        var prevSh = u._neroPrevShield[m.pos];

        if (m.alive && prev != null) {
          /* 回復検出（HPが増えた） */
          if (m.hp > prev) {
            E.buff(m, 'nero-heal-taken', 'takenDmgPct', HEAL_TAKEN_PCT, 'down',
              frame + STACK_SEC * E.FPS, {});
            addNekoStack(u, E, frame);
          }
          /* 被弾検出（HPまたはバリアが減った） */
          if (m === u && (u.hp < prev || (u.shield || 0) < (prevSh || 0))) {
            u._neroHitCount += 1;
            var src = u.lastHitBy;
            var roll = u._neroHitCount % 10 < 3;   /* 30% = 10回中3回 */
            if (src && src.alive && src !== u) {
              if (roll) {
                E.buff(src, 'nero-hit-debuff', 'takenDmgPct', HIT_TAKEN_PCT, 'up',
                  frame + STACK_SEC * E.FPS, {});
              }
              if (frame <= u._neroBigUntil && roll) {
                E.damage(u, src, frame, { multiplierPct: COUNTER_PCT });
              }
            }
          }
        }
        u._neroPrevHp[m.pos] = m.hp;
        u._neroPrevShield[m.pos] = m.shield || 0;
      }
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) {
      if (liveStacks(u, frame) >= NEKO_STACKS) {
        u._neroBigUntil = frame + BIG_CAT_SEC * E.FPS;
      }
    }
  };
})();
