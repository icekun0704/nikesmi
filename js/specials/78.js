/* ソリン (id 78 / org 99, SMG / B3 / 火力型 / 鉄甲) — 宝物なし
 *
 * パーサが既に動かしているもの（ここでは触らない）:
 *   - バーストの 攻撃範囲内の敵へ 396%
 *   - skill1 通常攻撃40回時の 攻撃速度7.26%▲：3秒
 *     （engine は atkSpeedPct を読まないため数値効果は無い）
 *
 * パーサで表現できていない部分:
 *   - バースト「自分のHPが最大の場合、同じ対象に 最終攻撃力の924%追加ダメージ」
 *     パーサは条件を落として毎回撃つため、そのブロックを空にして
 *     HPが最大のときだけ撃ち直す。
 *   - skill2「自分のHPが最大の時のみ自分に
 *     クリティカル確率21.62%▲：持続 / クリティカルダメージ62.27%▲：持続」
 *     trigger:unknown のため一度も発動しない。HPが最大の間だけ付与する。
 *
 * 実装していないもの: なし
 */
(function () {
  'use strict';

  var BURST_EXTRA_PCT = 924;   /* 原文: 最終攻撃力の924%追加ダメージ */
  var CRIT_RATE = 21.62;       /* 原文: クリティカル確率21.62%▲ */
  var CRIT_DMG = 62.27;        /* 原文: クリティカルダメージ62.27%▲ */

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

  function primaryTarget(u, E, frame) {
    if (E.pickTarget.length >= 3) return E.pickTarget(u, E.enemies(u), frame) || null;
    try { return E.pickTarget(u, frame) || null; } catch (e) { return null; }
  }

  (window.SPECIALS = window.SPECIALS || {})[78] = {
    init: function (u, E) {
      u.sorin = {};

      var sk = copySkills(u);
      if (sk && sk.burst && sk.burst.blocks[1]) {
        /* 条件（自分のHPが最大）を落として撃たれている追加ダメージを止める */
        sk.burst.blocks[1].effects = [];
      }
    },

    tick: function (u, E, frame) {
      /* 自分のHPが最大の時のみ自分に
       * クリティカル確率21.62%▲ / クリティカルダメージ62.27%▲：持続 */
      if (u.hp >= u.hpMax) {
        E.buff(u, 'sorin-crit-rate', 'critRate', CRIT_RATE, 'up', Infinity, { aura: true });
        E.buff(u, 'sorin-crit-dmg', 'critDmgPct', CRIT_DMG, 'up', Infinity, { aura: true });
      }
    },

    onShot: function () { /* 通常攻撃に固有処理なし */ },

    onBurst: function (u, E, frame) {
      /* 自分のHPが最大の場合、同じ対象（攻撃範囲内の敵）に 924% 追加ダメージ */
      if (u.hp < u.hpMax) return;
      var prim = primaryTarget(u, E, frame);
      if (!prim) return;
      var r = (u.char.rlExplosionRange == null ? 1 : u.char.rlExplosionRange);
      var list = E.slotsInRange(E.enemies(u), prim.pos, r);
      if (!list.length) list = [prim];
      for (var i = 0; i < list.length; i++) {
        E.damage(u, list[i], frame, { multiplierPct: BURST_EXTRA_PCT });
      }
      E.event({ frame: frame, kind: 'sorin-fullhp-burst', side: u.side, unit: u.name });
    }
  };
})();
