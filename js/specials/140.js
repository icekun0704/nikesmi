/* トーブ (id 140 / org 7, AR, B1, 支援型, 水冷) ※宝物なし
 *
 * 原文の状態機械:
 *   skill1
 *     攻撃した時、5%の確率で自分に 代用弾丸：弾丸チャージ5.31%
 *     代用弾丸が適用される時、味方全体に
 *       応急改造：最大装弾数2発▲：3スタック：5秒間維持
 *       クリティカルダメージ5.24%▲：5秒間維持
 *   skill2
 *     自分が応急改造のフルスタック時のみ、味方全体に
 *       クリティカル確率3.32%▲：持続
 *     自分が応急改造のフルスタック状態の時のみ、
 *       ショットガンを所持する味方全体に 攻撃速度42.24%▲：持続
 *   burst
 *     味方全体に その場しのぎの奇跡：スキル発動者基準で攻撃力2.32%▲
 *       ：応急改造スタックコピー：10秒間維持
 *     ショットガンを所持する味方全体に 同 24.21%▲：10秒間維持
 *
 * パーサの扱い:
 *   - skill1 の2ブロックは op:bulletCharge / trigger:unknown で未実装。
 *     5%の確率（parse_trigger が確率を落としている）もここで扱う。
 *   - skill2 の1ブロック目は trigger:unknown。2ブロック目は periodic(20秒) として
 *     条件なしで発動してしまうため、効果を空にして条件付きで撃ち直す。
 *   - burst の2ブロックは期間（10秒）と「応急改造スタックコピー」が落ちている。
 *     両方の効果を空にして自前で撃ち直す。
 *
 * 実装しないもの:
 *   - 攻撃速度（atkSpeedPct）は engine の射撃間隔で使われない。
 */
(function () {
  'use strict';

  var FPS = 60;
  var PROC_PCT = 5;              /* 攻撃した時、5%の確率 */
  var BULLET_CHARGE_PCT = 5.31;  /* 弾丸チャージ5.31% */
  var KAI_MAG = 2;               /* 応急改造：最大装弾数2発▲ */
  var KAI_STACKS = 3;            /* 3スタック */
  var KAI_SEC = 5;               /* 5秒間維持 */
  var KAI_CRITDMG = 5.24;        /* クリティカルダメージ5.24%▲：5秒 */
  var FULL_CRIT = 3.32;          /* クリティカル確率3.32%▲：持続 */
  var FULL_ATKSPEED = 42.24;     /* 攻撃速度42.24%▲：持続（SG） */
  var BURST_ATK_PCT = 2.32;      /* 味方全体に 攻撃力2.32%▲ */
  var BURST_SG_PCT = 24.21;      /* SGの味方全体に 攻撃力24.21%▲ */
  var BURST_SEC = 10;            /* 10秒間維持 */

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  function cloneSkills(u) {
    var src = window.SKILL_DB && window.SKILL_DB[u.skillKey];
    if (!src || !u.skillState) return;
    u.skills = JSON.parse(JSON.stringify(src));
    normalizePeriodic(u.skills);
    for (var s = 0; s < u.skillState.length; s++) {
      var st = u.skillState[s];
      var arr = u.skills[st.slot] && u.skills[st.slot].blocks;
      if (!arr) continue;
      for (var b = 0; b < st.blocks.length; b++) st.blocks[b].block = arr[b];
    }
    /* skill2 の periodic ブロックは条件（フルスタック）が落ちている */
    if (u.skills.skill2 && u.skills.skill2.blocks[1]) {
      u.skills.skill2.blocks[1].effects = [];
    }
    /* burst は期間とスタックコピーを自前で扱う */
    if (u.skills.burst) {
      for (var i = 0; i < u.skills.burst.blocks.length; i++) {
        u.skills.burst.blocks[i].effects = [];
      }
    }
  }


  /* パーサは ct をそのまま trigger.seconds に入れることがあり、文字列 "9秒" の
   * まま engine に渡ると (seconds * 60) が NaN になり、周期スキルが毎フレーム
   * 発動してしまう。ユニット専用の複製側で数値に直す（skills.js は触らない）。 */
  function normalizePeriodic(skills) {
    var slots = ['skill1', 'skill2', 'burst'];
    for (var i = 0; i < slots.length; i++) {
      var sk = skills[slots[i]];
      if (!sk || !sk.blocks) continue;
      for (var b = 0; b < sk.blocks.length; b++) {
        var t = sk.blocks[b].trigger;
        if (!t || t.kind !== 'periodic' || typeof t.seconds !== 'string') continue;
        var m = t.seconds.match(/(\d+(?:\.\d+)?)/);
        if (m) t.seconds = parseFloat(m[1]);
      }
    }
  }

  function roll(s) {
    s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
    return s.rng / 4294967296;
  }

  (window.SPECIALS = window.SPECIALS || {})[140] = {
    init: function (u, E) {
      cloneSkills(u);
      u.tove = {
        stacks: 0,
        until: -1,
        rng: ((u.pos + 1) * 2654435761 + (u.side === 'A' ? 1 : 2)) >>> 0
      };
    },

    tick: function (u, E, frame) {
      var s = u.tove;
      if (!s) return;

      if (s.stacks > 0 && frame > s.until) s.stacks = 0;
      if (s.stacks < KAI_STACKS) return;

      /* 応急改造フルスタック：味方全体に クリティカル確率3.32%▲：持続 */
      var mates = E.alive(E.team(u));
      for (var i = 0; i < mates.length; i++) {
        var a = mates[i];
        E.buff(a, 'tove-full-crit:' + u.pos, 'critRate',
          FULL_CRIT * scaleOf(u, 'skill2'), 'up', Infinity, { aura: true });
        if (a.weapon === 'SG') {
          E.buff(a, 'tove-full-atkspeed:' + u.pos, 'atkSpeedPct',
            FULL_ATKSPEED * scaleOf(u, 'skill2'), 'up', Infinity, { aura: true });
        }
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.tove;
      if (!s) return;
      if (roll(s) * 100 >= PROC_PCT) return;

      /* 代用弾丸：弾丸チャージ5.31%（マガジンの5.31%を装填し直す） */
      var f = u.firing;
      if (f && isFinite(f.magazine) && f.magazine > 0) {
        f.shotsInMagazine = Math.max(0,
          (f.shotsInMagazine || 0) - f.magazine * BULLET_CHARGE_PCT / 100);
      }

      /* 応急改造：味方全体に 最大装弾数2発▲：3スタック：5秒／クリティカルダメージ5.24%▲ */
      var mates = E.alive(E.team(u));
      var until = frame + KAI_SEC * FPS;
      for (var i = 0; i < mates.length; i++) {
        var a = mates[i];
        E.buff(a, 'tove-kai-mag:' + u.pos, 'magazineFlat',
          KAI_MAG * scaleOf(u, 'skill1'), 'up', until, { maxStacks: KAI_STACKS });
        E.buff(a, 'tove-kai-critdmg:' + u.pos, 'critDmgPct',
          KAI_CRITDMG * scaleOf(u, 'skill1'), 'up', until, {});
      }

      /* 自分のスタック数（フルスタック判定用） */
      s.stacks = (frame <= s.until) ? Math.min(KAI_STACKS, s.stacks + 1) : 1;
      s.until = until;
      E.event({ frame: frame, kind: 'tove-substitute', side: u.side, unit: u.name,
                stacks: s.stacks });
    },

    onBurst: function (u, E, frame) {
      var s = u.tove;
      if (!s) return;
      var stacks = s.stacks;
      if (stacks <= 0) return;    /* スタックコピーなので0なら効果なし */
      var until = frame + BURST_SEC * FPS;
      var base = E.atkEff(u) * scaleOf(u, 'burst') * stacks / 100;
      var mates = E.alive(E.team(u));
      for (var i = 0; i < mates.length; i++) {
        var a = mates[i];
        var value = base * BURST_ATK_PCT;
        if (a.weapon === 'SG') value += base * BURST_SG_PCT;
        E.buff(a, 'tove-burst-atk:' + u.pos, 'atkFlat', value, 'up', until,
          { label: 'その場しのぎの奇跡' });
      }
      E.event({ frame: frame, kind: 'tove-burst', side: u.side, unit: u.name,
                stacks: stacks });
    }
  };
})();
