/* クルミ (199 / org 182)
 *
 * パーサで表現できていない部分だけを実装する。
 *
 * 実装:
 *   1. スキル1「ハッキング：最終攻撃力の52.24%の持続ダメージ：1秒間隔：5秒間維持／6秒間維持」
 *      … パーサは1発ぶんの sustained ダメージしか出さない。ここで残りの毎秒Tickを回す。
 *      パーサが即時1発を出しているので、残りは 5秒 → 4回 / 6秒 → 5回。
 *   2. スキル2「フルバーストタイムの持続中に通常攻撃が36回命中した時、
 *      対象がハッキング状態なら対象に・最終攻撃力の86.17%の追加ダメージ」
 *      … trigger=unknown で落ちているので、36回命中のタイミングで
 *      「ハッキング状態」を満たす相手に追加ダメージ。
 *      フルバースト中かどうかは team.lastBurst（B3 の frame）から判定する。
 *
 * 未実装: なし
 */
(function () {
  'use strict';

  var DOT_PCT = 52.24;     /* 原文: 最終攻撃力の52.24% */
  var EXTRA_PCT = 86.17;   /* 原文: 最終攻撃力の86.17% */
  var INTERVAL = 60;       /* 1秒間隔 */

  /* E.pickTarget は README では (u, frame) だが engine の実装は (u, enemies, frame)。
   * どちらでも動くようにしてから使う。 */
  function pickTargetOf(u, E, frame) {
    try {
      var t = E.pickTarget(u, E.enemies(u), frame);
      if (t) return t;
    } catch (e) { /* 2引数版 */ }
    try { return E.pickTarget(u, frame) || null; } catch (e2) { return null; }
  }

  function dotOf(u, target) {
    var list = u._kurumiDots;
    for (var i = 0; i < list.length; i++) {
      if (list[i].target === target) return list[i];
    }
    return null;
  }

  function hack(u, target, frame, seconds, extraTicks) {
    var d = dotOf(u, target);
    if (!d) {
      d = { target: target, until: 0, next: 0, left: 0 };
      u._kurumiDots.push(d);
    }
    d.until = frame + seconds * INTERVAL;
    d.next = frame + INTERVAL;
    d.left = extraTicks;
  }

  (window.SPECIALS = window.SPECIALS || {})[199] = {
    init: function (u, E) {
      u._kurumiHitMark = 0;
      u._kurumiDots = [];
      u._fbUntil = -1;
      u._lastFBFrame = -1;
    },

    tick: function (u, E, frame) {
      /* フルバースト判定：B3 のバーストで10秒間（engine の FB_FRAMES） */
      var lb = u.team && u.team.lastBurst;
      if (lb && lb.stage === 'B3' && lb.frame !== u._lastFBFrame) {
        u._lastFBFrame = lb.frame;
        u._fbUntil = lb.frame + 10 * E.FPS;
      }

      var list = u._kurumiDots;
      var keep = [];
      for (var i = 0; i < list.length; i++) {
        var d = list[i];
        if (!d.target || !d.target.alive || d.left <= 0 || frame > d.until) continue;
        if (frame >= d.next) {
          E.damage(u, d.target, frame, { multiplierPct: DOT_PCT, isSustained: true });
          d.left -= 1;
          d.next = frame + INTERVAL;
        }
        keep.push(d);
      }
      u._kurumiDots = keep;
    },

    onShot: function (u, E, frame, shot) {
      var hits = u.counters ? u.counters.attackHits : 0;
      while (hits - u._kurumiHitMark >= 36) {
        u._kurumiHitMark += 36;
        var t = pickTargetOf(u, E, frame);
        if (!t || !t.alive) continue;
        var wasHacked = false;
        var d = dotOf(u, t);
        if (d && d.until >= frame) wasHacked = true;

        /* スキル1：36回命中 → ハッキング5秒（残りTick 4回） */
        hack(u, t, frame, 5, 4);

        /* スキル2：フルバースト中で、対象がハッキング状態なら追加ダメージ */
        if (wasHacked && frame <= u._fbUntil) {
          E.damage(u, t, frame, { multiplierPct: EXTRA_PCT });
        }
      }
    },

    onBurst: function (u, E, frame) {
      /* スキル1：バースト使用時、敵全体にハッキング6秒（残りTick 5回） */
      var enemies = E.alive(E.enemies(u));
      for (var i = 0; i < enemies.length; i++) {
        hack(u, enemies[i], frame, 6, 5);
      }
    }
  };
})();
