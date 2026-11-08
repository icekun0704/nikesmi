/* ベルベット (id 117 / org 180, SR, B2, 支援型, 風圧)
 *
 * 原文の状態機械:
 *   skill1
 *     戦闘開始時およびバースト2段階突入時、
 *       ・弾丸泥棒：敵全体に 残弾数5%▼
 *       ・自分に 弾丸ポーチ6000発チャージ（最大6000発保存：解除不可）
 *     フルチャージして攻撃した時、フルバースト状態でなければ自分に
 *       ・弾丸ポーチの弾薬消費100発
 *       ・攻撃力30.5%▲：3秒間維持
 *       ・攻撃ダメージ30.5%▲：3秒間維持
 *   skill2
 *     フルチャージして攻撃した時、フルバーストタイム中のみ
 *       ・弾丸ポーチの弾薬消費300発
 *       ・味方全体に スキル発動者基準で攻撃力25.2%▲：3秒間維持
 *       ・味方全体に チャージダメージ100.8%▲：3秒間維持
 *     通常攻撃を50回命中した時、フルバーストタイム中のみ
 *       ・弾丸ポーチの弾薬消費300発
 *       ・自分に 攻撃ダメージ15.03%▲：5秒間維持
 *       ・対象に 最終攻撃力の400.92%の追加ダメージ
 *   burst
 *     使用武器変更 ダメージ：最終攻撃力の7% / 維持時間10秒
 *     追加効果 攻撃ダメージ34.52%▲：10秒間維持
 *
 * パーサの扱い:
 *   - skill1 の 2番目のブロック（フルチャージ時）は「フルバースト状態でなければ」
 *     の条件が落ちて、常に攻撃力/攻撃ダメージ30.5%を配ってしまう。
 *   - skill2 の 1番目のブロックも「フルバーストタイム中のみ」が落ちている。
 *     二重計上を避けるため、この2ブロックの効果を空にして、条件付きで撃ち直す。
 *   - 弾丸ポーチ（リソース）と 50回命中のブロック（trigger:unknown）は未実装。
 *   - バーストの weaponChange は engine に処理が無い。ダメージ7%（チャージ倍率は
 *     原文に無いので等倍）を10秒間だけ武器ダメージに差し替える。
 *   - 「バースト2段階突入時」の再発動はパーサが戦闘開始時だけにしている。
 *
 * 実装しないもの:
 *   - 武器変更の射撃レート（原文に無い）。元のSRの射撃間隔をそのまま使う。
 */
(function () {
  'use strict';

  var FPS = 60;
  var FB_FRAMES = 10 * FPS;

  var POUCH_MAX = 6000;          /* 最大6000発保存：解除不可 */
  var POUCH_GAIN = 6000;         /* 弾丸ポーチ6000発チャージ */
  var AMMO_DOWN_PCT = 5;         /* 敵全体に残弾数5%▼ */

  var S1_COST = 100;             /* 弾丸ポーチの弾薬消費100発 */
  var S1_ATK = 30.5;             /* 攻撃力30.5%▲：3秒間維持 */
  var S1_ATKDMG = 30.5;          /* 攻撃ダメージ30.5%▲：3秒間維持 */
  var S1_SEC = 3;

  var S2_COST = 300;             /* 弾丸ポーチの弾薬消費300発 */
  var S2_ATK = 25.2;             /* スキル発動者基準で攻撃力25.2%▲：3秒間維持 */
  var S2_CHARGE = 100.8;         /* チャージダメージ100.8%▲：3秒間維持 */
  var S2_SEC = 3;

  var HIT_N = 50;                /* 通常攻撃を50回命中した時 */
  var HIT_COST = 300;
  var HIT_ATKDMG = 15.03;        /* 攻撃ダメージ15.03%▲：5秒間維持 */
  var HIT_SEC = 5;
  var HIT_DMG = 400.92;          /* 最終攻撃力の400.92%の追加ダメージ */

  var BURST_ATKDMG = 34.52;      /* 攻撃ダメージ34.52%▲：10秒間維持 */
  var BURST_SEC = 10;
  var WEAPON_DMG = 7;            /* 使用武器変更 ダメージ：最終攻撃力の7% */
  var WEAPON_SEC = 10;           /* 維持時間：10秒 */

  function scaleOf(u, slot) {
    return (u.skillScale && u.skillScale[slot]) || 1;
  }

  /* engine は B3 バーストの瞬間に team.lastBurst を更新し、そこから10秒が
   * フルバーストタイム。SPECIALS から読める唯一の手掛かり。 */
  function inFullBurst(u, frame) {
    var lb = u.team && u.team.lastBurst;
    return !!(lb && lb.stage === 'B3' && frame >= lb.frame && frame <= lb.frame + FB_FRAMES);
  }

  /* パーサが動かしてしまう条件付きブロックを、ユニット専用の複製で止める。 */
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
    /* skill1: 2番目（fullChargeShot）は「フルバースト状態でなければ」付き */
    if (u.skills.skill1 && u.skills.skill1.blocks[1]) {
      u.skills.skill1.blocks[1].effects = [];
    }
    /* skill2: 1番目（fullChargeShot）は「フルバーストタイム中のみ」付き */
    if (u.skills.skill2 && u.skills.skill2.blocks[0]) {
      u.skills.skill2.blocks[0].effects = [];
    }
  }

  /* 弾丸泥棒：敵全体の残弾数を5%減らす（マガジンが有限な敵だけ） */
  function stealAmmo(u, E) {
    var list = E.alive(E.enemies(u));
    for (var i = 0; i < list.length; i++) {
      var f = list[i].firing;
      if (!f) continue;
      var mag = f.magazine;
      if (!isFinite(mag) || mag <= 0) continue;
      var dec = Math.max(1, Math.round(mag * AMMO_DOWN_PCT / 100));
      f.shotsInMagazine = Math.min(mag, (f.shotsInMagazine || 0) + dec);
    }
  }

  function chargePouch(u) {
    var s = u.velvet;
    s.pouch = Math.min(POUCH_MAX, s.pouch + POUCH_GAIN);
  }

  function takePouch(u, n) {
    var s = u.velvet;
    if (s.pouch < n) return false;
    s.pouch -= n;
    return true;
  }

  function restoreWeapon(u) {
    var s = u.velvet;
    if (!s.weaponActive) return;
    s.weaponActive = false;
    s.weaponUntil = -1;
    if (s.origChar) u.char = s.origChar;
    s.origChar = null;
  }

  (window.SPECIALS = window.SPECIALS || {})[117] = {
    init: function (u, E) {
      cloneSkills(u);
      u.velvet = {
        pouch: 0,
        shotsHits: 0,
        lastBurstFrame: -1,
        weaponActive: false,
        weaponUntil: -1,
        origChar: null
      };
      /* 戦闘開始時：弾丸泥棒＋弾丸ポーチ6000 */
      chargePouch(u);
      stealAmmo(u, E);
    },

    tick: function (u, E, frame) {
      var s = u.velvet;
      if (!s) return;

      /* バースト2段階突入時：弾丸泥棒＋弾丸ポーチ6000 */
      var lb = E.team(u).lastBurst;
      if (lb && lb.frame !== s.lastBurstFrame) {
        s.lastBurstFrame = lb.frame;
        if (lb.stage === 'B2') {
          chargePouch(u);
          stealAmmo(u, E);
          E.event({ frame: frame, kind: 'velvet-steal', side: u.side, unit: u.name });
        }
      }

      if (s.weaponActive && frame > s.weaponUntil) restoreWeapon(u);
    },

    onShot: function (u, E, frame, shot) {
      var s = u.velvet;
      if (!s) return;
      var fb = inFullBurst(u, frame);
      var hits = (shot && shot.hits) || 1;

      if (u.weapon === 'RL' || u.weapon === 'SR') {
        if (!fb) {
          /* フルバースト状態でない：弾丸ポーチ100発で自分を強化 */
          if (takePouch(u, S1_COST)) {
            var s1 = scaleOf(u, 'skill1');
            E.buff(u, 'velvet-s1-atk', 'atkPct', S1_ATK * s1, 'up',
              frame + S1_SEC * FPS, {});
            E.buff(u, 'velvet-s1-atkdmg', 'atkDmgPct', S1_ATKDMG * s1, 'up',
              frame + S1_SEC * FPS, {});
          }
        } else {
          /* フルバースト中：弾丸ポーチ300発で味方全体を強化 */
          if (takePouch(u, S2_COST)) {
            var s2 = scaleOf(u, 'skill2');
            var allies = E.alive(E.team(u));
            for (var i = 0; i < allies.length; i++) {
              var a = allies[i];
              /* スキル発動者基準の攻撃力 = 発動者の最終攻撃力の25.2%を flat で */
              E.buff(a, 'velvet-s2-atk:' + u.pos, 'atkFlat',
                E.atkEff(u) * S2_ATK * s2 / 100, 'up', frame + S2_SEC * FPS, {});
              E.buff(a, 'velvet-s2-charge:' + u.pos, 'chargeDmgPct',
                S2_CHARGE * s2, 'up', frame + S2_SEC * FPS, {});
            }
          }
        }
      }

      /* 通常攻撃を50回命中した時（フルバーストタイム中のみ） */
      s.shotsHits += hits;
      while (s.shotsHits >= HIT_N) {
        s.shotsHits -= HIT_N;
        if (!fb) continue;
        if (!takePouch(u, HIT_COST)) continue;
        var sc = scaleOf(u, 'skill2');
        E.buff(u, 'velvet-hit-atkdmg', 'atkDmgPct', HIT_ATKDMG * sc, 'up',
          frame + HIT_SEC * FPS, {});
        var t = E.pickTarget(u, E.enemies(u), frame);
        if (t) {
          E.damage(u, t, frame, {
            multiplierPct: HIT_DMG * sc, isBurst: false
          });
        }
        E.event({ frame: frame, kind: 'velvet-hit50', side: u.side, unit: u.name });
      }
    },

    onBurst: function (u, E, frame) {
      var s = u.velvet;
      if (!s) return;
      /* 追加効果：攻撃ダメージ34.52%▲：10秒間維持（パーサは weaponChange だけ残す） */
      E.buff(u, 'velvet-burst-atkdmg', 'atkDmgPct',
        BURST_ATKDMG * scaleOf(u, 'burst'), 'up', frame + BURST_SEC * FPS, {});

      /* 使用武器変更：ダメージ7%を10秒間 */
      if (!s.weaponActive) s.origChar = u.char;
      var base = (s.origChar || u.char).stats || {};
      var stats = Object.assign({}, base);
      stats.weaponDamage = WEAPON_DMG;
      /* 原文にチャージ倍率の記載が無いので等倍にする */
      stats.maxCharge = 100;
      u.char = Object.assign({}, s.origChar || u.char, { stats: stats });
      s.weaponActive = true;
      s.weaponUntil = frame + WEAPON_SEC * FPS;
    }
  };
})();
