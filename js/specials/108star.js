/* ミルク（宝物）(id 108 / org 12, SR / B1 / 火力型 / 水冷)
 *
 * 宝物版の読み替え（Treasure1 / Treasure2 / Treasure3）:
 *   - skill1「20秒ごとに攻撃力が最も高い味方2機→3機に 攻撃力31.83%▲：10秒」
 *   - skill1「戦闘開始時、自分に バーストスキルクールタイム20秒▼：持続」
 *   - skill2「フルチャージ攻撃が10回命中した時、味方全体に
 *     バーストスキルクールタイム2.83秒▼」
 *   - バースト「味方全体に 受けるHP回復量75.5%▲：10秒」
 *
 * パーサが既に動かしているもの（ここでは触らない）:
 *   - skill1 の 20秒ごとの攻撃力31.83%▲（ただし対象が 2機 のまま）
 *   - skill1 戦闘開始時のバーストクールタイム20秒▼
 *   - バーストの 味方全体 受けるHP回復量75.5%▲：10秒
 *
 * パーサで表現できていない部分:
 *   - 宝物1の「2機→3機」。対象数を 3 に直す。
 *   - skill2「自分のHPが80%以上の時のみ味方全体に
 *     クリティカルダメージ11.13%▲：持続」（trigger:unknown で発動しない）
 *   - skill2「フルチャージ攻撃が10回命中した時、味方全体に
 *     バーストスキルクールタイム2.83秒▼」
 *     counter の on:'fullCharge' は engine が回さないため自前で数える。
 *     また op:burstCd は engine では発動者自身にしか効かないので、味方全体へ
 *     直接 u.burstReadyAt を減らす。
 *   - バースト「味方全体に 攻撃ダメージの16.16%回復：10秒間維持」
 *     op:lifesteal は engine で発動者自身にしか付かず、期限も無い。
 *     このブロックの lifesteal を外して、味方全体に10秒だけ付与する。
 *   - skill1 の周期は trigger.seconds が "20秒<G>→パッシブ</>" という文字列で、
 *     engine の `(trig.seconds || sk.ct || 20) * FPS` が NaN になり毎フレーム
 *     発動してしまう。このユニット専用の複製だけ数値の 20 に直す。
 */
(function () {
  'use strict';

  var FPS = 60;
  var PERIODIC_SEC = 20;       /* 原文: 20秒ごとに */
  var ATK_TARGETS = 3;         /* 宝物1: 攻撃力が最も高い味方3機 */
  var CRIT_DMG = 11.13;        /* 原文: クリティカルダメージ11.13%▲：持続 */
  var HP_THRESHOLD = 80;       /* 原文: 自分のHPが80%以上の時のみ */
  var FC_HITS = 10;            /* 原文: フルチャージ攻撃が10回命中した時 */
  var CD_DOWN = 2.83;          /* 原文: バーストスキルクールタイム2.83秒▼ */
  var LIFESTEAL = 16.16;       /* 原文: 攻撃ダメージの16.16%回復 */
  var LIFESTEAL_SEC = 10;      /* 原文: 10秒間維持 */

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

  (window.SPECIALS = window.SPECIALS || {})[108] = {
    init: function (u, E) {
      u.milkTreasure = { stealUntil: -1, steal: {}, fc: 0 };

      var sk = copySkills(u);
      if (sk && sk.skill1) {
        for (var i = 0; i < sk.skill1.blocks.length; i++) {
          var b = sk.skill1.blocks[i];
          var t = b.trigger || {};
          if (t.kind === 'periodic') {
            /* "20秒<G>→パッシブ</>" を数値に直す（NaN 対策） */
            if (typeof t.seconds !== 'number') t.seconds = PERIODIC_SEC;
            /* 宝物1: 2機 → 3機 */
            if (b.target && b.target.side === 'ally' && b.target.pick === 'highestAtk') {
              b.target.count = ATK_TARGETS;
            }
          }
        }
      }
      if (sk && sk.burst && sk.burst.blocks[1]) {
        /* lifesteal は味方全体・10秒で自前実装するので外す */
        var eff = sk.burst.blocks[1].effects;
        for (var e = eff.length - 1; e >= 0; e--) {
          if (eff[e].op === 'lifesteal') eff.splice(e, 1);
        }
      }
    },

    tick: function (u, E, frame) {
      var s = u.milkTreasure;
      if (!s) return;

      /* 自分のHPが80%以上の時のみ味方全体に クリティカルダメージ11.13%▲：持続 */
      var full = u.hpMax > 0 && (u.hp / u.hpMax) * 100 >= HP_THRESHOLD;
      if (full) {
        var allies = E.alive(E.team(u));
        for (var i = 0; i < allies.length; i++) {
          E.buff(allies[i], 'milk-critdmg:' + u.pos + ':' + allies[i].pos,
            'critDmgPct', CRIT_DMG, 'up', Infinity, { aura: true });
        }
      }

      /* バーストの lifesteal の期限切れ */
      if (s.stealUntil >= 0 && frame > s.stealUntil) {
        var team = E.team(u) || [];
        for (var k = 0; k < team.length; k++) {
          var m = team[k];
          if (s.steal[m.pos] == null) continue;
          m.lifestealPct = s.steal[m.pos];
          delete s.steal[m.pos];
        }
        s.stealUntil = -1;
      }
    },

    onShot: function (u, E, frame, shot) {
      var s = u.milkTreasure;
      if (!s) return;
      /* SR の通常攻撃はすべてフルチャージ攻撃 */
      if (u.weapon !== 'RL' && u.weapon !== 'SR') return;
      s.fc += 1;
      if (s.fc % FC_HITS !== 0) return;
      /* 味方全体に バーストスキルクールタイム2.83秒▼ */
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        allies[i].burstReadyAt = Math.max(0, allies[i].burstReadyAt - CD_DOWN * FPS);
      }
      E.event({ frame: frame, kind: 'milk-cd-down', side: u.side, unit: u.name });
    },

    onBurst: function (u, E, frame) {
      var s = u.milkTreasure;
      if (!s) return;
      /* 味方全体に 攻撃ダメージの16.16%回復：10秒間維持 */
      var allies = E.alive(E.team(u));
      for (var i = 0; i < allies.length; i++) {
        var a = allies[i];
        if (s.stealUntil < 0 && s.steal[a.pos] == null) {
          s.steal[a.pos] = a.lifestealPct || 0;
        }
        a.lifestealPct = Math.max(a.lifestealPct || 0, LIFESTEAL);
      }
      s.stealUntil = frame + LIFESTEAL_SEC * FPS;
      E.event({ frame: frame, kind: 'milk-lifesteal', side: u.side, unit: u.name });
    }
  };
})();
