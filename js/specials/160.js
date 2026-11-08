/* シグナル (id 160 / org 37, SMG, B2, 火力型)
 *
 * パーサで表現できていない部分:
 *   - スキル1「通常攻撃で60回命中した時、対象に
 *       防御力5.94%▼：5秒間維持 / 攻撃力5.94%▼：5秒間維持」
 *     発動条件が trigger:unknown で落ちており、パーサは一度も発動しない。
 *     60ヒットごとに、その時狙っている敵へ両方のデバフを5秒ぶん付与する。
 *
 * パーサが処理済みなので触らないもの:
 *   - スキル2 フルバースト中の吸血44.08%（op lifesteal）
 *   - バーストの攻撃範囲229.22%ダメージと防御力12.34%▼
 */
(function () {
  'use strict';

  var HITS_PER_ACTIVATION = 60;   /* 原文: 通常攻撃で60回命中した時 */
  var DEBUFF_SECONDS = 5;         /* 原文: 5秒間維持 */
  var DEBUFF_PCT = 5.94;          /* 原文: 防御力5.94%▼ / 攻撃力5.94%▼ */

  /* E.pickTarget は README では (u, frame)、engine の実装は (u, enemies, frame)。
   * どちらでも動くようにしておく。 */
  function primaryTarget(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  (window.SPECIALS = window.SPECIALS || {})[160] = {
    init: function (u, E) {
      u.signal = { hits: 0 };
    },

    tick: function (u, E, frame) { },

    onShot: function (u, E, frame, shot) {
      var s = u.signal;
      if (!s) return;
      var prev = s.hits;
      s.hits += (shot && shot.hits) || 0;
      /* MG の初弾は複数ヒットするので、跨いだ60の倍数ぶんだけ発動する */
      while (Math.floor(s.hits / HITS_PER_ACTIVATION) >
             Math.floor(prev / HITS_PER_ACTIVATION)) {
        prev += HITS_PER_ACTIVATION;
        var t = primaryTarget(u, E, frame);
        if (!t || !t.alive) continue;
        var until = frame + DEBUFF_SECONDS * E.FPS;
        E.buff(t, 'signal-s1-def', 'defPct', DEBUFF_PCT, 'down', until, {});
        E.buff(t, 'signal-s1-atk', 'atkPct', DEBUFF_PCT, 'down', until, {});
        E.event({ frame: frame, kind: 'signal-debuff', side: u.side, unit: u.name, target: t.name });
      }
    },

    onBurst: function (u, E, frame) { }
  };
})();
