/* シラツル (id 119 / org 186, SR, B2, 防御型, 水冷)
 *
 * 原文の状態機械:
 *   skill1
 *     自分が誓約解除状態ではない時のみ、味方全体に
 *       回復独占誓約：スキル発動者基準で最大HP10%▲：持続
 *     回復効果が適用された時、自分が発動した効果でなければ自分に
 *       誓約違反立証：与えるHP回復量10%▼：最大3個：持続
 *   skill2
 *     フルチャージ状態で3回攻撃した時、回復独占誓約状態の味方全体に
 *       スキル発動者の最終最大HPの1.32%回復
 *     フルバーストタイムが発動した時、味方全体に
 *       スキル発動者の最終最大HPの9.5%のバリア：10秒間維持      ← パーサ済み
 *     自分の誓約違反立証が最大数なら、自分に
 *       誓約解除：誓約違反立証免疫：持続
 *       スキル発動者の最終最大HPの0.24%回復：1秒間隔：持続
 *
 * パーサの扱い:
 *   - skill1 は2ブロックとも trigger:unknown、skill2 の1・3ブロック目も unknown。
 *   - burst の回復はパーサが1回ぶんだけ配る。「与えるHP回復量▼」を反映するため、
 *     burst の回復ブロックを止めて自前で撃ち直す。
 *
 * 実装しないもの:
 *   - 「回復効果が適用された時」のうち、HPが最大で実際には回復しなかった場合。
 *     engine に回復イベントのフックが無く、HPの増加でしか検出できない。
 *   - 誓約解除の「免疫」は、以降スタックを増やさないことで表現する。
 */
(function () {
  'use strict';

  var FPS = 60;
  var VOW_HP_PCT = 10;            /* スキル発動者基準で最大HP10%▲ */
  var STACK_PCT = 10;             /* 誓約違反立証：与えるHP回復量10%▼ */
  var STACK_MAX = 3;              /* 最大3個 */
  var HEAL3_PCT = 1.32;           /* フルチャージ3回攻撃時：1.32%回復 */
  var FULL_CHARGE_N = 3;
  var KAIHO_HEAL_PCT = 0.24;      /* 誓約解除：0.24%回復：1秒間隔 */
  var KAIHO_INTERVAL = 60;        /* 1秒 */
  var BURST_HEAL_PCT = 44.68;     /* burst：44.68%回復 */

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  /* 与えるHP回復量 = 1 - 0.10 × スタック数 */
  function healFactor(s) {
    return Math.max(0, 1 - STACK_PCT * s.stacks / 100);
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
    /* burst の回復は「与えるHP回復量▼」を掛けて自前で配る */
    if (u.skills.burst && u.skills.burst.blocks[0]) {
      u.skills.burst.blocks[0].effects = [];
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[119] = {
    init: function (u, E) {
      cloneSkills(u);
      u.shira = {
        stacks: 0,
        kaiho: false,
        fullCharge: 0,
        lastHp: u.hp,
        lastMaxHp: u.hpMax,
        selfHealAt: -1,
        nextKaihoHeal: -1
      };
    },

    tick: function (u, E, frame) {
      var s = u.shira;
      if (!s) return;

      /* 回復独占誓約：誓約解除状態でない間、味方全体の最大HPを発動者基準で+10% */
      if (!s.kaiho) {
        var mates = E.alive(E.team(u));
        var flat = u.hpMaxBase * VOW_HP_PCT * scaleOf(u, 'skill1') / 100;
        for (var i = 0; i < mates.length; i++) {
          E.buff(mates[i], 'shira-vow:' + u.pos, 'hpFlat', flat, 'up', Infinity,
            { aura: true, label: '回復独占誓約' });
        }
      }

      /* 誓約違反立証：自分が発動していない回復でHPが増えたら1スタック。
       * 最大HPバフによる HP の増加（recalcHpMax）は回復ではないので除く。 */
      if (u.hp > s.lastHp && frame > s.selfHealAt) {
        var dh = u.hp - s.lastHp;
        var dm = u.hpMax - s.lastMaxHp;
        var fromMax = dm > 0 ? Math.min(dm, dh) : 0;
        if (dh > fromMax && !s.kaiho && s.stacks < STACK_MAX) {
          s.stacks += 1;
          E.event({ frame: frame, kind: 'shira-stack', side: u.side, unit: u.name,
                    stacks: s.stacks });
          if (s.stacks >= STACK_MAX) {
            s.kaiho = true;
            s.nextKaihoHeal = frame + KAIHO_INTERVAL;
            E.event({ frame: frame, kind: 'shira-kaiho', side: u.side, unit: u.name });
          }
        }
      }
      s.lastHp = u.hp;
      s.lastMaxHp = u.hpMax;

      /* 誓約解除：1秒ごとに最終最大HPの0.24%回復（自身の効果なのでスタックしない） */
      if (s.kaiho && frame >= s.nextKaihoHeal) {
        s.nextKaihoHeal = frame + KAIHO_INTERVAL;
        var amount = u.hpMax * KAIHO_HEAL_PCT * scaleOf(u, 'skill2') / 100 * healFactor(s);
        E.heal(u, amount, frame);
        s.selfHealAt = frame;
        s.lastHp = u.hp;
        s.lastMaxHp = u.hpMax;
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.shira;
      if (!s) return;
      if (u.weapon !== 'RL' && u.weapon !== 'SR') return;   /* フルチャージ攻撃 */
      s.fullCharge += 1;
      if (s.fullCharge < FULL_CHARGE_N) return;
      s.fullCharge -= FULL_CHARGE_N;

      var mates = E.alive(E.team(u));
      var base = u.hpMax * HEAL3_PCT * scaleOf(u, 'skill2') / 100 * healFactor(s);
      if (base <= 0) return;
      for (var i = 0; i < mates.length; i++) {
        var a = mates[i];
        /* 回復独占誓約状態（aura）の味方だけ */
        var has = false;
        for (var b = 0; b < a.buffs.length; b++) {
          var key = a.buffs[b].key || '';
          if (key.indexOf('shira-vow:') === 0) { has = true; break; }
        }
        if (!has) continue;
        E.heal(a, base, frame);
        if (a === u) { s.selfHealAt = frame; s.lastHp = u.hp; s.lastMaxHp = u.hpMax; }
      }
    },

    onBurst: function (u, E, frame) {
      var s = u.shira;
      if (!s) return;
      var mates = E.alive(E.team(u));
      var amount = u.hpMax * BURST_HEAL_PCT * scaleOf(u, 'burst') / 100 * healFactor(s);
      for (var i = 0; i < mates.length; i++) {
        E.heal(mates[i], amount, frame);
      }
      s.selfHealAt = frame;
      s.lastHp = u.hp;
      s.lastMaxHp = u.hpMax;
    }
  };
})();
