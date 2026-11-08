/* バイパー（宝物）(id 18 / org 44*, SG, B2, 火力型, 水冷)
 *
 * 原文の状態機械:
 *   skill1
 *     ターゲットが出現している場合、味方全体に
 *       攻撃力25.98%▲：10秒間維持／命中率11.13%▲：10秒間維持
 *     愛嬌状態の時に限り攻撃した時、自分に
 *       持続ダメージ4.4%▲：10スタック：10秒間維持
 *       命中率1.84%▲：10スタック：10秒間維持
 *   skill2
 *     自分に 命中率21.96%▲：持続                          ← パーサ済み（engine未使用）
 *     フルバーストタイムが発動した時、自分に
 *       愛嬌：単一攻撃対象から除外。攻撃を受けると解除。：10秒間→持続（宝物）
 *       無敵：1秒間維持                                    ← パーサ済み
 *     バーストスキルを使用した時、味方全体に バースト再突入2段階
 *   burst
 *     指定した敵対象1機に 最終攻撃力の1029.6%のダメージ      ← パーサ済み
 *     対象がターゲットなら、同じ敵に
 *       防御力19.83%▼：10秒間維持
 *       最終攻撃力の105.3%の持続ダメージ：1秒間隔：10秒間維持
 *
 * パーサの扱い:
 *   - skill1 の2ブロックは trigger:unknown、skill2 の愛嬌・再突入は未解釈。
 *   - burst の「持続ダメージ」はパーサが1回ぶんだけ即時ダメージにしている。
 *     b1 の効果を止めて、同じ敵に防御力▼と10秒間の持続ダメージを撃ち直す。
 *
 * 実装しないもの:
 *   - 愛嬌の「単一攻撃対象から除外」：engine の敵AIのターゲット選択を
 *     書き換える口が無い。状態の付与・解除だけを実装する。
 *   - バースト再突入2段階：engine のバーストチェーンに再突入の概念が無い。
 *   - 命中率（hitRate）は engine のダメージ計算で使われない。
 */
(function () {
  'use strict';

  var FPS = 60;

  var TARGET_ATK_PCT = 25.98;    /* 攻撃力25.98%▲：10秒 */
  var TARGET_HIT_PCT = 11.13;    /* 命中率11.13%▲：10秒 */
  var TARGET_SEC = 10;
  var AIL_SUS_PCT = 4.4;         /* 持続ダメージ4.4%▲：10スタック：10秒 */
  var AIL_HIT_PCT = 1.84;        /* 命中率1.84%▲：10スタック：10秒 */
  var AIL_SEC = 10;
  var AIL_MAX = 10;
  var DEF_DOWN_PCT = 19.83;      /* 防御力19.83%▼：10秒 */
  var DOT_PCT = 105.3;           /* 最終攻撃力の105.3%の持続ダメージ */
  var DOT_TICKS = 10;            /* 1秒間隔：10秒間維持 */
  var DOT_INTERVAL = 60;

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  function cloneSkills(u) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (!src || !u.skillState) return;
    u.skills = JSON.parse(JSON.stringify(src));
    for (var s = 0; s < u.skillState.length; s++) {
      var st = u.skillState[s];
      var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
      if (!arr) continue;
      for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
    }
    /* burst の2番目のブロックは「同じ敵に」撃ち直す */
    if (u.skills.burst && u.skills.burst.blocks[1]) {
      u.skills.burst.blocks[1].effects = [];
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[18] = {
    init: function (u, E) {
      cloneSkills(u);
      u.viperT = {
        ail: false,
        ailUntil: Infinity,        /* 宝物：持続 */
        lastBurstFrame: -1,
        lastHitsTaken: u.counters ? u.counters.hitsTaken : 0,
        lastDamageTaken: u.damageTaken || 0,
        dot: null
      };
    },

    tick: function (u, E, frame) {
      var s = u.viperT;
      if (!s) return;

      /* ターゲットが出現している場合：味方全体に攻撃力／命中率（10秒） */
      var enemies = E.alive(E.enemies(u));
      if (enemies.length) {
        var mates = E.alive(E.team(u));
        var until = frame + TARGET_SEC * FPS;
        for (var i = 0; i < mates.length; i++) {
          E.buff(mates[i], 'viperT-target-atk:' + u.pos, 'atkPct',
            TARGET_ATK_PCT * scaleOf(u, 'skill1'), 'up', until, {});
          E.buff(mates[i], 'viperT-target-hit:' + u.pos, 'hitRate',
            TARGET_HIT_PCT * scaleOf(u, 'skill1'), 'up', until, {});
        }
      }

      /* フルバーストタイム発動時：愛嬌（宝物は持続） */
      var lb = E.team(u).lastBurst;
      if (lb && lb.frame !== s.lastBurstFrame) {
        s.lastBurstFrame = lb.frame;
        if (lb.stage === 'B3') {
          s.ail = true;
          s.ailUntil = Infinity;
          E.event({ frame: frame, kind: 'viperT-ail', side: u.side, unit: u.name });
        }
      }

      /* 攻撃を受けると愛嬌解除（通常攻撃の被弾 or 実際にHPを削られた時） */
      if (s.ail) {
        var hits = (u.counters && u.counters.hitsTaken) || 0;
        var taken = u.damageTaken || 0;
        if (hits > s.lastHitsTaken || taken > s.lastDamageTaken ||
            (s.ailUntil !== Infinity && frame > s.ailUntil)) {
          s.ail = false;
          E.event({ frame: frame, kind: 'viperT-ail-end', side: u.side, unit: u.name });
        }
      }
      s.lastHitsTaken = (u.counters && u.counters.hitsTaken) || 0;
      s.lastDamageTaken = u.damageTaken || 0;

      /* burst の持続ダメージ（1秒間隔：10秒） */
      if (s.dot && frame >= s.dot.nextAt && s.dot.left > 0) {
        s.dot.nextAt = frame + DOT_INTERVAL;
        s.dot.left -= 1;
        var t = s.dot.target;
        if (t && t.alive) {
          E.damage(u, t, frame, {
            multiplierPct: DOT_PCT * scaleOf(u, 'burst'),
            isSustained: true
          });
        }
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.viperT;
      if (!s || !s.ail) return;
      /* 愛嬌状態の時に限り攻撃した時：持続ダメージ／命中率を10スタックまで */
      E.buff(u, 'viperT-ail-sus', 'sustainedDmgPct',
        AIL_SUS_PCT * scaleOf(u, 'skill1'), 'up', frame + AIL_SEC * FPS,
        { maxStacks: AIL_MAX });
      E.buff(u, 'viperT-ail-hit', 'hitRate',
        AIL_HIT_PCT * scaleOf(u, 'skill1'), 'up', frame + AIL_SEC * FPS,
        { maxStacks: AIL_MAX });
    },

    onBurst: function (u, E, frame) {
      var s = u.viperT;
      if (!s) return;
      var t = E.pickTarget(u, E.enemies(u), frame);
      if (!t) return;
      var until = frame + 10 * FPS;
      /* 防御力19.83%▼：10秒（同じ敵） */
      E.buff(t, 'viperT-def:' + u.pos, 'defPct',
        DEF_DOWN_PCT * scaleOf(u, 'burst'), 'down', until, {});
      /* 最終攻撃力の105.3%の持続ダメージ：1秒間隔：10秒（初回は1秒後） */
      s.dot = { target: t, left: DOT_TICKS, nextAt: frame + DOT_INTERVAL };
    }
  };
})();
