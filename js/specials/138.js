/* シン (id 138 / org 55, AR / B2 / 防御型 / 電撃) — 宝物なし
 *
 * パーサが既に動かしているもの（ここでは触らない）:
 *   - burst 攻撃範囲内の敵へ 176.32%
 *   - skill1 最後の弾丸時の ヘイト：敵全体を挑発：5秒
 *   - skill2 フルバースト終了時の バーストゲージチャージ16.17%▲：5秒
 *
 * パーサで表現できていない部分:
 *   - skill1「最後の弾丸で攻撃した時、自分に
 *     最大HPが最も高い味方1機の最大HPのコピー15.03%：5秒間維持」
 *     （op:unparsed のため発動しない。最大HPのコピー＝対象の最大HPの
 *       15.03%を自分の最大HPに加える効果なので hpFlat で付与する）
 *   - skill2「バーストスキルを使用した時、自分に使用回数別の効果」
 *     1回目：攻撃ダメージの15.3%回復：5秒
 *     2回目：受けるHP回復量51%▲：5秒
 *     3回目：防御力43.2%▲：5秒
 *     パーサは3つを毎回すべて発動させ、しかも lifesteal は期限なしで残るため、
 *     このブロックを空にして使用回数で1つだけ選ぶ。
 *   - バースト「ニケを除いた敵が4機以上なら、全ての敵に
 *     受けるダメージ12.23%▲：5秒間維持」
 *     アリーナの敵は全員ニケなので「ニケを除いた敵」は常に0機。
 *     パーサは条件を落として毎回付与しているため、この効果は外す。
 *
 * 実装していないもの: なし
 */
(function () {
  'use strict';

  var FPS = 60;
  var HP_COPY_PCT = 15.03;   /* 原文: 最大HPのコピー15.03% */
  var HP_COPY_SEC = 5;       /* 原文: 5秒間維持 */
  var LIFESTEAL_PCT = 15.3;  /* 原文: 攻撃ダメージの15.3%回復 */
  var RECOVERY_UP = 51;      /* 原文: 受けるHP回復量51%▲ */
  var DEF_UP = 43.2;         /* 原文: 防御力43.2%▲ */
  var USE_SEC = 5;           /* 原文: 5秒間維持 */

  function copySkills(u) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (!src) return null;
    u.skills = JSON.parse(JSON.stringify(src));
    for (var s = 0; s < u.skillState.length; s++) {
      var st = u.skillState[s];
      var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
      if (!arr) continue;
      for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
    }
    return u.skills;
  }

  function highestMaxHpAlly(u, E) {
    var list = E.alive(E.team(u));
    var best = null;
    for (var i = 0; i < list.length; i++) {
      if (!best || list[i].hpMax > best.hpMax) best = list[i];
    }
    return best;
  }

  (window.SPECIALS = window.SPECIALS || {})[138] = {
    init: function (u, E) {
      u.shin = { stealPrev: 0, stealUntil: -1 };

      var sk = copySkills(u);
      if (sk && sk.skill2) {
        /* 使用回数別の効果は自前で撃つ */
        for (var i = 0; i < sk.skill2.blocks.length; i++) {
          var t = sk.skill2.blocks[i].trigger || {};
          if (t.kind === 'burst') sk.skill2.blocks[i].effects = [];
        }
      }
      if (sk && sk.burst) {
        /* 「ニケを除いた敵が4機以上」はアリーナでは成立しない */
        for (var j = 0; j < sk.burst.blocks.length; j++) {
          var b = sk.burst.blocks[j];
          if ((b.trigger || {}).kind !== 'burst') continue;
          for (var e = b.effects.length - 1; e >= 0; e--) {
            if (b.effects[e].op === 'stat' && b.effects[e].stat === 'takenDmgPct') {
              b.effects.splice(e, 1);
            }
          }
        }
      }
    },

    tick: function (u, E, frame) {
      var s = u.shin;
      if (!s) return;
      /* バースト1回目の lifesteal は engine に期限の概念が無いので自前で戻す */
      if (s.stealUntil >= 0 && frame > s.stealUntil) {
        u.lifestealPct = s.stealPrev;
        s.stealUntil = -1;
      }
    },

    onShot: function (u, E, frame, shot) {
      /* 最後の弾丸で攻撃した時（= engine の lastBullet と同じ条件） */
      if (!shot || !shot.reloaded) return;
      var ally = highestMaxHpAlly(u, E);
      if (!ally) return;
      E.buff(u, 'shin-hp-copy', 'hpFlat', ally.hpMax * HP_COPY_PCT / 100,
        'up', frame + HP_COPY_SEC * FPS, {});
    },

    onBurst: function (u, E, frame) {
      var s = u.shin;
      if (!s) return;
      var n = u.bursts;    /* fireBurst が onBurst の前に +1 している */
      var until = frame + USE_SEC * FPS;
      if (n <= 1) {
        /* 1回目：攻撃ダメージの15.3%回復：5秒 */
        if (s.stealUntil < 0) s.stealPrev = u.lifestealPct || 0;
        u.lifestealPct = Math.max(u.lifestealPct || 0, LIFESTEAL_PCT);
        s.stealUntil = until;
      } else if (n === 2) {
        /* 2回目：受けるHP回復量51%▲：5秒 */
        E.buff(u, 'shin-use2', 'recoveryTakenPct', RECOVERY_UP, 'up', until, {});
      } else {
        /* 3回目：防御力43.2%▲：5秒 */
        E.buff(u, 'shin-use3', 'defPct', DEF_UP, 'up', until, {});
      }
      E.event({ frame: frame, kind: 'shin-burst-use', side: u.side, unit: u.name, use: n });
    }
  };
})();
