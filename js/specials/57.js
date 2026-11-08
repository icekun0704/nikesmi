/* ハラン (57 / org 94)
 *
 * パーサで表現できていない部分だけを実装する。
 *
 * 実装:
 *   1. スキル1「攻撃した時、25%の確率で対象に・ウイルス転移：
 *      毎秒最終攻撃力の17.28%持続ダメージ：5秒間維持」
 *      … パーサは op=unparsed で落としているので、5回ぶんの毎秒DoTとして実装。
 *      25% は決定的に「4発に1発」で近似する（engine の rng は API に出ていない）。
 *   2. スキル1「敵が撃破された時、対象がウイルス転移状態なら最も近い敵2機に同じ効果」
 *      … 撃破を tick で監視し、感染していた敵が死んだら近い順に2機へ移す。
 *
 * 未実装（理由）:
 *   - スキル2「貫通特化：1発間維持」… 貫通は Gauge 側が生成時に
 *     char.hasPenetration から決めており、1発だけ切り替える口が無い。
 *   - スキル2「攻撃力3.02%▲：15スタック」はパーサが enemyDeath で処理済み。
 */
(function () {
  'use strict';

  var VIRUS_PCT = 17.28;   /* 原文: 毎秒最終攻撃力の17.28% */
  var VIRUS_TICKS = 5;     /* 原文: 1秒間隔 / 5秒間維持 */
  var INTERVAL = 60;       /* 1秒 */

  /* E.pickTarget は README では (u, frame) だが engine の実装は (u, enemies, frame)。
   * どちらでも動くようにしてから使う。 */
  function pickTargetOf(u, E, frame) {
    try {
      var t = E.pickTarget(u, E.enemies(u), frame);
      if (t) return t;
    } catch (e) { /* 2引数版 */ }
    try { return E.pickTarget(u, frame) || null; } catch (e2) { return null; }
  }

  function infect(src, target, frame) {
    if (!target || !target.alive) return;
    if (target._harranUntil == null || target._harranUntil < frame) {
      target._harranTicks = 0;
    }
    target._harranFrom = src;
    target._harranUntil = frame + VIRUS_TICKS * INTERVAL;
    if (target._harranNext == null || target._harranNext < frame) {
      target._harranNext = frame;
    }
    target._harranTicks = 0;
  }

  function nearestEnemies(enemies, pos, n) {
    var out = [];
    for (var i = 0; i < enemies.length; i++) {
      if (enemies[i].alive) out.push(enemies[i]);
    }
    out.sort(function (a, b) {
      return Math.abs(a.pos - pos) - Math.abs(b.pos - pos) || a.pos - b.pos;
    });
    return out.slice(0, n);
  }

  (window.SPECIALS = window.SPECIALS || {})[57] = {
    init: function (u, E) {
      u._harranShots = 0;
      u._harranSeen = {};
      u._harranDead = {};
    },

    tick: function (u, E, frame) {
      var enemies = E.enemies(u);
      var i, e;

      /* 感染していた敵の撃破を検出して、近い敵2機へ転移 */
      for (i = 0; i < enemies.length; i++) {
        e = enemies[i];
        if (!e.alive) {
          if (u._harranSeen[e.pos] && !u._harranDead[e.pos]) {
            u._harranDead[e.pos] = true;
            if (e._harranUntil != null && e._harranUntil >= frame) {
              var near = nearestEnemies(enemies, e.pos, 2);
              for (var k = 0; k < near.length; k++) infect(u, near[k], frame);
            }
          }
          continue;
        }
        u._harranSeen[e.pos] = true;
        u._harranDead[e.pos] = false;
      }

      /* 毎秒の持続ダメージ */
      for (i = 0; i < enemies.length; i++) {
        e = enemies[i];
        if (!e.alive) continue;
        if (e._harranUntil == null || e._harranUntil < frame) continue;
        if (e._harranNext > frame) continue;
        if (e._harranTicks >= VIRUS_TICKS) continue;
        E.damage(u, e, frame, { multiplierPct: VIRUS_PCT, isSustained: true });
        e._harranTicks += 1;
        e._harranNext = frame + INTERVAL;
      }
    },

    onShot: function (u, E, frame, shot) {
      u._harranShots += 1;
      /* 25% = 4発に1発（決定的近似） */
      if (u._harranShots % 4 !== 3) return;
      var t = pickTargetOf(u, E, frame);
      if (t && t.alive) infect(u, t, frame);
    },

    onBurst: function (u, E, frame) { }
  };
})();
