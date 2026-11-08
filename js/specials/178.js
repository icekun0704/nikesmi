/* クラウン (id 178 / org 119, MG, B2, 防御型, 鉄甲)
 *
 * 原文の状態機械:
 *   skill1
 *     フルバーストタイムが発動した時、直前にバーストスキルを使用した味方全体に
 *       スキル発動者基準で攻撃力64.51%▲：15秒／リロード速度44.35%▲：15秒
 *     フルバーストタイムが発動した時、直前にバーストスキルを使用していない
 *       味方全体に スキル発動者基準で防御力37.44%▲：15秒／
 *       リロード速度44.35%▲：15秒
 *   skill2
 *     通常攻撃で44.35回攻撃した時、自分に
 *       リラックス：受けるHP回復量4.06%▲：20スタック：持続
 *     自分がリラックスのフルスタック状態なら、スタック解除後、自分に
 *       無敵：5秒間維持／ヘイト：敵全体を挑発：5秒間維持／
 *       スキル発動者の最終最大HPの5.23%回復
 *     回復効果が適用された時、味方全体に 攻撃ダメージ20.99%▲：7秒間維持
 *   burst
 *     味方全体に 攻撃ダメージ36.24%▲：15秒／最終最大HP10.45%のバリア：15秒
 *       （どちらもパーサ済み）
 *
 * パーサの扱い:
 *   - skill1 は2ブロックとも、バースト使用の有無を区別せず全員に両方を配る。
 *   - skill2 の1ブロック目は counter n:44.35（小数）のため engine の剰余判定で
 *     一度も発動しない。2・3ブロック目は trigger:unknown。
 *   - 二重計上を避けるため skill1 の2ブロックは効果を空にして撃ち直す。
 *
 * 実装しないもの:
 *   - リロード速度（reloadSpeedPct）は engine のリロード時間計算で使われない。
 */
(function () {
  'use strict';

  var FPS = 60;
  var FB_FRAMES = 10 * FPS;
  var CHAIN_WINDOW = 120;        /* 「直前にバーストスキルを使用した」の判定幅 */

  var ATK_PCT = 64.51;           /* スキル発動者基準で攻撃力64.51%▲ */
  var DEF_PCT = 37.44;           /* スキル発動者基準で防御力37.44%▲ */
  var RELOAD_PCT = 44.35;        /* リロード速度44.35%▲ */
  var S1_SEC = 15;

  var RELAX_EVERY = 44.35;       /* 通常攻撃で44.35回攻撃した時 */
  var RELAX_PCT = 4.06;          /* 受けるHP回復量4.06%▲ */
  var RELAX_MAX = 20;            /* 20スタック */
  var INVULN_SEC = 5;
  var TAUNT_SEC = 5;
  var HEAL_PCT = 5.23;           /* スキル発動者の最終最大HPの5.23%回復 */
  var HEAL_ATKDMG = 20.99;       /* 攻撃ダメージ20.99%▲：7秒 */
  var HEAL_ATKDMG_SEC = 7;

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
    var s1 = (u.skills.skill1 && u.skills.skill1.blocks) || [];
    for (var i = 0; i < s1.length; i++) {
      if ((s1[i].trigger || {}).kind === 'fullBurst') s1[i].effects = [];
    }
  }

  function casterDef(u, E) {
    return u.def * (1 + E.sumStat(u, 'defPct') / 100);
  }

  (window.SPECIALS = window.SPECIALS || {})[178] = {
    init: function (u, E) {
      cloneSkills(u);
      var allyHp = {};
      var allyMax = {};
      var mates = E.alive(E.team(u));
      for (var i = 0; i < mates.length; i++) {
        allyHp[mates[i].pos] = mates[i].hp;
        allyMax[mates[i].pos] = mates[i].hpMax;
      }
      u.crown = {
        lastBurstFrame: -1,
        burstAt: {},          /* pos -> 直近にバーストしたフレーム */
        relax: 0,
        relaxUntil: -1,
        atkAcc: 0,
        allyHp: allyHp,
        allyMax: allyMax
      };
    },

    tick: function (u, E, frame) {
      var s = u.crown;
      if (!s) return;

      /* 味方のバースト使用フレームを記録する */
      var lb = E.team(u).lastBurst;
      if (lb && lb.frame !== s.lastBurstFrame) {
        s.lastBurstFrame = lb.frame;
        if (lb.unit) s.burstAt[lb.unit.pos] = lb.frame;
      }

      /* フルバーストタイム発動時（B3バーストのフレーム） */
      if (lb && lb.stage === 'B3' && lb.frame === frame) {
        var mates = E.alive(E.team(u));
        var until = frame + S1_SEC * FPS;
        var atkFlat = E.atkEff(u) * ATK_PCT * scaleOf(u, 'skill1') / 100;
        var defTotal = casterDef(u, E) * DEF_PCT * scaleOf(u, 'skill1') / 100;
        for (var i = 0; i < mates.length; i++) {
          var a = mates[i];
          var used = s.burstAt[a.pos] != null && frame - s.burstAt[a.pos] <= CHAIN_WINDOW;
          if (used) {
            E.buff(a, 'crown-fb-atk:' + u.pos, 'atkFlat', atkFlat, 'up', until, {});
          } else if (a.def) {
            /* スキル発動者基準の防御力 → 対象の基礎防御力に対する等価な defPct */
            E.buff(a, 'crown-fb-def:' + u.pos, 'defPct',
              defTotal / a.def * 100, 'up', until, {});
          }
          E.buff(a, 'crown-fb-reload:' + u.pos, 'reloadSpeedPct',
            RELOAD_PCT * scaleOf(u, 'skill1'), 'up', until, {});
        }
        E.event({ frame: frame, kind: 'crown-fb', side: u.side, unit: u.name });
      }

      /* リラックスの期限 */
      if (s.relax > 0 && frame > s.relaxUntil) s.relax = 0;

      /* 回復効果が適用された時：味方全体に 攻撃ダメージ20.99%▲：7秒 */
      var healing = false;
      var all = E.alive(E.team(u));
      for (var k = 0; k < all.length; k++) {
        var m = all[k];
        var prev = s.allyHp[m.pos];
        var prevMax = s.allyMax[m.pos];
        if (prev != null && m.hp > prev) {
          var dh = m.hp - prev;
          var dm = prevMax != null ? m.hpMax - prevMax : 0;
          /* 最大HPバフによる増加は「回復効果」ではないので除く */
          if (dh > (dm > 0 ? Math.min(dm, dh) : 0)) healing = true;
        }
        s.allyHp[m.pos] = m.hp;
        s.allyMax[m.pos] = m.hpMax;
      }
      if (healing) {
        var team = E.alive(E.team(u));
        for (var h = 0; h < team.length; h++) {
          E.buff(team[h], 'crown-heal-atkdmg:' + u.pos, 'atkDmgPct',
            HEAL_ATKDMG * scaleOf(u, 'skill2'), 'up',
            frame + HEAL_ATKDMG_SEC * FPS, {});
        }
        E.event({ frame: frame, kind: 'crown-heal-buff', side: u.side, unit: u.name });
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.crown;
      if (!s) return;
      s.atkAcc += 1;
      while (s.atkAcc >= RELAX_EVERY) {
        s.atkAcc -= RELAX_EVERY;
        s.relax = Math.min(RELAX_MAX, s.relax + 1);
        s.relaxUntil = Infinity;
        E.buff(u, 'crown-relax', 'recoveryTakenPct',
          RELAX_PCT * scaleOf(u, 'skill2'), 'up', Infinity,
          { maxStacks: RELAX_MAX, label: 'リラックス' });

        if (s.relax >= RELAX_MAX) {
          /* フルスタック → スタック解除後：無敵5秒／挑発5秒／5.23%回復 */
          s.relax = 0;
          s.relaxUntil = -1;
          u.buffs = u.buffs.filter(function (b) { return b.key !== 'crown-relax'; });
          u.invulnUntil = Math.max(u.invulnUntil, frame + INVULN_SEC * FPS);
          u.tauntUntil = Math.max(u.tauntUntil, frame + TAUNT_SEC * FPS);
          E.heal(u, u.hpMax * HEAL_PCT * scaleOf(u, 'skill2') / 100, frame);
          E.event({ frame: frame, kind: 'crown-relax-release', side: u.side, unit: u.name });
        }
      }
    },

    onBurst: function (u, E, frame) { }
  };
})();
