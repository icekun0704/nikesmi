/* レッドフード (id 111 / org 109, SR, B123, 火力型, 鉄甲)
 *
 * 原文の状態機械:
 *   burst（使用した段階ごとに効果が違う）
 *     バーストⅠで使用時、味方全体に スキル発動者基準で攻撃力77.55%▲：10秒
 *     バーストⅠで使用時、自分に バーストスキルクールタイム40秒▼：戦闘中1回
 *     バーストⅡで使用時、自分に ヘイト（挑発）10秒／受けるHP回復量74.88%▲：10秒
 *                              バーストスキルクールタイム40秒▼：戦闘中1回
 *     バーストⅢで使用時、自分に 使用武器変更（ダメージ51.46% / フルチャージ250% /
 *                               貫通範囲100%拡張）：10秒／チャージ速度100.8%▲：10秒
 *   skill1
 *     通常攻撃をした時、自分に チャージ速度3.81%▲：10スタック：5秒（パーサ済み）
 *     戦闘開始時、自分に
 *       チャージ速度100%を超えた場合、超過した値をチャージダメージに変換
 *       超過した値の240%のチャージダメージ▲：持続
 *   skill2
 *     戦闘開始時、自分に 貫通特化：持続
 *     バーストⅠ使用時、味方全体に スキル発動者基準で防御力50.68%▲：10秒
 *     バーストⅡ使用時、自分に 攻撃ダメージの23.04%回復：10秒
 *     バーストⅢ使用時、自分に スキル発動者基準で攻撃力71.42%▲：10秒
 *
 * パーサの扱い:
 *   - burst のブロックは段階を区別できず、全段階の効果を毎回すべて付与してしまう
 *     （バーストCT短縮も engine の fireBurst が最後に上書きするため無効）。
 *     ここでは burst のブロック効果を空にして、使用段階ごとに撃ち直す。
 *     段階は onBurst 時点の u.burstStageUsed で判別できる。
 *   - skill1 の「超過分の変換」と skill2 の段階別ブロックは trigger:unknown。
 *   - チャージ速度のバフは engine の射撃間隔（生成時に固定）へ反映されないため、
 *     u.firing.character.chargeSpeedPercent を直接書き換えて次弾以降に効かせる。
 *
 * 実装しないもの:
 *   - 貫通特化／貫通範囲100%拡張：engine の通常攻撃に貫通の判定が無い。
 *   - 武器変更中の実際の射撃レート（原文に無い。SRの間隔をそのまま使う）。
 */
(function () {
  'use strict';

  var FPS = 60;
  var BURST_SEC = 10;
  var CT_DOWN_SEC = 40;          /* バーストスキルクールタイム40秒▼ */
  var B1_ATK_PCT = 77.55;        /* スキル発動者基準で攻撃力77.55%▲ */
  var B2_RECOVERY_PCT = 74.88;   /* 受けるHP回復量74.88%▲ */
  var B2_LIFESTEAL_PCT = 23.04;  /* 攻撃ダメージの23.04%回復 */
  var B3_ATK_PCT = 71.42;        /* スキル発動者基準で攻撃力71.42%▲ */
  var DEF_PCT_B1 = 50.68;        /* スキル発動者基準で防御力50.68%▲ */
  var B3_WEAPON_DMG = 51.46;     /* 使用武器変更 ダメージ51.46% */
  var B3_CHARGE_SPEED = 100.8;   /* チャージ速度100.8%▲ */
  var CONVERT_RATIO = 240;       /* 超過した値の240%のチャージダメージ▲ */
  var CHARGE_STACK_PCT = 3.81;   /* チャージ速度3.81%▲：1スタック */
  var CHARGE_STACK_MAX = 10;

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
    /* バーストは段階別に自前で撃つので、パーサ側の効果は全部止める */
    var burst = (u.skills.burst && u.skills.burst.blocks) || [];
    for (var i = 0; i < burst.length; i++) burst[i].effects = [];
  }

  /* スキル発動者の最終防御力 */
  function casterDef(u, E) {
    return u.def * (1 + E.sumStat(u, 'defPct') / 100);
  }

  /* 「スキル発動者基準で防御力N%▲」= 発動者の最終防御力×N% を flat で足す。
   * engine の defFlat は defEff に反映されないため、対象の基礎防御力に対する
   * 等価な defPct に換算する（defEff = def × (1 + defPct/100)）。 */
  function buffCasterDef(ally, u, E, pct, until, key) {
    if (!ally.def) return;
    var flat = casterDef(u, E) * pct / 100;
    E.buff(ally, key, 'defPct', flat / ally.def * 100, 'up', until, {});
  }

  function restoreWeapon(u) {
    var s = u.redhood;
    if (!s.weaponActive) return;
    s.weaponActive = false;
    s.weaponUntil = -1;
    if (s.origChar) u.char = s.origChar;
    s.origChar = null;
  }

  function restoreChargeSpeed(u) {
    var s = u.redhood;
    if (!s.chargeSpeedActive) return;
    s.chargeSpeedActive = false;
    if (u.firing && u.firing.character) {
      u.firing.character.chargeSpeedPercent = s.baseChargeSpeed;
    }
  }

  (window.SPECIALS = window.SPECIALS || {})[111] = {
    init: function (u, E) {
      cloneSkills(u);
      var base = 0;
      if (u.firing && u.firing.character) {
        base = Number(u.firing.character.chargeSpeedPercent) || 0;
      }
      u.redhood = {
        baseChargeSpeed: base,
        weaponActive: false,
        weaponUntil: -1,
        origChar: null,
        chargeSpeedActive: false,
        chargeSpeedUntil: -1,
        lifestealUntil: -1,
        cdQueue: [],
        cdB1Used: false,
        cdB2Used: false,
        lastBurstFrame: -1
      };
    },

    tick: function (u, E, frame) {
      var s = u.redhood;
      if (!s) return;

      /* 「チャージ速度100%を超えた場合、超過した値をチャージダメージに変換」
       * 変換値 = 超過分 × 240%。スタックは gauge.js が数えている。 */
      var stacks = 0;
      if (u.firing) stacks = Number(u.firing.redHoodChargeSpeedStacks) || 0;
      if (stacks > CHARGE_STACK_MAX) stacks = CHARGE_STACK_MAX;
      var totalSpeed = (Number(u.firing && u.firing.character && u.firing.character.chargeSpeedPercent) || 0)
        + stacks * CHARGE_STACK_PCT;
      var excess = totalSpeed - 100;
      if (excess > 0) {
        E.buff(u, 'rh-charge-convert', 'chargeDmgPct',
          excess * CONVERT_RATIO / 100 * scaleOf(u, 'skill1'), 'up', Infinity,
          { aura: true, label: '超過分の変換' });
      }

      /* 武器変更・チャージ速度の期限 */
      if (s.weaponActive && frame > s.weaponUntil) restoreWeapon(u);
      if (s.chargeSpeedActive && frame > s.chargeSpeedUntil) restoreChargeSpeed(u);

      /* 攻撃ダメージの23.04%回復（10秒）の期限 */
      if (s.lifestealUntil >= 0 && frame > s.lifestealUntil) {
        u.lifestealPct = 0;
        s.lifestealUntil = -1;
      }

      /* バーストCT短縮（fireBurst の後に適用するため tick で処理） */
      if (s.cdQueue.length) {
        var keep = [];
        for (var i = 0; i < s.cdQueue.length; i++) {
          var q = s.cdQueue[i];
          if (frame < q.at) { keep.push(q); continue; }
          u.burstReadyAt = Math.max(frame, u.burstReadyAt - q.amount);
          E.event({ frame: frame, kind: 'rh-burst-cd', side: u.side, unit: u.name,
                    amount: q.amount });
        }
        s.cdQueue = keep;
      }
    },

    onShot: function (u, E, frame, shot) { },

    onBurst: function (u, E, frame) {
      var s = u.redhood;
      if (!s) return;
      var stage = u.burstStageUsed;
      var until = frame + BURST_SEC * FPS;
      var mates = E.alive(E.team(u));

      if (stage === 'B1') {
        /* 味方全体に スキル発動者基準で攻撃力77.55%▲：10秒 */
        var atkFlat = E.atkEff(u) * B1_ATK_PCT * scaleOf(u, 'burst') / 100;
        for (var i = 0; i < mates.length; i++) {
          E.buff(mates[i], 'rh-b1-atk:' + u.pos, 'atkFlat', atkFlat, 'up', until, {});
        }
        /* 味方全体に スキル発動者基準で防御力50.68%▲：10秒（skill2） */
        for (var j = 0; j < mates.length; j++) {
          buffCasterDef(mates[j], u, E, DEF_PCT_B1 * scaleOf(u, 'skill2'), until,
            'rh-b1-def:' + u.pos);
        }
        /* バーストスキルクールタイム40秒▼：戦闘中1回 */
        if (!s.cdB1Used) {
          s.cdB1Used = true;
          s.cdQueue.push({ at: frame, amount: CT_DOWN_SEC * FPS });
        }
      } else if (stage === 'B2') {
        /* ヘイト：敵全体を挑発：10秒 */
        u.tauntUntil = Math.max(u.tauntUntil, until);
        /* 受けるHP回復量74.88%▲：10秒 */
        E.buff(u, 'rh-b2-recovery', 'recoveryTakenPct',
          B2_RECOVERY_PCT * scaleOf(u, 'burst'), 'up', until, {});
        /* 攻撃ダメージの23.04%回復：10秒 */
        u.lifestealPct = B2_LIFESTEAL_PCT * scaleOf(u, 'skill2');
        s.lifestealUntil = until;
        /* バーストスキルクールタイム40秒▼：戦闘中1回 */
        if (!s.cdB2Used) {
          s.cdB2Used = true;
          s.cdQueue.push({ at: frame, amount: CT_DOWN_SEC * FPS });
        }
      } else if (stage === 'B3') {
        /* 味方全体に スキル発動者基準で攻撃力71.42%▲：10秒（skill2） */
        var atk3 = E.atkEff(u) * B3_ATK_PCT * scaleOf(u, 'skill2') / 100;
        for (var k = 0; k < mates.length; k++) {
          E.buff(mates[k], 'rh-b3-atk:' + u.pos, 'atkFlat', atk3, 'up', until, {});
        }
        /* 使用武器変更：ダメージ51.46% / フルチャージ250%：10秒 */
        if (!s.weaponActive) s.origChar = u.char;
        var baseStats = (s.origChar || u.char).stats || {};
        var stats = Object.assign({}, baseStats);
        stats.weaponDamage = B3_WEAPON_DMG;
        stats.maxCharge = 250;
        u.char = Object.assign({}, s.origChar || u.char, { stats: stats });
        s.weaponActive = true;
        s.weaponUntil = until;
        /* チャージ速度100.8%▲：10秒（射撃間隔に直接効かせる） */
        if (u.firing && u.firing.character) {
          if (!s.chargeSpeedActive) s.baseChargeSpeed =
            Number(u.firing.character.chargeSpeedPercent) || 0;
          u.firing.character.chargeSpeedPercent =
            s.baseChargeSpeed + B3_CHARGE_SPEED * scaleOf(u, 'burst');
          s.chargeSpeedActive = true;
          s.chargeSpeedUntil = until;
        }
        E.event({ frame: frame, kind: 'rh-weapon-change', side: u.side, unit: u.name });
      }
    }
  };
})();
